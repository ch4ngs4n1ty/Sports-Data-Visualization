/* ─────────────────────────────────────────────────────────────────────────
   LIVE MOVES  —  "what move should I make, and why?"

   Turns (model fair price) x (posted live line) into a ranked list of
   concrete, checkable recommendations. Every move carries:

     market    MONEYLINE | TOTAL            — what to bet
     side      HOME/AWAY/OVER/UNDER         — which way
     number    the actual posted price/line you would be taking
     edge      model probability - de-vigged market probability, in points
     ev        expected value per $1 at the posted price
     stake     fractional-Kelly units, already shrunk (see KELLY_FRACTION)
     why       one sentence a human can check
     confidence HIGH | MED | LOW            — and `caveats` saying why not higher

   ── DESIGN RULES, in order of importance ──

   1. NO MOVE WITHOUT A PRICE. An "edge" needs both a model number and a market
      number. When the odds feed is missing or the line is stale, this module
      emits ZERO moves and says so. It does not degrade into vibes.

   2. DE-VIG FIRST, ALWAYS. Live MLB moneylines carry a fat hold — the
      DraftKings live row observed here was 6.5%. Comparing a model probability
      against the RAW implied probability of -253 would invent ~3-4 points of
      edge on the favourite out of nothing.

   3. THE MODEL IS APPROXIMATE, SO THE THRESHOLD IS HIGH. `live-model.js`
      matches real league run-expectancy to within a few points, not exactly.
      An edge under MIN_EDGE is inside our own error bars and is NOT a move.

   4. STAKE IS FRACTIONAL KELLY, AND SMALL. Kelly is optimal only if the
      probability is exactly right, and ours is not. Quarter Kelly, capped.
   ───────────────────────────────────────────────────────────────────────── */

'use strict';

const M = require('./live-model');

/* An edge must clear this to be a move at all. Set above the model's own
   demonstrated error against league RE/score rates (~2-4 points). */
const MIN_EDGE = 0.045;        // 4.5 percentage points
const STRONG_EDGE = 0.080;     // 8 points -> HIGH confidence, if nothing else objects
const KELLY_FRACTION = 0.25;   // quarter Kelly
const MAX_STAKE_UNITS = 2.0;   // hard cap regardless of what Kelly says

/* ── Absurdity ceiling ────────────────────────────────────────────────────
   No real market is 25 points wrong, so an "edge" that large is a bug in our
   own inputs, not a gift. This is not hypothetical: a malformed remaining-runs
   distribution (one half-inning's worth passed where a whole game's was
   expected) produced a confident "UNDER 8.5, +47.7 pts, stake 2u" during
   testing. The math was fine; the input was not. A number that good is a
   symptom, so we drop it and record why instead of ever showing it. */
const ABSURD_EDGE = 0.25;

/* ── Moneyline moves ──────────────────────────────────────────────────────── */
function moneylineMoves(ctx) {
  const { pHome, market, state } = ctx;
  const out = [];
  if (!market?.live) return out;
  const { homeMoneyline, awayMoneyline } = market.live;
  if (homeMoneyline == null || awayMoneyline == null) return out;

  const dv = M.devig(homeMoneyline, awayMoneyline);
  if (!dv) return out;

  const sides = [
    { side: 'HOME', team: state.home.abbr, p: pHome, odds: homeMoneyline, mkt: dv.a },
    { side: 'AWAY', team: state.away.abbr, p: 1 - pHome, odds: awayMoneyline, mkt: dv.b },
  ];

  for (const s of sides) {
    const edge = s.p - s.mkt;
    if (edge < MIN_EDGE || edge > ABSURD_EDGE) continue;
    const ev = M.expectedValue(s.p, s.odds);
    if (ev == null || ev <= 0) continue;
    out.push(buildMove({
      market: 'MONEYLINE',
      side: s.side,
      label: `${s.team} ML ${fmtOdds(s.odds)}`,
      number: s.odds,
      modelProb: s.p,
      marketProb: s.mkt,
      edge, ev,
      hold: dv.hold,
      why: `Model has ${s.team} at ${(s.p * 100).toFixed(1)}% to win from the current state; `
         + `the de-vigged market has ${(s.mkt * 100).toFixed(1)}%.`,
      ctx,
    }));
  }
  return out;
}

/* ── Total moves ──────────────────────────────────────────────────────────
   Fair total = runs already scored + expected runs the rest of the way. We
   price Over/Under off the REMAINING-runs distribution rather than comparing
   means, because a mean says nothing about P(total > line). */
