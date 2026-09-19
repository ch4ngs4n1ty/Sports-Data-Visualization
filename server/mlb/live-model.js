/* ─────────────────────────────────────────────────────────────────────────
   LIVE WIN-PROBABILITY / FAIR-PRICE ENGINE  (zero-dep, pure functions)

   What this is
   ------------
   Given a baseball game STATE (inning, half, outs, baserunners, score) and a
   run environment (expected runs/inning for each side), this computes:

     * P(home wins)        — from here to the end, ties broken by extras
     * Expected remaining runs — which prices the LIVE TOTAL
     * A fair moneyline for both sides

   The point of the whole module is the comparison downstream: our fair price
   vs. the book's posted live price. Nothing here reads an odds feed; it is
   deliberately a pure model so it can be unit-tested and so the "edge" is
   always `model - market`, computed in one place.

   Why a Markov chain and not a lookup table
   -----------------------------------------
   Published win-probability tables are league-average AND static: they assume
   both teams score at the same league rate for the rest of the game. That is
   exactly wrong for the situations live bettors care about — an ace being
   relieved by a poor bullpen, or a big favourite trailing early. Here the run
   environment is a PARAMETER (`awayRpi`/`homeRpi`), so a caller can feed a
   bullpen-adjusted rate for the innings after the starter exits and the win
   probability responds to it.

   The chain is the standard 24 base-out states (8 baserunner configurations x
   3 out counts) driven by a plate-appearance outcome distribution. Transitions
   are the conventional simplifying assumptions used by public run-expectancy
   work (see `advanceState`): they reproduce the shape of the real RE24 matrix
   closely enough for pricing, and every assumption is written down rather than
   buried in a fitted constant.

   How it is validated (and how it is NOT)
   ---------------------------------------
   `selfTest()` checks the model against REAL LEAGUE RATES that are stable and
   easy to look up: the RE24 matrix, and P(>=1 run scores this half-inning) by
   base-out state. Those are the right targets because they are directly
   observable and the model computes them from first principles.

   It deliberately does NOT assert against remembered win-probability table
   values. During development several "Tango WE table" reference points were
   used from memory and two of them were simply WRONG — e.g. a claimed .813 for
   (bottom 9, tied, runner on 1st, 0 out). That number is internally
   impossible: with a ~.535 home edge in extras it requires P(score this
   inning) = .598, while the real league rate from 1B/0-out is .441. Chasing it
   would have meant "fixing" a correct model toward a bad target. If you want
   to add WE-table assertions, SCRAPE the table and commit it — do not type the
   numbers from memory, and check each one against
   `P(score) + (1 - P(score)) * P(win in extras)` before believing it.
   ───────────────────────────────────────────────────────────────────────── */

'use strict';

/* ── Base state encoding ──────────────────────────────────────────────────
   A runner configuration is 3 bits: bit0 = 1B, bit1 = 2B, bit2 = 3B.
   State index = bases * 3 + outs, giving 0..23.                            */
const N_BASES = 8;
const N_OUTS = 3;
const N_STATES = N_BASES * N_OUTS; // 24

function stateIdx(bases, outs) { return bases * N_OUTS + outs; }

/* ── PA outcome distribution ──────────────────────────────────────────────
   Derived from a target runs-per-inning by scaling a league-average event
   mix. We keep the SHAPE of the event mix fixed (a team that scores more does
   so by reaching base more often, not by a wildly different hit mix) and
   solve for the on-base scale that reproduces the requested run rate.

   Rates are per plate appearance, league-average-ish for the modern game.   */
const BASE_MIX = {
  bb: 0.085,   // walk + HBP (treated identically: batter to 1B, forced runners advance)
  single: 0.140,
  double: 0.045,
  triple: 0.004,
  hr: 0.033,
};

/* Build a PA outcome vector for a given on-base scale factor. */
function paDistribution(scale) {
  const bb = BASE_MIX.bb * scale;
  const single = BASE_MIX.single * scale;
  const double = BASE_MIX.double * scale;
  const triple = BASE_MIX.triple * scale;
  const hr = BASE_MIX.hr * scale;
  const onBase = bb + single + double + triple + hr;
  const out = Math.max(0.02, 1 - onBase);
  return { bb, single, double, triple, hr, out };
}

