/* ─────────────────────────────────────────────────────────────────────────
   LIVE IN-PLAY SERVICE  —  state -> fair price -> edge vs the posted line

   Pipeline
   --------
     1. Read the MLB StatsAPI live feed (the ONLY state source; it carries
        inning/half/outs/baserunners/score/pitcher/pitch counts/bullpen).
     2. Derive a forward-looking run environment per side, adjusted for who is
        actually going to be pitching the remaining innings (the starter now,
        the bullpen later) — this is the part a static WE table cannot do.
     3. Price it with `live-model.js` -> P(home win), expected remaining runs.
     4. Fetch the posted LIVE line from ESPN's core odds endpoint and compute
        the edge on a DE-VIGGED basis.
     5. Emit "moves" — concrete, ranked, each naming the market, the number,
        the reason, and its confidence.

   ── THE TWO HONESTY CONSTRAINTS. Do not let these rot. ──

   (A) WE ARE ~10-12 SECONDS BEHIND THE BOOK, ALWAYS.
       The live feed's own `metaData.wait` is 10 (verified). Books run ~1-2s
       feeds and additionally hold a 3-8s acceptance spool they can use to void
       a bet that a just-occurred event invalidated. Therefore this service
       must NEVER present a pitch-by-pitch or "bet it right now" signal: that
       is a race we lose by construction. Every move it emits is deliberately a
       STRUCTURAL edge that persists for minutes — a pitching change, a bullpen
       mismatch, who is due up next inning, a weather shift. `checkpoint`
       marks the discrete moments worth acting on, mirroring how Unabated's
       in-play tools surface edges at half/quarter breaks rather than
       continuously.

   (B) THE POSTED LINE UPDATES PER HALF-INNING, NOT PER PITCH.
       Measured, not assumed. A 20-minute poll of DET @ CWS at 60s intervals
       (2026-09-19) produced exactly ONE line change:

         14:42  Top 3rd,   2 out, empty   -253 / +187  O/U 6.5
         14:50  Bot 3rd,   2 out, 1B      -253 / +187  O/U 6.5   <- unchanged
         14:52  End 3rd,   3 out, empty   -242 / +180  O/U 5.5   <- MOVED
         15:00  Top 4th,   2 out, 1B2B    -242 / +180  O/U 5.5   <- unchanged

       So the number is genuine and it does track the game (pregame was -136 /
       O/U 8), but it is refreshed at HALF-INNING granularity. Two consequences
       we must respect and not paper over:

         1. Mid-inning, our model moves and the posted line does not. The
            resulting "edge" is mostly just our own clock — it is the model
            pricing a runner the book has not repriced yet. That is NOT alpha
            we can bet, because the book's real price mid-inning is not the one
            printed here.
         2. Therefore the only comparison worth acting on is at a half-inning
            boundary, which is exactly where `checkpoints` points the user.

       ESPN's row carries no `lastModified`, so we fingerprint it and report
       `market.stale` + `ageSec` from OUR first sighting (a lower bound), and
       any move built on a line we have not seen change is downgraded to LOW
       and labelled. An edge computed against a frozen number is not an edge.

   Also deliberately NOT implemented: a "third time through the order" alert.
   The classical TTO3 penalty is disputed by the 2022 Bayesian re-analysis
   (Brill et al., arXiv:2210.06724), which finds no strong discontinuity at
   TTO3 once batter/pitcher quality are controlled. We model fatigue as a
   CONTINUOUS function of pitch count and times-faced instead.
   ───────────────────────────────────────────────────────────────────────── */

'use strict';

const { fetchJson } = require('../shared/http');
const { cacheGet, cacheSet, dedupe } = require('../shared/cache');
const M = require('./live-model');

const MLB11 = 'https://statsapi.mlb.com/api/v1.1';
const MLB1 = 'https://statsapi.mlb.com/api/v1';
const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb';
const ESPN_SB = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb';