function totalMoves(ctx) {
  const { market, state, expRemaining, remainingDist } = ctx;
  const out = [];
  if (!market?.live) return out;
  const line = market.live.total;
  const { overOdds, underOdds } = market.live;
  if (line == null || overOdds == null || underOdds == null) return out;

  const scored = state.awayScore + state.homeScore;
  const needed = line - scored;           // remaining runs required to go Over
  const pOver = tailProbAbove(remainingDist, needed);
  const pUnder = 1 - pOver;

  const dv = M.devig(overOdds, underOdds);
  if (!dv) return out;

  const fairTotal = scored + expRemaining;
  const sides = [
    { side: 'OVER', p: pOver, odds: overOdds, mkt: dv.a },
    { side: 'UNDER', p: pUnder, odds: underOdds, mkt: dv.b },
  ];

  for (const s of sides) {
    const edge = s.p - s.mkt;
    if (edge < MIN_EDGE || edge > ABSURD_EDGE) continue;
    const ev = M.expectedValue(s.p, s.odds);
    if (ev == null || ev <= 0) continue;
    out.push(buildMove({
      market: 'TOTAL',
      side: s.side,
      label: `${s.side} ${line} ${fmtOdds(s.odds)}`,
      number: s.odds,
      line,
      modelProb: s.p,
      marketProb: s.mkt,
      edge, ev,
      hold: dv.hold,
      why: `${scored} run${scored === 1 ? '' : 's'} in with ~${ctx.inningsLeft} innings left; `
         + `model projects ${expRemaining.toFixed(2)} more for a fair total of `
         + `${fairTotal.toFixed(2)} against a posted ${line}.`,
      ctx,
    }));
  }
  return out;
}

/* P(sum of remaining runs > threshold), from the discrete distribution.
   A half-run line can never push, so `>` and `>=` coincide there; for an
   integer line the push mass is excluded from BOTH sides, which is what a
   book does too. */
function tailProbAbove(dist, threshold) {
  if (!dist || !dist.length) return 0;
  /* A distribution that does not sum to 1 is not a distribution. Returning 0
     here makes the caller emit no move rather than a garbage one. */
  let mass = 0;
  for (let k = 0; k < dist.length; k++) mass += dist[k];
  if (!(mass > 0.99 && mass < 1.01)) return 0;
  let over = 0, push = 0;
  for (let k = 0; k < dist.length; k++) {
    if (k > threshold) over += dist[k];
    else if (k === threshold) push += dist[k];
  }
  const live = 1 - push;
  return live > 1e-9 ? over / live : 0;
}

/* ── Assemble a move, assign confidence, size the stake ───────────────────── */
function buildMove({ market, side, label, number, line, modelProb, marketProb, edge, ev, hold, why, ctx }) {
  const caveats = [];
  let confidence = edge >= STRONG_EDGE ? 'HIGH' : 'MED';

  /* ── Mid-inning edges are mostly our own clock. ──
     MEASURED: the posted live line refreshes at HALF-INNING granularity (see
     the table in live-service.js). So between boundaries our model reprices
     every baserunner and out while the printed number stands still, and the
     gap that opens is not the book's error — it is the book's number being
     older than the game. Acting on it means betting a price that is not
     really on offer. We therefore cap confidence mid-inning and say why. */
  const atBoundary = ctx.state.betweenInnings === true;
  if (!atBoundary) {
    confidence = confidence === 'HIGH' ? 'MED' : 'LOW';
    caveats.push('Mid-inning: the posted line is refreshed per half-inning, so part of this gap is '
      + 'simply the book\'s number lagging the game rather than a mispricing. Re-check at the inning break.');
  }

  /* A line we have never seen move is the single most likely source of a
     fake edge, so it caps confidence outright. */
  if (ctx.market?.live?.stale) {
    confidence = 'LOW';
    caveats.push(`Posted line has not changed in ${ctx.market.live.ageSec}s of polling — it may be stale, `
      + `and an edge against a frozen number is usually our own staleness, not the book's error.`);
  }
  /* Very early in a game the model's run-environment assumptions carry the
     most weight and the least evidence. */
  if (ctx.state.inning <= 2) {
    if (confidence === 'HIGH') confidence = 'MED';
    caveats.push('Early innings: the projection leans on season-level run environment, not on what has happened tonight.');
  }
  /* A big hold means the de-vig split is doing a lot of work. */
  if (hold != null && hold > 0.08) {
    if (confidence === 'HIGH') confidence = 'MED';
    caveats.push(`Wide market (${(hold * 100).toFixed(1)}% hold) — the de-vigged fair price is less precise.`);
  }
  if (ctx.bullpenUncertain) {
    caveats.push('Bullpen strength is approximated from team-wide pitching ERA, not a bullpen-only split.');
  }

  const kellyFull = M.kelly(modelProb, number);
  const stake = Math.min(MAX_STAKE_UNITS, Number((kellyFull * KELLY_FRACTION * 100).toFixed(2)));

  return {
    market, side, label, number, line: line ?? null,
    modelProb: Number(modelProb.toFixed(4)),
    marketProb: Number(marketProb.toFixed(4)),
    fairOdds: M.probToAmerican(modelProb),
    edge: Number(edge.toFixed(4)),
    edgePts: Number((edge * 100).toFixed(1)),
    ev: Number(ev.toFixed(4)),
    evPct: Number((ev * 100).toFixed(1)),
    stakeUnits: stake,
    kellyFull: Number((kellyFull * 100).toFixed(2)),
    confidence,
    why,
    caveats,
  };
}