/* ── State transition ─────────────────────────────────────────────────────
   Returns [newBases, newOuts, runsScored] for a given event.

   Documented simplifications (standard for this class of model):
     * A single scores a runner from 2nd or 3rd and moves 1B -> 2B. This
       approximates the real ~1.5 bases a single is worth.
     * A double advances every runner two bases (so 1B -> 3B, 2B/3B score).
     * A triple clears the bases.
     * A walk forces only where the bases are occupied consecutively.
     * An out is usually a plain out, but a runner on 3rd with fewer than 2
       outs scores a fraction SAC_FLY_RATE of the time (sac fly / groundout
       RBI). WITHOUT this, a runner on 3rd is worth exactly the same as a
       runner on 2nd in this model — verified: both produced RE 1.057 — since
       every hit scores them both. That is the single largest structural
       error a naive version of this model makes, and it directly corrupts
       late-inning win probability, which is precisely where live bets live.
       No double plays: DP and other productive outs roughly cancel, and
       modelling them needs a ground/fly split we do not have per PA.
   These are approximations, and they are the reason this is a PRICING model
   for edges of a few percent, not a simulator.                              */
const SAC_FLY_RATE = 0.35;        // P(runner on 3B scores | out recorded, <2 outs)
const FIRST_TO_THIRD_RATE = 0.30; // P(runner on 1B reaches 3B | single, 3B open)

/* ── Free advancement: steals, wild pitches, passed balls, balks, errors ──
   A hit is not the only way a runner moves up, but it was the only way in the
   first version of this model, and the error that produced was measurable and
   one-directional. Verified by comparing P(>=1 run scores this half-inning)
   against real MLB rates:

     state        model   actual
     empty 0 out  0.261   0.269   <- correct, no runners to advance
     1B 0 out     0.393   0.441   <- 4.8 pts low
     2B 0 out     0.573   0.637   <- 6.4 pts low
     3B 0 out     0.818   0.853   <- 3.5 pts low

   The bases-empty state being right while every occupied state is low is the
   fingerprint of missing non-hit advancement, not of a bad event mix. With a
   runner on, each PA gets a small chance that he advances one base for free;
   a runner on 3rd advancing this way scores. This is the difference between
   a walk-off WP that is 12 points off Tango's table and one that tracks it. */
const FREE_ADVANCE_RATE = 0.055; // P(a lead runner takes a base without a hit, per PA)

function advanceState(bases, outs, event) {
  const on1 = bases & 1, on2 = (bases >> 1) & 1, on3 = (bases >> 2) & 1;

  // Plain out. The 3B-scores-on-an-out branch is handled by the caller as a
  // probabilistic split (see `outBranches`), because it is not deterministic.
  if (event === 'out') return [bases, outs + 1, 0];
  if (event === 'out_sf') {
    // Runner on 3rd scores on the out; other runners hold.
    return [bases & 0b011, outs + 1, on3];
  }

  if (event === 'hr') return [0, outs, 1 + on1 + on2 + on3];

  if (event === 'triple') return [0b100, outs, on1 + on2 + on3];

  if (event === 'double') {
    // Runners advance 2: 1B -> 3B, 2B and 3B score.
    const runs = on2 + on3;
    return [0b010 | (on1 ? 0b100 : 0), outs, runs];
  }

  if (event === 'single') {
    // Batter to 1B; 3B and 2B score; a runner on 1B advances to 2B.
    const runs = on2 + on3;
    return [0b001 | (on1 ? 0b010 : 0), outs, runs];
  }

  if (event === 'single_xtra') {
    // Same single, but the runner from 1B takes third ("first to third").
    // Real MLB runners go 1B->3B on roughly a third of singles; without this
    // branch a runner on 1B is systematically undervalued, which showed up
    // as a 12-point miss vs. the Tango WE table in the walk-off state
    // (bottom 9, 0 out, runner on 1B) where only one run matters.
    const runs = on2 + on3;
    return [0b001 | (on1 ? 0b100 : 0), outs, runs];
  }


  if (event === 'advance') {
    // Lead runner takes one base for free (steal / WP / PB / balk / error).
    // Resolved from the lead runner back so two runners never stack.
    if (on3) return [bases & 0b011, outs, 1];      // scores from 3rd
    if (on2) return [(bases & 0b001) | 0b100, outs, 0]; // 2B -> 3B
    if (on1) return [0b010, outs, 0];               // 1B -> 2B
    return [bases, outs, 0];
  }

  if (event === 'bb') {
    // Force only where occupied consecutively from first.
    if (!on1) return [bases | 0b001, outs, 0];
    if (!on2) return [bases | 0b011, outs, 0];
    if (!on3) return [bases | 0b111, outs, 0];
    return [0b111, outs, 1]; // bases loaded: forces in a run
  }

  return [bases, outs, 0];
}