/* League baselines. RPI = runs per inning (per team). */
const LEAGUE_RPI = 4.3 / 9;      // ~0.478
const LEAGUE_BULLPEN_ERA = 4.15;

/* ── Live feed ────────────────────────────────────────────────────────────
   Cached only 15s: this is the one genuinely live thing in the app, and the
   feed itself asks for a 10s floor. */
async function getLiveFeed(gamePk, { refresh = false } = {}) {
  const key = `livefeed_${gamePk}`;
  if (!refresh) { const c = cacheGet(key); if (c) return c; }
  return dedupe(`${refresh ? 'refresh_' : ''}${key}`, async () => {
    if (!refresh) { const c = cacheGet(key); if (c) return c; }
    const data = await fetchJson(`${MLB11}/game/${gamePk}/feed/live`);
    cacheSet(key, data, 15 * 1000);
    return data;
  });
}

/* ── Parse the feed into a compact state object ───────────────────────────
   `bases` is the 3-bit mask live-model.js expects.

   NOTE on `inningState`: the feed reports 'Top' | 'Bottom' | 'Middle' | 'End'.
   'Middle' means the top half is over but the bottom has not started, and
   'End' means the whole inning is done. Both must be normalised, or the model
   would price a half-inning that has already finished. Verified live: the
   DET @ CWS feed sat in 'Middle 3rd' with outs=3 for two consecutive polls. */
function parseState(feed) {
  const ls = feed.liveData?.linescore || {};
  const gd = feed.gameData || {};
  const abstract = gd.status?.abstractGameState || '';
  const detailed = gd.status?.detailedState || '';

  const rawHalf = (ls.inningHalf || ls.inningState || '').toLowerCase();
  let inning = ls.currentInning || 1;
  let half = rawHalf.startsWith('bot') ? 'bottom' : 'top';
  let outs = Number(ls.outs || 0);
  const off = ls.offense || {};
  let bases = (off.first ? 1 : 0) | (off.second ? 2 : 0) | (off.third ? 4 : 0);

  /* Normalise the between-halves states to the START of the next half. */
  const st = (ls.inningState || '').toLowerCase();
  if (st === 'middle') { half = 'bottom'; outs = 0; bases = 0; }
  else if (st === 'end') { half = 'top'; inning += 1; outs = 0; bases = 0; }
  if (outs > 2) { // defensive: a 3-out state that wasn't labelled Middle/End
    if (half === 'top') { half = 'bottom'; outs = 0; bases = 0; }
    else { half = 'top'; inning += 1; outs = 0; bases = 0; }
  }

  return {
    gamePk: gd.game?.pk || feed.gamePk,
    status: detailed,
    isLive: abstract === 'Live' && !/delay|suspend|postpon|cancel/i.test(detailed),
    isFinal: abstract === 'Final',
    inning, half, outs, bases,
    betweenInnings: st === 'middle' || st === 'end',
    balls: Number(ls.balls || 0),
    strikes: Number(ls.strikes || 0),
    awayScore: Number(ls.teams?.away?.runs || 0),
    homeScore: Number(ls.teams?.home?.runs || 0),
    scheduledInnings: Number(ls.scheduledInnings || 9),
    away: { id: gd.teams?.away?.id, name: gd.teams?.away?.name, abbr: gd.teams?.away?.abbreviation },
    home: { id: gd.teams?.home?.id, name: gd.teams?.home?.name, abbr: gd.teams?.home?.abbreviation },
    venue: gd.venue?.name || null,
    feedTimestamp: feed.metaData?.timeStamp || null,
    battingTeam: half === 'top' ? 'away' : 'home',
    currentPitcher: ls.defense?.pitcher ? { id: ls.defense.pitcher.id, name: ls.defense.pitcher.fullName } : null,
    currentBatter: off.batter ? { id: off.batter.id, name: off.batter.fullName } : null,
    onDeck: off.onDeck ? { id: off.onDeck.id, name: off.onDeck.fullName } : null,
    inHole: off.inHole ? { id: off.inHole.id, name: off.inHole.fullName } : null,
    innings: (ls.innings || []).map(i => ({
      num: i.num, away: i.away?.runs ?? null, home: i.home?.runs ?? null,
    })),
  };
}

