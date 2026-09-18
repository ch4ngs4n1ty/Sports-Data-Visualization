/* ============================================================
   PLAYIQ — MLB SLATE SIGNALS
   "Is there a play in this game, and WHICH point do I look at?" —
   computed for the WHOLE slate in one request so the games list can
   badge each card before the user opens it. Triage only: it says where
   to look first, it does not replace the per-game Edge Finder / prop
   models.

   What a signal is (rewritten Sep 2026):
     A signal is a STREAK plus at least one piece of MATCHUP CONTEXT.
     A hot rate line on its own is not a play — the user asked for
     "specific players with a noticeable streak, AND some data involving
     the specific pitcher they face, the team they're facing, or where
     they hit in the order". So every signal now carries:
       - `streak`  — a consecutive-game run read off the real game log
                     (hits / multi-hit / RBI / HR / on-base / K for SP),
                     not a rate stat that merely looks warm
       - `angles`  — the labeled reasons to look, each with its own
                     `kind` so the UI can show WHICH point to check:
                     'streak' | 'bvp' | 'vsteam' | 'order' | 'form'
     Props are no longer HR-centric: hit, multi-hit, RBI, total-base,
     on-base and pitcher-K streaks all surface, and `market` names the
     prop the streak actually points at.

   Design constraints (see CLAUDE.md):
     - zero npm deps, pure fetch through ../shared/http
     - additive: does not mutate getGames() or any existing endpoint
     - transparent additive scoring, NOT ML. Every signal carries a `why`
       string, so the UI can explain the badge instead of showing an
       unfalsifiable score.
     - affordable slate-wide: every per-player stat below is fetched via
       ONE bulk `people?personIds=…&hydrate=stats(…)` call per team, so a
       15-game slate costs ~6 calls per game, not ~270 per-player calls.
   ============================================================ */

const { cacheGet, cacheSet } = require('../shared/cache');
const { fetchJson } = require('../shared/http');

const MLB_API = 'https://statsapi.mlb.com/api/v1';

const SIGNALS_TTL = 10 * 60 * 1000;      // whole-slate result
const TEAM_FORM_TTL = 30 * 60 * 1000;    // per-team last-10 hitting
const GAMELOG_TTL = 30 * 60 * 1000;      // per-team batter game logs
const MATCHUP_TTL = 6 * 60 * 60 * 1000;  // career BvP / vs-team (barely moves)
const SP_FORM_TTL = 6 * 60 * 60 * 1000;  // per-pitcher start log

// A hitter needs enough recent volume for a hot line to mean anything.
const MIN_RECENT_G = 5;
const MIN_RECENT_AB = 15;
// A starter needs real innings in the window, not two relief cameos.
const MIN_SP_STARTS = 3;
// Career BvP below this is a coin flip dressed as a trend — we still SHOW it
// when a streak exists (the user asked to see the pitcher angle) but it can't
// carry a signal on its own.
const MIN_BVP_PA = 6;
const MIN_VSTEAM_PA = 25;
// The bar a combined score must clear to be worth badging.
const SURFACE_SCORE = 35;

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = n => Math.round(n * 10) / 10;
const r3 = n => Math.round(n * 1000) / 1000;
const avg3 = n => `.${String(Math.round(n * 1000)).padStart(3, '0')}`;

/* Chunk a personIds list — the bulk people endpoint is happy with ~40 ids but
   not with an unbounded query string. */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* ── Batter recent form ─────────────────────────────────────
   ONE call per team hydrates every rostered hitter's last-10 line.
   That is what makes a 15-game slate affordable (~30 calls, cached
   30 min) instead of ~270 per-player calls. */