function fmtOdds(o) {
  const n = Number(o);
  if (!Number.isFinite(n)) return '—';
  return n > 0 ? `+${n}` : `${n}`;
}

/* ── Checkpoints ──────────────────────────────────────────────────────────
   We are ~10-12s behind the book and cannot win a race, so the tab tells the
   user WHEN it is worth looking rather than implying continuous action. These
   are the moments where a structural edge appears and then persists for
   minutes: a half-inning boundary, a pitching change, a starter deep into his
   outing, a big inning just posted. */
function checkpoints(ctx) {
  const { state, workload, bullpen } = ctx;
  const out = [];

  if (state.betweenInnings) {
    out.push({ kind: 'half-inning', text: 'Between half-innings — the market re-prices here; this is the cleanest moment to act.' });
  }

  const def = state.battingTeam === 'away' ? 'home' : 'away';
  const w = workload?.[def];
  if (w) {
    if (w.isStarter && w.pitches >= 85) {
      out.push({
        kind: 'pitching-change',
        text: `${w.name} is at ${w.pitches} pitches. A change is likely within an inning, and the total/ML `
            + `re-base on the bullpen the moment it happens — decide BEFORE the call to the pen, not after.`,
      });
    }
    if (w.isStarter && w.fatigue >= 0.45) {
      out.push({
        kind: 'fatigue',
        text: `${w.name} is carrying real workload (${w.pitches} pitches, ${w.timesThroughOrder} times through). `
            + `Modeled as a continuous decline, not a third-time-through cliff.`,
      });
    }
  }

  const bp = bullpen?.[def];
  if (bp && bp.availableCount <= 4) {
    out.push({
      kind: 'bullpen-thin',
      text: `${state[def].abbr} has only ${bp.availableCount} unused arms — late-inning run expectancy is `
          + `higher than a season-average bullpen number implies.`,
    });
  }

  /* A crooked number just posted is the classic overreaction spot. We report
     the TRUE win-probability swing we computed, and deliberately do NOT claim
     to know how far the market overreacted — that needs tick data we lack. */
  const last = state.innings[state.innings.length - 1];
  if (last) {
    const runs = Math.max(last.away ?? 0, last.home ?? 0);
    if (runs >= 3) {
      out.push({
        kind: 'big-inning',
        text: `A ${runs}-run inning just posted. Live lines routinely overshoot a single crooked number; `
            + `compare the posted move against the model's win probability before chasing it.`,
      });
    }
  }
  return out;
}

/* ── Entry point ──────────────────────────────────────────────────────────── */
function buildMoves(ctx) {
  if (ctx.market?.live?.stale) {
    return {
      moves: [], blocked: true,
      blockedReason: `The reference odds have not changed in ${ctx.market.live.ageSec}s. Wait for a new quote and verify availability at your sportsbook.`,
      checkpoints: checkpoints(ctx),
    };
  }
  /* Rule 1: no price, no moves. */
  if (!ctx.market?.hasLive) {
    return {
      moves: [],
      blocked: true,
      blockedReason: ctx.market
        ? 'No live line is published for this game right now, so there is nothing to price against. '
          + 'The model fair price above still stands on its own.'
        : 'Live odds are unavailable (the odds provider did not return a row for this game).',
      checkpoints: checkpoints(ctx),
    };
  }

  const moves = [...moneylineMoves(ctx), ...totalMoves(ctx)]
    .sort((a, b) => b.edge - a.edge);

  return {
    moves,
    blocked: false,
    blockedReason: null,
    checkpoints: checkpoints(ctx),
    thresholds: { minEdgePts: MIN_EDGE * 100, kellyFraction: KELLY_FRACTION, maxStakeUnits: MAX_STAKE_UNITS },
  };
}

module.exports = { buildMoves, moneylineMoves, totalMoves, checkpoints, tailProbAbove, MIN_EDGE, ABSURD_EDGE, KELLY_FRACTION };