/* ── Pitcher workload: continuous fatigue, NOT a TTO3 cliff ───────────────
   Returns the current pitcher's line plus a `fatigue` score in [0,1] and the
   run-environment multiplier it implies for the innings he remains in.

   Pitch count is the primary driver because it is the thing managers actually
   act on and it is directly in the box score. `timesFaced` is included as a
   CONTINUOUS covariate (0.02 per extra time through) rather than a step at 3 —
   see the header note on arXiv:2210.06724. */
function pitcherWorkload(feed, side) {
  const box = feed.liveData?.boxscore?.teams?.[side];
  if (!box) return null;

  /* Resolve THIS side's pitcher, not "the pitcher currently on the mound".
     The linescore only ever names the pitcher who is throwing right now, so
     reading it for both sides returns the same id twice — which produced a
     "HOME pitcher" of Jackson Jobe (the AWAY starter) with a name of
     "Unknown", because that id is absent from the home box score. The side's
     own most recent pitcher is the last entry in its `pitchers` array. */
  const pitchers = box.pitchers || [];
  const pid = pitchers.length ? pitchers[pitchers.length - 1] : null;
  if (!pid) return null;
  const p = box.players?.[`ID${pid}`];
  const st = p?.stats?.pitching || {};
  const pitches = Number(st.numberOfPitches || st.pitchesThrown || 0);
  const battersFaced = Number(st.battersFaced || 0);
  const outs = Number(st.outs || 0);
  const isStarter = pitchers[0] === pid;

  /* Fatigue ramps from 0 at 60 pitches to 1 at 110, plus a small continuous
     times-through-the-order term. Below 60 pitches there is no evidence of
     decline worth pricing. */
  const pitchTerm = Math.max(0, Math.min(1, (pitches - 60) / 50));
  const timesFaced = battersFaced / 9;
  const ttoTerm = Math.max(0, (timesFaced - 1)) * 0.02;
  const fatigue = Math.max(0, Math.min(1, pitchTerm + ttoTerm));

  return {
    id: pid,
    name: p?.person?.fullName || 'Unknown',
    isStarter,
    pitches,
    battersFaced,
    inningsPitched: st.inningsPitched || '0.0',
    outs,
    earnedRuns: Number(st.earnedRuns || 0),
    strikeOuts: Number(st.strikeOuts || 0),
    walks: Number(st.baseOnBalls || 0),
    hits: Number(st.hits || 0),
    timesThroughOrder: Number(timesFaced.toFixed(2)),
    fatigue: Number(fatigue.toFixed(3)),
    /* A fully gassed starter is worth roughly +18% to the opposing run rate
       for as long as he stays in. Deliberately modest — it is a nudge, not a
       regime change, and it decays the moment he's pulled. */
    runMultiplier: Number((1 + 0.18 * fatigue).toFixed(3)),
  };
}

/* ── Bullpen availability + quality ───────────────────────────────────────
   The single most-cited live MLB angle: once the starter exits, the market
   re-bases on season-long bullpen ERA, but what matters is which arms are
   actually available tonight. The feed gives us the `bullpen` array (arms not
   yet used) and `pitchers` (already used), so "available" is exact. */