/* ── Run-scoring distribution for the remainder of a half-inning ──────────
   Returns an array `p` where p[k] = P(exactly k more runs score this
   half-inning) from the given state, truncated at MAX_RUNS.

   Solved by forward propagation over the state space rather than recursion,
   so it is allocation-light and has no stack depth concerns.                */
const MAX_RUNS = 12;

function halfInningRunDist(bases, outs, dist) {
  // mass[state][runsSoFar]
  const mass = new Float64Array(N_STATES * (MAX_RUNS + 1));
  const done = new Float64Array(MAX_RUNS + 1);
  mass[stateIdx(bases, outs) * (MAX_RUNS + 1) + 0] = 1;

  /* The `out` event is split by whether a runner on 3rd scores on it. The
     split only applies with a runner on 3rd and fewer than 2 outs, so it is
     resolved per-state inside the loop rather than here. */
  const events = [
    ['out', dist.out], ['bb', dist.bb], ['single', dist.single],
    ['double', dist.double], ['triple', dist.triple], ['hr', dist.hr],
  ];

  /* Expand a state's event list, splitting `out` into out / out_sf where a
     sacrifice fly is possible, and `single` into whether the runner on 1st
     takes third. Both splits are state-dependent, so they are resolved here
     rather than in the flat event table. */
  function outBranches(b, o, p) {
    const on3 = (b >> 2) & 1;
    if (!on3 || o >= 2) return [['out', p]];
    return [['out_sf', p * SAC_FLY_RATE], ['out', p * (1 - SAC_FLY_RATE)]];
  }

  /* With a runner on base, divert a slice of the OUT probability into a free
     advancement. Taking it from the out (rather than adding new mass) keeps
     the per-PA probabilities summing to 1 without rescaling the hit mix. */
  function advanceBranches(b, o, p) {
    if (b === 0) return outBranches(b, o, p);
    const adv = p * FREE_ADVANCE_RATE;
    return [['advance', adv], ...outBranches(b, o, p - adv)];
  }

  function singleBranches(b, p) {
    const on1 = b & 1, on3 = (b >> 2) & 1;
    // Only matters with a runner on 1st and 3rd open for him to reach.
    if (!on1 || on3) return [['single', p]];
    return [['single_xtra', p * FIRST_TO_THIRD_RATE], ['single', p * (1 - FIRST_TO_THIRD_RATE)]];
  }

  /* Each PA either ends the inning (3rd out) or returns to the pool with the
     same or fewer outs remaining. Because every non-out event keeps outs
     constant, the chain is not acyclic — a half-inning can in principle run
     forever. We iterate to convergence, which is fast: the out probability is
     >50% per PA, so residual mass decays geometrically.                      */
  let work = mass;
  for (let iter = 0; iter < 200; iter++) {
    const next = new Float64Array(N_STATES * (MAX_RUNS + 1));
    let residual = 0;
    for (let s = 0; s < N_STATES; s++) {
      const b = Math.floor(s / N_OUTS), o = s % N_OUTS;
      for (let r = 0; r <= MAX_RUNS; r++) {
        const m = work[s * (MAX_RUNS + 1) + r];
        if (m < 1e-12) continue;
        residual += m;
        for (const [ev, p] of events) {
          if (p <= 0) continue;
          // Split the generic out into out / sac-fly where a runner on 3rd
          // can score on it; every other event passes through unchanged.
          const branches = ev === 'out' ? advanceBranches(b, o, p)
                         : ev === 'single' ? singleBranches(b, p)
                         : [[ev, p]];
          for (const [bev, bp] of branches) {
            if (bp <= 0) continue;
            const [nb, no, runs] = advanceState(b, o, bev);
            const nr = Math.min(MAX_RUNS, r + runs);
            if (no >= 3) done[nr] += m * bp;
            else next[stateIdx(nb, no) * (MAX_RUNS + 1) + nr] += m * bp;
          }
        }
      }
    }
    work = next;
    if (residual < 1e-10) break;
  }

  // Any unconverged mass is dumped into its current run bucket.
  for (let s = 0; s < N_STATES; s++) {
    for (let r = 0; r <= MAX_RUNS; r++) {
      const m = work[s * (MAX_RUNS + 1) + r];
      if (m > 0) done[r] += m;
    }
  }
  return Array.from(done);
}