async function getTeamRecentHitting(teamId, season) {
  if (!teamId) return [];
  const cacheKey = `slate_teamhit_${teamId}_${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  let rows = [];
  try {
    const url = `${MLB_API}/teams/${teamId}/roster?rosterType=active`
      + `&hydrate=person(stats(type=lastXGames,group=hitting,season=${season},limit=10))`;
    const data = await fetchJson(url);
    for (const entry of data?.roster || []) {
      const p = entry.person || {};
      for (const st of p.stats || []) {
        const split = (st.splits || [])[0];
        if (!split) continue;
        const s = split.stat || {};
        const g = num(s.gamesPlayed), ab = num(s.atBats);
        if (g < MIN_RECENT_G || ab < MIN_RECENT_AB) continue;
        rows.push({
          id: p.id,
          name: p.fullName || '',
          pos: entry.position?.abbreviation || '',
          g, ab,
          h: num(s.hits),
          hr: num(s.homeRuns),
          rbi: num(s.rbi),
          r: num(s.runs),
          bb: num(s.baseOnBalls),
          k: num(s.strikeOuts),
          avg: ab > 0 ? r3(num(s.hits) / ab) : 0,
          ops: parseFloat(s.ops) || 0,
        });
      }
    }
    cacheSet(cacheKey, rows, TEAM_FORM_TTL);
  } catch {
    // Don't cache a failure — a transient 5xx would otherwise blank this
    // team's signals for half an hour.
    return [];
  }
  return rows;
}

/* ── Batter game logs (the streak source) ───────────────────
   A rate stat over 10 games can't tell you whether a hitter is 8-for-8
   in his last two games or 2-for-4 five games ago, and "noticeable
   streak" means the consecutive run. One bulk call per team gets every
   hitter's dated log; `readStreaks` turns each into runs. */
async function getTeamBatterLogs(teamId, ids, season) {
  if (!teamId || !ids.length) return {};
  const cacheKey = `slate_blogs_${teamId}_${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const byId = {};
  try {
    for (const group of chunk(ids, 30)) {
      const url = `${MLB_API}/people?personIds=${group.join(',')}`
        + `&hydrate=stats(group=hitting,type=gameLog,season=${season})`;
      const data = await fetchJson(url);
      for (const p of data?.people || []) {
        const splits = p.stats?.[0]?.splits || [];
        // Log is oldest-first; keep it that way and read backwards.
        byId[p.id] = splits.map(s => {
          const st = s.stat || {};
          return {
            date: s.date || '',
            oppId: s.opponent?.id || null,
            ab: num(st.atBats),
            h: num(st.hits),
            hr: num(st.homeRuns),
            rbi: num(st.rbi),
            r: num(st.runs),
            bb: num(st.baseOnBalls),
            k: num(st.strikeOuts),
            tb: num(st.totalBases),
          };
        });
      }
    }
    cacheSet(cacheKey, byId, GAMELOG_TTL);
  } catch {
    return {};
  }
  return byId;
}

/* Count the CURRENT consecutive-game run for each prop-shaped threshold.

   Only games the hitter actually batted in count toward a run (an 0-AB
   pinch-run appearance neither extends nor breaks a hit streak — that is
   how streaks are conventionally kept, and treating it as a break would
   silently kill real streaks).

   Returns the single most interesting run, because a card shows one line.
   Ranked by how much a run of that length actually says: a 6-game
   multi-hit run is rarer (and a better prop lead) than a 6-game hit
   streak, so the thresholds carry a `weight` and we pick on run × weight. */
const STREAK_DEFS = [
  { key: 'multihit', market: 'HITS 1.5+', min: 3, weight: 3.4, test: g => g.h >= 2,
    label: n => `${n} straight multi-hit games` },
  { key: 'hits',     market: 'HITS 0.5+', min: 5, weight: 1.6, test: g => g.h >= 1,
    label: n => `${n}-game hit streak` },
  { key: 'rbi',      market: 'RBI 0.5+',  min: 3, weight: 2.4, test: g => g.rbi >= 1,
    label: n => `RBI in ${n} straight` },
  { key: 'hr',       market: 'HR 0.5+',   min: 2, weight: 4.5, test: g => g.hr >= 1,
    label: n => `HR in ${n} straight` },
  { key: 'tb',       market: 'TOTAL BASES 1.5+', min: 4, weight: 2.2, test: g => g.tb >= 2,
    label: n => `2+ total bases in ${n} straight` },
  // On-base runs get long easily (a walk counts), so this is the weakest
  // threshold: high `min`, low weight, and a cap so a 21-game on-base run
  // can't outrank a 4-game multi-hit run that actually points at a prop.
  { key: 'onbase',   market: 'HITS+RUNS+RBI', min: 8, weight: 1.0, cap: 12,
    test: g => g.h >= 1 || g.bb >= 1,
    label: n => `reached base in ${n} straight` },
];

function readStreaks(log) {
  if (!log || !log.length) return null;
  const played = log.filter(g => g.ab > 0 || g.bb > 0);
  if (played.length < 3) return null;

  let best = null;
  for (const def of STREAK_DEFS) {
    let run = 0;
    for (let i = played.length - 1; i >= 0; i--) {
      if (def.test(played[i])) run++;
      else break;
    }
    if (run < def.min) continue;
    const rank = Math.min(def.cap ?? Infinity, run * def.weight);
    if (!best || rank > best.rank) best = { ...def, run, rank, label: def.label(run) };
  }
  if (!best) return null;

  // Recent box-score line for the tooltip — the streak window itself.
  const window = played.slice(-best.run);
  const sum = k => window.reduce((s, g) => s + num(g[k]), 0);
  return {
    key: best.key,
    market: best.market,
    games: best.run,
    label: best.label,
    rank: best.rank,
    line: { ab: sum('ab'), h: sum('h'), hr: sum('hr'), rbi: sum('rbi'), tb: sum('tb') },
  };
}

/* How much a streak is worth, in 0-100 heat terms. Capped well below 100
   so matchup context is always what pushes a signal into HOT — a streak
   alone is a "look", a streak with a pitcher/team angle is a play. */
function scoreStreak(streak) {
  if (!streak) return 0;
  // rank = games × weight, and weights run 1.4-4.5. Scale so a strong run
  // (e.g. 4 straight multi-hit = 13.6) lands near the cap.
  return Math.min(45, Math.round(streak.rank * 3));
}

/* ── Matchup context: this batter vs TODAY'S starter ────────
   Career batter-vs-pitcher in ONE bulk call per team. This is the
   "data involving the specific pitcher" the badge needs to be
   actionable — a hot bat that is 1-for-14 lifetime against tonight's
   arm is exactly the case the old scorer badged as a play. */
async function getTeamBvpVsPitcher(ids, pitcherId) {
  if (!pitcherId || !ids.length) return {};
  const cacheKey = `slate_bvp_${pitcherId}_${ids.length}_${ids[0]}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const byId = {};
  try {
    for (const group of chunk(ids, 30)) {
      const url = `${MLB_API}/people?personIds=${group.join(',')}`
        + `&hydrate=stats(group=hitting,type=vsPlayerTotal,opposingPlayerId=${pitcherId})`;
      const data = await fetchJson(url);
      for (const p of data?.people || []) {
        const st = p.stats?.[0]?.splits?.[0]?.stat;
        if (!st) continue;
        const pa = num(st.plateAppearances);
        if (!pa) continue;
        byId[p.id] = {
          pa, ab: num(st.atBats), h: num(st.hits), hr: num(st.homeRuns),
          k: num(st.strikeOuts), bb: num(st.baseOnBalls),
          avg: parseFloat(st.avg) || 0,
          ops: parseFloat(st.ops) || 0,
        };
      }
    }
    cacheSet(cacheKey, byId, MATCHUP_TTL);
  } catch {
    return {};
  }
  return byId;
}

/* ── Matchup context: this batter vs the OPPOSING TEAM ──────
   Career vs-franchise. Weaker than BvP (different pitchers, different
   years) so it is scored lower and only used at a real sample — but it
   is the angle that explains "this guy always hits in this ballpark /
   against these guys", which is a point the user wants surfaced. */
async function getTeamVsOpponent(ids, oppTeamId) {
  if (!oppTeamId || !ids.length) return {};
  const cacheKey = `slate_vsteam_${oppTeamId}_${ids.length}_${ids[0]}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const byId = {};
  try {
    for (const group of chunk(ids, 30)) {
      const url = `${MLB_API}/people?personIds=${group.join(',')}`
        + `&hydrate=stats(group=hitting,type=vsTeamTotal,opposingTeamId=${oppTeamId})`;
      const data = await fetchJson(url);
      for (const p of data?.people || []) {
        const st = p.stats?.[0]?.splits?.[0]?.stat;
        if (!st) continue;
        const pa = num(st.plateAppearances);
        if (!pa) continue;
        byId[p.id] = {
          pa, h: num(st.hits), hr: num(st.homeRuns),
          avg: parseFloat(st.avg) || 0,
          ops: parseFloat(st.ops) || 0,
        };
      }
    }
    cacheSet(cacheKey, byId, MATCHUP_TTL);
  } catch {
    return {};
  }
  return byId;
}

/* Score the recent RATE line — kept, but demoted. It used to BE the signal;
   now it is one supporting angle among several, so its ceiling is low. */
function scoreForm(b) {
  let score = 0;
  const angles = [];
  if (b.ops >= 0.9) {
    score += Math.min(18, (b.ops - 0.9) * 45);
    angles.push({ kind: 'form', direction: 'back', text: `${b.ops.toFixed(3)} OPS L10` });
  }
  if (b.avg >= 0.32) {
    score += Math.min(12, (b.avg - 0.32) * 120);
    angles.push({ kind: 'form', direction: 'back', text: `${avg3(b.avg)} L10 (${b.h}-for-${b.ab})` });
  }
  // Strikeout-heavy stretches are a real drag on contact props.
  if (b.ab > 0 && b.k / b.ab > 0.33) score -= 10;
  return { score, angles };
}

/* Score the batter-vs-pitcher angle.

   Deliberately two-sided. A hot hitter who owns tonight's starter is a
   BACK; a hot hitter who has never solved him is a genuine caution, and
   saying so is more useful than hiding it — the user is deciding which
   point to look at, not being sold a bet. */
function scoreBvp(bvp, pitcherName) {
  if (!bvp || bvp.pa < MIN_BVP_PA) return { score: 0, angles: [], caution: false };
  const angles = [];
  let score = 0;
  let caution = false;
  const line = `${bvp.h}-for-${bvp.ab}${bvp.hr ? `, ${bvp.hr} HR` : ''}`;

  if (bvp.ops >= 0.9 || (bvp.avg >= 0.3 && bvp.pa >= 8)) {
    // Career success against this specific arm, weighted by sample.
    score += Math.min(30, 12 + (bvp.ops - 0.9) * 20 + Math.min(10, bvp.pa / 2));
    angles.push({ kind: 'bvp', text: `${line} career vs ${pitcherName}`, direction: 'back' });
  } else if (bvp.avg <= 0.18 && bvp.pa >= 10) {
    score -= 12;
    caution = true;
    angles.push({ kind: 'bvp', text: `only ${line} career vs ${pitcherName}`, direction: 'fade' });
  } else {
    // Neutral sample — still worth PRINTING, because "he's 3-for-11 off this
    // guy" is the context that turns a streak into a decision. Zero weight.
    angles.push({ kind: 'bvp', text: `${line} career vs ${pitcherName}`, direction: 'neutral' });
  }
  // A strikeout-prone matchup caps contact props regardless of the rate line.
  if (bvp.ab >= 10 && bvp.k / bvp.ab >= 0.4) {
    score -= 8;
    angles.push({ kind: 'bvp', text: `${bvp.k}K in ${bvp.ab} AB vs him`, direction: 'fade' });
  }
  return { score, angles, caution };
}

function scoreVsTeam(vs, oppName) {
  if (!vs || vs.pa < MIN_VSTEAM_PA) return { score: 0, angles: [] };
  if (vs.ops < 0.85) return { score: 0, angles: [] };
  return {
    score: Math.min(15, 6 + (vs.ops - 0.85) * 30),
    angles: [{ kind: 'vsteam', direction: 'back',
      text: `${avg3(vs.avg)}/${vs.ops.toFixed(3)} in ${vs.pa} career PA vs ${oppName}` }],
  };
}

/* Lineup spot. Top-of-order guarantees the plate appearances a hit or
   TB prop needs to clear; a 9-hole streak is the same rate with one
   fewer trip. This is the third thing the user asked to see. */
function scoreOrder(order) {
  if (!order) return { score: 0, angles: [] };
  if (order <= 4) {
    return { score: order <= 2 ? 10 : 7,
      angles: [{ kind: 'order', direction: 'back', text: `batting ${order}${order === 1 ? 'st' : order === 2 ? 'nd' : order === 3 ? 'rd' : 'th'}` }] };
  }
  if (order >= 8) {
    return { score: -6,
      angles: [{ kind: 'order', direction: 'fade', text: `batting ${order}th (fewer PA)` }] };
  }
  return { score: 0, angles: [{ kind: 'order', direction: 'neutral', text: `batting ${order}th` }] };
}

/* ── Starting pitcher recent form ───────────────────────────
   Reuses the same gameLog shape the Pitching tab already reads, but
   kept local so this module stays independent of service.js internals. */
async function getPitcherRecentStarts(pitcherId, season, count = 5) {
  if (!pitcherId) return [];
  const cacheKey = `slate_splog_${pitcherId}_${season}`;
  let all = cacheGet(cacheKey);
  if (!all) {
    try {
      const data = await fetchJson(
        `${MLB_API}/people/${pitcherId}/stats?stats=gameLog&group=pitching&season=${season}`);
      const splits = data?.stats?.[0]?.splits || [];
      all = splits.map(s => {
        const st = s.stat || {};
        return {
          date: s.date || '',
          oppId: s.opponent?.id || null,
          gs: num(st.gamesStarted),
          outs: num(st.outs),
          bf: num(st.battersFaced),
          k: num(st.strikeOuts),
          er: num(st.earnedRuns),
          h: num(st.hits),
          bb: num(st.baseOnBalls),
          hr: num(st.homeRuns),
        };
      });
      cacheSet(cacheKey, all, SP_FORM_TTL);
    } catch {
      return [];
    }
  }
  // Season log is oldest-first; take the most recent qualifying starts.
  return all.filter(g => g.gs >= 1 || g.outs >= 9).slice(-count);
}

/* Pitcher streaks, same idea as the batter side: a consecutive run beats a
   window average, because "6+ K in five straight starts" is a prop lead and
   "9.1 K/9" is a season fact. */
function readPitcherStreak(starts) {
  if (!starts || starts.length < MIN_SP_STARTS) return null;
  const defs = [
    { key: 'k6', market: 'STRIKEOUTS 5.5+', min: 3, weight: 3.0, test: g => g.k >= 6,
      label: n => `6+ K in ${n} straight starts` },
    { key: 'qs', market: 'OUTS 17.5+', min: 3, weight: 2.4,
      test: g => g.outs >= 18 && g.er <= 3, label: n => `${n} straight quality starts` },
    { key: 'er2', market: 'EARNED RUNS U2.5', min: 3, weight: 2.6, test: g => g.er <= 2,
      label: n => `2 ER or fewer in ${n} straight` },
    { key: 'shelled', market: 'OPPOSING OFFENSE', min: 2, weight: 3.0, test: g => g.er >= 5,
      label: n => `5+ ER in ${n} straight`, direction: 'fade' },
  ];
  let best = null;
  for (const def of defs) {
    let run = 0;
    for (let i = starts.length - 1; i >= 0; i--) {
      if (def.test(starts[i])) run++;
      else break;
    }
    if (run < def.min) continue;
    const rank = run * def.weight;
    if (!best || rank > best.rank) {
      best = { key: def.key, market: def.market, games: run, rank,
        label: def.label(run), direction: def.direction || 'back' };
    }
  }
  return best;
}

/* Career record for tonight's starter against the team he faces — the
   pitcher-side equivalent of vs-team, and the angle that most often
   explains a line that looks off. */
function summarizeSpVsOpp(allStarts, oppTeamId) {
  const vs = (allStarts || []).filter(g => g.oppId && String(g.oppId) === String(oppTeamId));
  if (!vs.length) return null;
  const sum = k => vs.reduce((s, g) => s + num(g[k]), 0);
  const outs = sum('outs');
  if (outs < 9) return null;
  const ip = outs / 3;
  return { starts: vs.length, ip: r1(ip), k: sum('k'),
    era: r1(sum('er') * 9 / ip), kPerStart: r1(sum('k') / vs.length) };
}

/* Score a starter's recent run into 0-100 heat.

   Weighted toward strikeout rate because K props are the most commonly
   shopped pitcher market, then run prevention (which drives the ML/F5
   read the High Contact tab already models). A streak and the vs-team
   record now sit on top of that rate line. */
function scorePitcher(starts, allStarts, name, oppTeamId, oppName) {
  if (!starts || starts.length < MIN_SP_STARTS) return null;
  const sum = k => starts.reduce((s, g) => s + num(g[k]), 0);
  const outs = sum('outs'), ip = outs / 3;
  if (ip < 10) return null;

  const k = sum('k'), er = sum('er'), bf = sum('bf');
  const era = r1(er * 9 / ip);
  const k9 = r1(k * 9 / ip);
  const kRate = bf > 0 ? k / bf : 0;
  const ipPerStart = r1(ip / starts.length);

  let score = 0;
  const angles = [];

  const streak = readPitcherStreak(starts);
  if (streak) {
    score += Math.min(40, Math.round(streak.rank * 3.5));
    angles.push({ kind: 'streak', direction: streak.direction, text: streak.label });
  }

  // Strikeout rate. League-average K/BF is ~.22; .28+ is a plus-K arm.
  if (kRate >= 0.26) {
    score += Math.min(25, (kRate - 0.26) * 250);
    angles.push({ kind: 'form', direction: 'back', text: `${k9} K/9 L${starts.length}` });
  }
  // Run prevention over the window.
  if (era <= 3.0) {
    score += Math.min(22, (3.0 - era) * 10);
    angles.push({ kind: 'form', direction: 'back', text: `${era.toFixed(2)} ERA L${starts.length}` });
  } else if (era >= 6.0) {
    // A starter getting hit hard is just as actionable — it points at the
    // opposing offense. Flagged separately so the UI can label it FADE.
    score += Math.min(45, 32 + (era - 6.0) * 4);
    angles.push({ kind: 'form', direction: 'fade',
      text: `${era.toFixed(2)} ERA L${starts.length} (vulnerable)` });
  }
  // Volume: a starter who goes deep gives K/outs props room to clear.
  if (ipPerStart >= 6.0) {
    score += 8;
    angles.push({ kind: 'form', direction: 'back', text: `${ipPerStart} IP/start` });
  }

  // The matchup angle: what he has actually done against THIS team.
  const vsOpp = summarizeSpVsOpp(allStarts, oppTeamId);
  if (vsOpp) {
    if (vsOpp.starts >= 2 && vsOpp.era <= 3.0) {
      score += 12;
      angles.push({ kind: 'vsteam', direction: 'back',
        text: `${vsOpp.era.toFixed(2)} ERA, ${vsOpp.kPerStart} K/start in ${vsOpp.starts} career starts vs ${oppName}` });
    } else if (vsOpp.starts >= 2 && vsOpp.era >= 5.5) {
      angles.push({ kind: 'vsteam', direction: 'fade',
        text: `${vsOpp.era.toFixed(2)} ERA in ${vsOpp.starts} career starts vs ${oppName}` });
      score += 10;   // a bad history vs this team is a real angle, just the other way
    } else {
      angles.push({ kind: 'vsteam', direction: 'neutral',
        text: `${vsOpp.starts} career start${vsOpp.starts === 1 ? '' : 's'} vs ${oppName}, ${vsOpp.era.toFixed(2)} ERA` });
    }
  }

  const cold = era >= 6.0 || streak?.direction === 'fade';
  const market = streak?.market || (cold ? 'OPPOSING OFFENSE' : 'STRIKEOUTS');
  return {
    kind: 'pitcher',
    name,
    score: Math.max(0, Math.min(100, Math.round(score))),
    angles,
    streak: streak ? { label: streak.label, games: streak.games } : null,
    market,
    direction: cold ? 'fade' : 'back',
    stat: streak ? streak.label : (cold ? `${era.toFixed(2)} ERA` : `${k9} K/9`),
    detail: { era, k9, ip: r1(ip), starts: starts.length, ipPerStart, vsOpp },
  };
}

/* ── Per-game signal assembly ───────────────────────────────── */

// Only hitters actually IN today's lineup are trustworthy signals; a hot
// bench bat who doesn't start is noise. When the lineup isn't posted yet we
// fall back to the whole roster and mark the signal `projected`, so the UI
// can show it as provisional rather than pretending it's confirmed.
function pickBatters(rows, lineupIds) {
  if (lineupIds && lineupIds.size) {
    const inLineup = rows.filter(b => lineupIds.has(b.id));
    if (inLineup.length) return { batters: inLineup, confirmed: true };
  }
  return { batters: rows, confirmed: false };
}

async function buildGameSignals(game, season) {
  const lu = game._lineups || {};
  const awayIds = new Set(lu.awayPlayers || []);
  const homeIds = new Set(lu.homePlayers || []);
  // Batting order, when posted: position in the array IS the spot.
  const orderOf = list => {
    const m = new Map();
    (list || []).forEach((id, i) => { if (id) m.set(id, i + 1); });
    return m;
  };
  const awayOrder = orderOf(lu.awayPlayers);
  const homeOrder = orderOf(lu.homePlayers);

  const awaySpId = game.away?.probablePitcher?.id;
  const homeSpId = game.home?.probablePitcher?.id;

  const [awayHit, homeHit, awaySpAll, homeSpAll] = await Promise.all([
    getTeamRecentHitting(game.away?.id, season),
    getTeamRecentHitting(game.home?.id, season),
    getPitcherRecentStarts(awaySpId, season, 40),
    getPitcherRecentStarts(homeSpId, season, 40),
  ]);

  // Narrow to the hitters we might actually badge BEFORE spending calls on
  // their logs and matchup splits — that's what keeps a 15-game slate cheap.
  const awayPick = pickBatters(awayHit, awayIds);
  const homePick = pickBatters(homeHit, homeIds);
  const awayCand = awayPick.batters.map(b => b.id).filter(Boolean);
  const homeCand = homePick.batters.map(b => b.id).filter(Boolean);

  const [awayLogs, homeLogs, awayBvp, homeBvp, awayVsTeam, homeVsTeam] = await Promise.all([
    getTeamBatterLogs(game.away?.id, awayCand, season),
    getTeamBatterLogs(game.home?.id, homeCand, season),
    // Away hitters face the HOME starter, and vice versa.
    getTeamBvpVsPitcher(awayCand, homeSpId),
    getTeamBvpVsPitcher(homeCand, awaySpId),
    getTeamVsOpponent(awayCand, game.home?.id),
    getTeamVsOpponent(homeCand, game.away?.id),
  ]);

  const signals = [];

  const sides = [
    { pick: awayPick, logs: awayLogs, bvp: awayBvp, vsTeam: awayVsTeam,
      order: awayOrder, team: game.away?.name, side: 'away',
      oppSp: game.home?.probablePitcher, oppTeam: game.home?.name },
    { pick: homePick, logs: homeLogs, bvp: homeBvp, vsTeam: homeVsTeam,
      order: homeOrder, team: game.home?.name, side: 'home',
      oppSp: game.away?.probablePitcher, oppTeam: game.away?.name },
  ];

  for (const s of sides) {
    const { batters, confirmed } = s.pick;
    for (const b of batters) {
      const streak = readStreaks(s.logs[b.id]);
      // A streak is now the entry ticket. No consecutive run → no badge,
      // however pretty the 10-game rate line is. This is the core of what
      // the user asked for: name a player with a noticeable streak.
      if (!streak) continue;

      const form = scoreForm(b);
      const bvp = scoreBvp(s.bvp[b.id], s.oppSp?.name);
      const vsT = scoreVsTeam(s.vsTeam[b.id], s.oppTeam);
      const ord = scoreOrder(s.order.get(b.id));

      let score = scoreStreak(streak) + form.score + bvp.score + vsT.score + ord.score;
      const angles = [
        { kind: 'streak', direction: 'back', text: streak.label },
        ...bvp.angles, ...vsT.angles, ...ord.angles, ...form.angles,
      ];

      // The whole point is "which points do I look at". A streak with no
      // pitcher/team/order context is a bare trend, so require at least one
      // matchup angle that carries weight before badging it.
      const hasMatchup = angles.some(a =>
        (a.kind === 'bvp' || a.kind === 'vsteam' || a.kind === 'order')
        && a.direction !== 'neutral');
      if (!hasMatchup) score -= 12;

      // An unconfirmed pick is a guess about who plays, so discount it
      // rather than letting bench bats outrank confirmed starters.
      if (!confirmed) score = Math.round(score * 0.75);
      score = Math.max(0, Math.min(100, Math.round(score)));
      if (score < SURFACE_SCORE) continue;

      signals.push({
        kind: 'batter',
        name: b.name,
        team: s.team, side: s.side,
        score,
        confirmed,
        // `caution` says the streak is real but the matchup argues against it —
        // the UI can show it without pretending it's a green light.
        direction: bvp.caution ? 'caution' : 'back',
        // The prop the streak actually points at, so the badge isn't HR-only.
        market: streak.market,
        stat: streak.label,
        streak: { key: streak.key, games: streak.games, label: streak.label, line: streak.line },
        angles,
        why: angles.slice(0, 3).map(a => a.text).join(' · '),
        order: s.order.get(b.id) || null,
        detail: {
          form: { g: b.g, ab: b.ab, h: b.h, hr: b.hr, rbi: b.rbi, ops: b.ops, avg: b.avg },
          streakLine: streak.line,
          bvp: s.bvp[b.id] || null,
          vsTeam: s.vsTeam[b.id] || null,
          vsPitcher: s.oppSp?.name || null,
        },
      });
    }
  }

  for (const [allStarts, p, team, side, oppTeamId, oppName] of [
    [awaySpAll, game.away?.probablePitcher, game.away?.name, 'away', game.home?.id, game.home?.name],
    [homeSpAll, game.home?.probablePitcher, game.home?.name, 'home', game.away?.id, game.away?.name],
  ]) {
    if (!p?.id) continue;
    const recent = (allStarts || []).slice(-5);
    const s = scorePitcher(recent, allStarts, p.name, oppTeamId, oppName);
    if (!s || s.score < SURFACE_SCORE || !s.angles.length) continue;
    signals.push({
      ...s, team, side, confirmed: true,
      why: s.angles.slice(0, 3).map(a => a.text).join(' · '),
    });
  }

  // Rank by score, but break near-ties toward the signal with the most
  // concrete matchup evidence. A streak backed by "10-for-22 off tonight's
  // starter" is a better headline than an equally-scored bare streak, because
  // the whole job of this badge is to name the point worth checking.
  const weight = s => (s.angles || []).reduce((n, a) => {
    if (a.direction === 'neutral') return n;
    return n + (a.kind === 'bvp' ? 3 : a.kind === 'vsteam' ? 2 : a.kind === 'order' ? 1 : 0);
  }, 0);
  signals.sort((a, b) => {
    // Only let evidence decide inside a 6-point band — it must not promote a
    // materially weaker signal just because it has more angles attached.
    if (Math.abs(b.score - a.score) <= 6) {
      const d = weight(b) - weight(a);
      if (d) return d;
    }
    return b.score - a.score;
  });
  const top = signals[0] || null;

  return {
    gamePk: game.gamePk,
    away: game.away?.name,
    home: game.home?.name,
    // Card badge: one headline signal + how many others cleared the bar.
    top,
    count: signals.length,
    // `tier` is what the card actually renders — keeps the threshold logic
    // in one place instead of duplicating cutoffs in the JSX.
    tier: !top ? 'none' : top.score >= 70 ? 'hot' : top.score >= 50 ? 'warm' : 'note',
    signals: signals.slice(0, 6),
  };
}

/* ── Public entry point ─────────────────────────────────────── */

async function getSlateSignals(date, games) {
  const cacheKey = `slate_signals_${date}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const season = new Date(`${date}T12:00:00Z`).getUTCFullYear();

  // Only pre-game matters for research triage — a final has nothing to shop,
  // and this also keeps the fan-out down on a full slate.
  const pending = (games || []).filter(g =>
    !/final|game over|completed/i.test(String(g.status || '')));

  const out = [];
  // Modest concurrency: enough to keep a 15-game slate under a few seconds,
  // low enough not to hammer statsapi (which rate-limits aggressively).
  const CONCURRENCY = 4;
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY);
    const res = await Promise.all(batch.map(g =>
      buildGameSignals(g, season).catch(() => null)));
    for (const r of res) if (r) out.push(r);
  }

  cacheSet(cacheKey, out, SIGNALS_TTL);
  return out;
}

module.exports = { getSlateSignals };