async function bullpenProfile(feed, side, season) {
  const box = feed.liveData?.boxscore?.teams?.[side];
  if (!box) return null;
  const used = new Set(box.pitchers || []);
  const availIds = (box.bullpen || []).filter(id => !used.has(id));
  const teamId = feed.gameData?.teams?.[side]?.id;

  let era = LEAGUE_BULLPEN_ERA;
  let sampled = 0;
  if (teamId) {
    const key = `bpstats_${teamId}_${season}`;
    let stats = cacheGet(key);
    if (!stats) {
      try {
        const d = await fetchJson(`${MLB1}/teams/${teamId}/stats?stats=season&group=pitching&season=${season}`);
        stats = d?.stats?.[0]?.splits?.[0]?.stat || null;
        if (stats) cacheSet(key, stats, 60 * 60 * 1000);
      } catch { stats = null; }
    }
    /* Team pitching ERA is the whole staff, not the bullpen. Without a split
       we use it as the anchor and note the imprecision rather than inventing
       a bullpen-only number. */
    if (stats?.era) { era = Number(stats.era); sampled = 1; }
  }

  return {
    availableCount: availIds.length,
    usedCount: used.size,
    era: Number(era.toFixed(2)),
    eraIsTeamWide: sampled === 1,
    /* Relative to league: >1 means this bullpen gives up more than average,
       so it RAISES the opponent's run environment once it takes over. */
    runMultiplier: Number(Math.max(0.78, Math.min(1.28, era / LEAGUE_BULLPEN_ERA)).toFixed(3)),
  };
}

/* ── Forward run environment ──────────────────────────────────────────────
   Blends the current pitcher (for the innings he is likely to cover) with the
   bullpen (for the rest). This is the whole reason we run a Markov model
   instead of reading a WE table: the table assumes league-average scoring for
   both sides for the remainder, which is exactly wrong right after an ace
   leaves a game. */
function forwardRunEnv(state, workload, bullpen, teamOffenseMult = 1) {
  const REG = state.scheduledInnings || 9;
  const inningsLeft = Math.max(0.5, REG - state.inning + (state.half === 'top' ? 0.5 : 0));

  /* How much longer does the current pitcher last? A starter at 95 pitches is
     nearly done; a fresh reliever covers ~1 inning. */
  let pitcherInnings;
  if (!workload) pitcherInnings = 0;
  else if (workload.isStarter) {
    const remaining = Math.max(0, (105 - workload.pitches) / 16); // ~16 pitches/inning
    pitcherInnings = Math.min(inningsLeft, remaining);
  } else {
    pitcherInnings = Math.min(inningsLeft, 1.2);
  }
  const bullpenInnings = Math.max(0, inningsLeft - pitcherInnings);

  const pMult = workload ? workload.runMultiplier : 1;
  const bMult = bullpen ? bullpen.runMultiplier : 1;
  const blended = inningsLeft > 0
    ? (pitcherInnings * pMult + bullpenInnings * bMult) / inningsLeft
    : bMult;

  return {
    rpi: Number((LEAGUE_RPI * blended * teamOffenseMult).toFixed(4)),
    inningsLeft: Number(inningsLeft.toFixed(1)),
    pitcherInnings: Number(pitcherInnings.toFixed(1)),
    bullpenInnings: Number(bullpenInnings.toFixed(1)),
    blendedMultiplier: Number(blended.toFixed(3)),
  };
}

/* ── Posted live odds (ESPN core API) ─────────────────────────────────────
   ESPN publishes a provider literally named "DraftKings - Live Odds" whose
   numbers track the game state (verified: CHW -136 pregame vs -253 live once
   they led 1-0 with 2 scoreless half-innings banked). The pregame row is kept
   separately so the UI can show how far the line has travelled.

   Staleness: the row carries NO lastModified, so we fingerprint it and track
   when WE first saw this exact number. `ageSec` is therefore a LOWER bound on
   the true age — honest, and enough to refuse to cry "edge" over a line that
   has not moved in ten minutes. */
const _lineSeen = new Map(); // espnId -> { fp, firstSeen, lastChange }