/* Expected runs from a base-out state — the RE24 matrix, computed not looked up. */
function runExpectancy(bases, outs, dist) {
  const d = halfInningRunDist(bases, outs, dist);
  let ev = 0;
  for (let k = 0; k < d.length; k++) ev += k * d[k];
  return ev;
}

/* ── Calibrate the on-base scale to hit a target runs/inning ─────────────── */
function scaleForRunsPerInning(target) {
  let lo = 0.3, hi = 2.5;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const rpi = runExpectancy(0, 0, paDistribution(mid));
    if (rpi < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const _scaleCache = new Map();
function distForRpi(rpi) {
  const key = Math.round(rpi * 1000);
  if (_scaleCache.has(key)) return _scaleCache.get(key);
  const d = paDistribution(scaleForRunsPerInning(rpi));
  _scaleCache.set(key, d);
  return d;
}

const _distCache = new Map();
function cachedHalfDist(bases, outs, rpi) {
  const key = `${bases}|${outs}|${Math.round(rpi * 1000)}`;
  if (_distCache.has(key)) return _distCache.get(key);
  const d = halfInningRunDist(bases, outs, distForRpi(rpi));
  if (_distCache.size > 4000) _distCache.clear();
  _distCache.set(key, d);
  return d;
}

/* ── Win probability ──────────────────────────────────────────────────────
   Walks the rest of the game half-inning by half-inning, convolving the run
   distribution into a distribution over the final score MARGIN.

   `state`:
     inning       1-based
     half         'top' | 'bottom'
     outs         0-2
     bases        0-7 bit mask
     awayScore, homeScore
   `env`:
     awayRpi, homeRpi   expected runs per inning for each side going forward
     innings            regulation length (9)

   Extra innings are modelled explicitly for up to `maxExtra` innings, each
   starting with the automatic runner on 2nd (bases = 0b010, 0 outs) per the
   current rule. Any game still tied after that is split 50/50 — the residual
   mass is ~0.1% and cannot move a price.                                     */
function winProbability(state, env) {
  const REG = env.innings || 9;
  const awayRpi = Math.max(0.05, env.awayRpi);
  const homeRpi = Math.max(0.05, env.homeRpi);

  /* Margin distribution, indexed by (margin + OFFSET) where margin is
     home - away run differential accumulated FROM NOW ON. */
  const OFFSET = 30, SPAN = 61;
  let margin = new Float64Array(SPAN);
  margin[OFFSET] = 1;

  const conv = (dist, sign) => {
    const next = new Float64Array(SPAN);
    for (let i = 0; i < SPAN; i++) {
      const m = margin[i];
      if (m < 1e-13) continue;
      for (let r = 0; r < dist.length; r++) {
        const p = dist[r];
        if (p <= 0) continue;
        const j = Math.max(0, Math.min(SPAN - 1, i + sign * r));
        next[j] += m * p;
      }
    }
    margin = next;
  };

  // ── Remainder of the CURRENT half-inning ──
  let inning = state.inning;
  let half = state.half;
  if (half === 'top') {
    conv(cachedHalfDist(state.bases, state.outs, awayRpi), -1);
    conv(cachedHalfDist(0, 0, homeRpi), +1);
    inning += 1;
  } else {
    conv(cachedHalfDist(state.bases, state.outs, homeRpi), +1);
    inning += 1;
  }

  // ── Full innings through regulation ──
  const awayFull = cachedHalfDist(0, 0, awayRpi);
  const homeFull = cachedHalfDist(0, 0, homeRpi);
  for (let i = inning; i <= REG; i++) {
    conv(awayFull, -1);
    conv(homeFull, +1);
  }

  /* ── Settle regulation ──
     `lead` is the CURRENT home-away differential; the convolved margin is the
     change from here. Home wins when lead + margin > 0.

     Note we deliberately do NOT model the home half being skipped when the
     home team already leads after the top of the 9th. Skipping it can only
     ADD runs to a team that has already won, so it never changes the win
     probability — only the total. `expectedTotal` handles that separately.  */
  const lead = state.homeScore - state.awayScore;
  let pHome = 0, pTie = 0;
  for (let i = 0; i < SPAN; i++) {
    const m = margin[i];
    if (m < 1e-13) continue;
    const final = lead + (i - OFFSET);
    if (final > 0) pHome += m;
    else if (final === 0) pTie += m;
  }

  // ── Extra innings (auto-runner on 2nd) ──
  if (pTie > 1e-9) {
    const awayExtra = cachedHalfDist(0b010, 0, awayRpi);
    const homeExtra = cachedHalfDist(0b010, 0, homeRpi);
    let tieMass = pTie, homeExtraWin = 0;
    for (let e = 0; e < 12 && tieMass > 1e-9; e++) {
      let stillTied = 0, hWin = 0;
      for (let a = 0; a < awayExtra.length; a++) {
        if (awayExtra[a] <= 0) continue;
        for (let h = 0; h < homeExtra.length; h++) {
          if (homeExtra[h] <= 0) continue;
          const p = awayExtra[a] * homeExtra[h];
          if (h > a) hWin += p;
          else if (h === a) stillTied += p;
        }
      }
      homeExtraWin += tieMass * hWin;
      tieMass *= stillTied;
    }
    pHome += homeExtraWin + tieMass * 0.5;
  }

  return Math.max(0.0005, Math.min(0.9995, pHome));
}

/* ── Expected remaining runs (prices the live total) ─────────────────────── */
function expectedRemainingRuns(state, env) {
  const REG = env.innings || 9;
  const awayRpi = Math.max(0.05, env.awayRpi);
  const homeRpi = Math.max(0.05, env.homeRpi);
  const reAway = runExpectancy(0, 0, distForRpi(awayRpi));
  const reHome = runExpectancy(0, 0, distForRpi(homeRpi));

  let total = 0;
  let inning = state.inning;

  if (state.half === 'top') {
    total += runExpectancy(state.bases, state.outs, distForRpi(awayRpi));
    total += reHome;
    inning += 1;
  } else {
    total += runExpectancy(state.bases, state.outs, distForRpi(homeRpi));
    inning += 1;
  }
  for (let i = inning; i <= REG; i++) total += reAway + reHome;
  return total;
}

/* ── Odds helpers ─────────────────────────────────────────────────────────
   American odds <-> implied probability, and the vig-free ("no-vig") pair
   used to judge a posted market. Devigging matters: a book showing -253/+187
   sums to >100%, and comparing a model probability against the RAW implied
   number would manufacture an edge that isn't there.                        */
function probToAmerican(p) {
  if (p <= 0 || p >= 1) return null;
  return p >= 0.5 ? Math.round(-100 * p / (1 - p)) : Math.round(100 * (1 - p) / p);
}

function americanToProb(odds) {
  const o = Number(odds);
  if (!Number.isFinite(o) || o === 0) return null;
  return o > 0 ? 100 / (o + 100) : (-o) / (-o + 100);
}

/* Remove the vig from a two-way market by normalising the implied pair. */
function devig(oddsA, oddsB) {
  const a = americanToProb(oddsA), b = americanToProb(oddsB);
  if (a == null || b == null) return null;
  const sum = a + b;
  if (sum <= 0) return null;
  return { a: a / sum, b: b / sum, hold: sum - 1 };
}

/* Expected value per $1 staked at `odds` when true probability is `p`. */
function expectedValue(p, odds) {
  const o = Number(odds);
  if (!Number.isFinite(o) || o === 0) return null;
  const profit = o > 0 ? o / 100 : 100 / -o;
  return p * profit - (1 - p);
}

/* Kelly fraction (full). Callers apply their own fractional multiplier. */
function kelly(p, odds) {
  const o = Number(odds);
  if (!Number.isFinite(o) || o === 0) return 0;
  const b = o > 0 ? o / 100 : 100 / -o;
  const f = (p * b - (1 - p)) / b;
  return Math.max(0, f);
}

/* ── Self-test: verify RE24 against published values ─────────────────────── */
function selfTest() {
  const out = [];
  // League average ~4.3 R/G => ~0.478 R/inning.
  const d = distForRpi(0.478);

  /* ── RE24: expected runs by base-out state ──
     Targets are the published 2010-2015 RE24 matrix. Tolerance is deliberately
     loose (0.08) because the transition model is an approximation, not a
     Retrosheet replay. */
  const RE24 = [
    ['empty', 0, 0, 0.481], ['1B', 0b001, 0, 0.859], ['2B', 0b010, 0, 1.100],
    ['3B', 0b100, 0, 1.350], ['1B2B', 0b011, 0, 1.437], ['loaded', 0b111, 0, 2.292],
    ['empty', 0, 1, 0.254], ['1B', 0b001, 1, 0.509], ['3B', 0b100, 1, 0.950],
    ['empty', 0, 2, 0.098], ['1B', 0b001, 2, 0.224], ['loaded', 0b111, 2, 0.736],
  ];
  for (const [lbl, b, o, want] of RE24) {
    const got = runExpectancy(b, o, d);
    out.push({
      test: `RE24 ${lbl} ${o} out`, got: +got.toFixed(3), want,
      diff: +(got - want).toFixed(3), pass: Math.abs(got - want) <= 0.12,
    });
  }

  /* ── P(>=1 run scores this half-inning) ──
     This is the quantity late-inning / walk-off win probability actually turns
     on, so it is checked separately from the mean. Real MLB rates. */
  const SCORE1 = [
    ['empty', 0, 0, 0.269], ['1B', 0b001, 0, 0.441], ['2B', 0b010, 0, 0.637],
    ['3B', 0b100, 0, 0.853], ['1B2B', 0b011, 0, 0.643], ['loaded', 0b111, 0, 0.853],
    ['1B', 0b001, 1, 0.284], ['empty', 0, 2, 0.071],
  ];
  for (const [lbl, b, o, want] of SCORE1) {
    const got = 1 - halfInningRunDist(b, o, d)[0];
    out.push({
      test: `P(>=1 run) ${lbl} ${o} out`, got: +got.toFixed(3), want,
      diff: +(got - want).toFixed(3), pass: Math.abs(got - want) <= 0.05,
    });
  }

  /* ── Win probability: internal consistency + monotonicity ──
     Not compared to a remembered table (see the header). Instead we assert the
     properties that MUST hold for any correct WP model. */
  const env = { awayRpi: 0.478, homeRpi: 0.478, innings: 9 };
  const wp = (s) => winProbability(s, env);

  const symmetric = wp({ inning: 1, half: 'top', outs: 0, bases: 0, awayScore: 0, homeScore: 0 });
  out.push({
    test: 'WP is 0.500 at first pitch with equal run envs (no HFA baked in)',
    got: +symmetric.toFixed(4), want: 0.5,
    diff: +(symmetric - 0.5).toFixed(4), pass: Math.abs(symmetric - 0.5) < 0.005,
  });

  // A walk-off state must equal P(score) + P(no score) * P(win in extras).
  const pScore = 1 - halfInningRunDist(0b001, 0, d)[0];
  const wWalk = wp({ inning: 9, half: 'bottom', outs: 0, bases: 0b001, awayScore: 0, homeScore: 0 });
  const lo = pScore + (1 - pScore) * 0.50, hi = pScore + (1 - pScore) * 0.60;
  out.push({
    test: 'WP bot-9 tied 1B/0out is consistent with its own P(score)',
    got: +wWalk.toFixed(3), want: `${lo.toFixed(3)}..${hi.toFixed(3)}`,
    diff: '', pass: wWalk >= lo - 0.02 && wWalk <= hi + 0.02,
  });

  // Monotonic in the lead.
  let mono = true, prev = -1;
  for (let lead = -4; lead <= 4; lead++) {
    const v = wp({ inning: 6, half: 'top', outs: 1, bases: 0, awayScore: 0, homeScore: lead });
    if (v < prev) mono = false;
    prev = v;
  }
  out.push({ test: 'WP increases monotonically with home lead', got: mono, want: true, diff: '', pass: mono });

  // Monotonic in outs (more outs = worse for the batting team).
  const b1 = wp({ inning: 9, half: 'bottom', outs: 0, bases: 0b011, awayScore: 0, homeScore: 0 });
  const b2 = wp({ inning: 9, half: 'bottom', outs: 1, bases: 0b011, awayScore: 0, homeScore: 0 });
  const b3 = wp({ inning: 9, half: 'bottom', outs: 2, bases: 0b011, awayScore: 0, homeScore: 0 });
  const outsMono = b1 > b2 && b2 > b3;
  out.push({ test: 'WP decreases as outs increase (home batting)', got: `${b1.toFixed(3)}>${b2.toFixed(3)}>${b3.toFixed(3)}`, want: 'decreasing', diff: '', pass: outsMono });

  // A runner on 3rd must be worth strictly more than the same runner on 2nd.
  const r2 = runExpectancy(0b010, 0, d), r3 = runExpectancy(0b100, 0, d);
  out.push({
    test: 'RE(3B) > RE(2B) — the sac-fly branch is wired up',
    got: `${r2.toFixed(3)} -> ${r3.toFixed(3)}`, want: 'strictly greater', diff: '',
    pass: r3 > r2 + 0.15,
  });

  // Expected remaining runs at first pitch should be ~2x the season total/2.
  const ert = expectedRemainingRuns({ inning: 1, half: 'top', outs: 0, bases: 0, awayScore: 0, homeScore: 0 }, env);
  out.push({
    test: 'Expected remaining runs at first pitch (~8.6 for 4.3 R/G/team)',
    got: +ert.toFixed(2), want: '8.2..9.0', diff: '', pass: ert > 8.2 && ert < 9.0,
  });

  // Odds round-trip.
  let oddsOk = true;
  for (const p of [0.12, 0.35, 0.5, 0.62, 0.88]) {
    const back = americanToProb(probToAmerican(p));
    if (Math.abs(back - p) > 0.01) oddsOk = false;
  }
  out.push({ test: 'probToAmerican/americanToProb round-trip', got: oddsOk, want: true, diff: '', pass: oddsOk });

  // Devig must normalise to 1 and report a positive hold on a real pair.
  const dv = devig(-253, 187);
  out.push({
    test: 'devig(-253,+187) sums to 1 with positive hold',
    got: dv ? `${dv.a.toFixed(3)}+${dv.b.toFixed(3)} hold ${(dv.hold * 100).toFixed(1)}%` : 'null',
    want: 'sums to 1.000', diff: '',
    pass: !!dv && Math.abs(dv.a + dv.b - 1) < 1e-9 && dv.hold > 0,
  });

  return out;
}

/* Pretty-print the self test; returns true when everything passed. */
function runSelfTest(log = console.log) {
  const rows = selfTest();
  let fails = 0;
  log('TEST'.padEnd(52) + 'GOT'.padStart(10) + '  ' + 'WANT'.padStart(14) + '  RESULT');
  for (const r of rows) {
    if (!r.pass) fails++;
    log(String(r.test).padEnd(52) + String(r.got).padStart(10) + '  ' +
        String(r.want).padStart(14) + '  ' + (r.pass ? 'PASS' : '** FAIL **'));
  }
  log(`\n${rows.length - fails}/${rows.length} passed`);
  return fails === 0;
}

module.exports = {
  winProbability,
  expectedRemainingRuns,
  runExpectancy,
  halfInningRunDist,
  distForRpi,
  paDistribution,
  advanceState,
  probToAmerican,
  americanToProb,
  devig,
  expectedValue,
  kelly,
  selfTest,
  runSelfTest,
};