async function getLiveOdds(espnEventId) {
  if (!espnEventId) return null;
  const key = `liveodds_${espnEventId}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  let items = null;
  try {
    const d = await fetchJson(`${ESPN_CORE}/events/${espnEventId}/competitions/${espnEventId}/odds`);
    items = d?.items || null;
  } catch { items = null; }
  if (!items || !items.length) return null;

  const liveRow = items.find(i => /live/i.test(i.provider?.name || ''));
  const pre = items.find(i => !/live/i.test(i.provider?.name || '')) || null;
  if (!liveRow) {
    const out = { hasLive: false, pregame: pre ? shapeOddsRow(pre) : null, live: null };
    cacheSet(key, out, 20 * 1000);
    return out;
  }

  const live = shapeOddsRow(liveRow);
  const fp = `${live.homeMoneyline}|${live.awayMoneyline}|${live.total}|${live.overOdds}|${live.underOdds}`;
  const now = Date.now();
  const prev = _lineSeen.get(espnEventId);
  if (!prev || prev.fp !== fp) {
    _lineSeen.set(espnEventId, { fp, firstSeen: now, lastChange: now });
  }
  const seen = _lineSeen.get(espnEventId);
  live.ageSec = Math.round((now - seen.firstSeen) / 1000);
  /* 150s is ~a half-inning. A live moneyline that has not moved in that long
     through actual game events is not being repriced, and an "edge" against it
     is far more likely to be our own staleness than a book error. */
  live.stale = live.ageSec > 150;
  live.ageIsLowerBound = true;

  const out = { hasLive: true, live, pregame: pre ? shapeOddsRow(pre) : null };
  cacheSet(key, out, 20 * 1000);
  return out;
}

function shapeOddsRow(row) {
  return {
    provider: row.provider?.name || 'unknown',
    details: row.details ?? null,
    total: row.overUnder ?? null,
    spread: row.spread ?? null,
    overOdds: row.overOdds ?? null,
    underOdds: row.underOdds ?? null,
    awayMoneyline: row.awayTeamOdds?.moneyLine ?? null,
    homeMoneyline: row.homeTeamOdds?.moneyLine ?? null,
  };
}

/* ── gamePk -> ESPN event id ──────────────────────────────────────────────
   Matching is done on the FULL TEAM NAME, not the abbreviation, because the
   two providers genuinely disagree: MLB calls the White Sox `CWS`, ESPN calls
   them `CHW` (verified on this exact game — an abbreviation join returned
   null). Full names are stable across both.

   Note we use ESPN's CORE api here and nowhere touch `site.api.espn.com`:
   that host answers 403 to server-side requests regardless of User-Agent
   (verified with both `PlayIQ/1.0` and a browser UA), while the core host
   answers 200. The site API is fine from the BROWSER, which is why the rest
   of the frontend can keep using it — but it cannot be called from here. */
async function espnEventIdFor(state, dateYmd) {
  const key = `espnmap_${dateYmd}`;
  let map = cacheGet(key);
  if (!map) {
    map = {};
    try {
      const list = await fetchJson(
        `${ESPN_CORE}/events?dates=${dateYmd.replace(/-/g, '')}&limit=60`);
      const refs = (list?.items || []).map(i => i.$ref).filter(Boolean);
      const events = await Promise.all(refs.map(r =>
        fetchJson(r.replace(/^http:/, 'https:')).catch(() => null)));
      for (const e of events) {
        if (!e?.id || !e?.name) continue;
        // "Detroit Tigers at Chicago White Sox"
        const m = String(e.name).split(' at ');
        if (m.length === 2) map[`${norm(m[0])}@${norm(m[1])}`] = e.id;
      }
      cacheSet(key, map, 10 * 60 * 1000);
    } catch { /* no odds is a degraded mode, not an error */ }
  }
  return map[`${norm(state.away.name)}@${norm(state.home.name)}`] || null;
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
}

module.exports = {
  getLiveFeed,
  parseState,
  pitcherWorkload,
  bullpenProfile,
  forwardRunEnv,
  getLiveOdds,
  espnEventIdFor,
  LEAGUE_RPI,
  _internal: { shapeOddsRow },
};

/* ─────────────────────────────────────────────────────────────────────────
   ORCHESTRATOR — the single call the LIVE tab makes.

   Everything above is a pure-ish piece; this assembles them in the one order
   that makes sense and produces the payload the frontend renders.
   ───────────────────────────────────────────────────────────────────────── */

const { buildMoves } = require('./live-moves');

/* Remaining-runs distribution for the whole rest of the game, by convolving
   the per-half-inning distributions. Needed to price a TOTAL properly —
   the mean alone cannot answer "P(total goes over 6.5)". */
function remainingRunsDistribution(state, awayRpi, homeRpi) {
  const REG = state.scheduledInnings || 9;
  const MAXR = 30;
  let dist = new Float64Array(MAXR + 1); dist[0] = 1;

  const conv = (half) => {
    const next = new Float64Array(MAXR + 1);
    for (let i = 0; i <= MAXR; i++) {
      const m = dist[i];
      if (m < 1e-13) continue;
      for (let r = 0; r < half.length; r++) {
        const p = half[r];
        if (p <= 0) continue;
        next[Math.min(MAXR, i + r)] += m * p;
      }
    }
    dist = next;
  };

  const awayFull = M.halfInningRunDist(0, 0, M.distForRpi(awayRpi));
  const homeFull = M.halfInningRunDist(0, 0, M.distForRpi(homeRpi));

  let inning = state.inning;
  if (state.half === 'top') {
    conv(M.halfInningRunDist(state.bases, state.outs, M.distForRpi(awayRpi)));
    conv(homeFull);
    inning += 1;
  } else {
    conv(M.halfInningRunDist(state.bases, state.outs, M.distForRpi(homeRpi)));
    inning += 1;
  }
  for (let i = inning; i <= REG; i++) { conv(awayFull); conv(homeFull); }
  return Array.from(dist);
}

/* Project the next hitters due up for the batting team. The market prices
   pitcher-centrically; which three hitters actually bat next inning is real
   information that is cheap for us and rarely surfaced. */
function dueUp(feed, state) {
  const off = feed.liveData?.linescore?.offense || {};
  const now = [off.batter, off.onDeck, off.inHole]
    .filter(Boolean)
    .map(p => ({ id: p.id, name: p.fullName }));

  /* Next half-inning for the SAME team continues the order from inHole. */
  const side = state.battingTeam;
  const box = feed.liveData?.boxscore?.teams?.[side];
  const order = (box?.battingOrder || []);
  let nextInning = [];
  if (order.length && off.inHole?.id) {
    const idx = order.indexOf(off.inHole.id);
    if (idx >= 0) {
      nextInning = [1, 2, 3].map(k => {
        const pid = order[(idx + k) % order.length];
        const pl = box.players?.[`ID${pid}`];
        return { id: pid, name: pl?.person?.fullName || `#${pid}` };
      });
    }
  }
  return { current: now, nextInning };
}

async function getLiveGame(gamePk, { refresh = false, season } = {}) {
  const feed = await getLiveFeed(gamePk, { refresh });
  const state = parseState(feed);
  const yr = season || Number((feed.gameData?.datetime?.originalDate || '').slice(0, 4)) || new Date().getFullYear();

  /* MLB answers an unknown gamePk with a well-formed but EMPTY feed rather
     than a 404, so "no teams" is how a bad id actually presents. Say so
     instead of rendering a hollow pre-game card. */
  if (!state.away.id || !state.home.id) {
    return {
      gamePk, live: false, state, notFound: true,
      message: `No MLB game found for gamePk ${gamePk}.`,
    };
  }

  if (!state.isLive) {
    return {
      gamePk, live: false, state,
      message: state.isFinal
        ? 'This game is final — there is no live market to price.'
        : `Live analysis is paused (${state.status || 'not in progress'}). It resumes when play is in progress.`,
    };
  }

  const workload = { away: pitcherWorkload(feed, 'away'), home: pitcherWorkload(feed, 'home') };
  const [bpAway, bpHome] = await Promise.all([
    bullpenProfile(feed, 'away', yr).catch(() => null),
    bullpenProfile(feed, 'home', yr).catch(() => null),
  ]);
  const bullpen = { away: bpAway, home: bpHome };

  /* A team's offense faces the OPPOSING pitching, so the away run environment
     is driven by the home pitcher + home bullpen, and vice versa. Getting this
     backwards is an easy and completely silent error. */
  const envAway = forwardRunEnv(state, workload.home, bullpen.home);
  const envHome = forwardRunEnv(state, workload.away, bullpen.away);

  const modelEnv = { awayRpi: envAway.rpi, homeRpi: envHome.rpi, innings: state.scheduledInnings };
  const pHome = M.winProbability(state, modelEnv);
  const expRemaining = M.expectedRemainingRuns(state, modelEnv);
  const remainingDist = remainingRunsDistribution(state, envAway.rpi, envHome.rpi);

  /* Neutral baseline = same state priced at league-average run environment.
     The gap is exactly the value our pitching/bullpen adjustment is adding,
     which is what makes the number auditable instead of a black box. */
  const neutral = M.winProbability(state, { awayRpi: LEAGUE_RPI, homeRpi: LEAGUE_RPI, innings: state.scheduledInnings });

  const dateYmd = (feed.gameData?.datetime?.originalDate) || new Date().toISOString().slice(0, 10);
  let market = null;
  try {
    const eid = await espnEventIdFor(state, dateYmd);
    market = eid ? await getLiveOdds(eid) : null;
  } catch { market = null; }

  const ctx = {
    state, pHome, expRemaining, remainingDist, market,
    workload, bullpen,
    inningsLeft: envAway.inningsLeft,
    bullpenUncertain: !!(bpAway?.eraIsTeamWide || bpHome?.eraIsTeamWide),
  };
  const moveOut = buildMoves(ctx);

  return {
    gamePk, live: true, state,
    model: {
      homeWinProb: Number(pHome.toFixed(4)),
      awayWinProb: Number((1 - pHome).toFixed(4)),
      homeFairOdds: M.probToAmerican(pHome),
      awayFairOdds: M.probToAmerican(1 - pHome),
      expectedRemainingRuns: Number(expRemaining.toFixed(2)),
      fairTotal: Number((state.awayScore + state.homeScore + expRemaining).toFixed(2)),
      neutralHomeWinProb: Number(neutral.toFixed(4)),
      pitchingAdjustmentPts: Number(((pHome - neutral) * 100).toFixed(1)),
      runEnv: { away: envAway, home: envHome, leagueRpi: Number(LEAGUE_RPI.toFixed(4)) },
    },
    workload, bullpen,
    dueUp: dueUp(feed, state),
    recentPlays: (feed.liveData?.plays?.allPlays || [])
      .filter(p => p.about?.isComplete).slice(-6).reverse().map(p => ({
        id: p.about.atBatIndex, inning: p.about.inning, half: p.about.halfInning,
        description: p.result?.description || p.result?.event || 'Play completed',
        scoring: !!p.about.isScoringPlay,
        awayScore: p.result?.awayScore, homeScore: p.result?.homeScore,
      })),
    market,
    ...moveOut,
    meta: {
      feedTimestamp: state.feedTimestamp,
      /* Stated plainly and on every response: we are behind the book, always. */
      latencyNote: 'MLB StatsAPI polls ~10s behind live; books run ~1-2s feeds and hold a 3-8s '
        + 'acceptance window. This tool is for structural edges that persist for minutes, not for racing a pitch.',
      pollSeconds: 15,
    },
  };
}

module.exports.getLiveGame = getLiveGame;
module.exports.remainingRunsDistribution = remainingRunsDistribution;
module.exports.dueUp = dueUp;
