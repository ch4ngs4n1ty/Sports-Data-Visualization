/* ============================================================
   PLAYIQ — MLB SLATE SIGNALS
   "Is there a play in this game?" — computed for the WHOLE slate in
   one request so the games list can badge each card before the user
   opens it. Purely a triage signal: it says where to look first, it
   does not replace the per-game Edge Finder / prop models.

   Design constraints (see CLAUDE.md):
     - zero npm deps, pure fetch through ../shared/http
     - additive: does not mutate getGames() or any existing endpoint
     - every signal carries its own `why` string, so the UI can explain
       the badge instead of showing an unfalsifiable score
   ============================================================ */

const { cacheGet, cacheSet } = require('../shared/cache');
const { fetchJson } = require('../shared/http');

const MLB_API = 'https://statsapi.mlb.com/api/v1';

const SIGNALS_TTL = 10 * 60 * 1000;      // whole-slate result
const TEAM_FORM_TTL = 30 * 60 * 1000;    // per-team last-10 hitting
const SP_FORM_TTL = 6 * 60 * 60 * 1000;  // per-pitcher start log

// A hitter needs enough recent volume for a hot line to mean anything.
const MIN_RECENT_G = 5;
const MIN_RECENT_AB = 15;
// A starter needs real innings in the window, not two relief cameos.
const MIN_SP_STARTS = 3;

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = n => Math.round(n * 10) / 10;
const r3 = n => Math.round(n * 1000) / 1000;

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

/* Score a hitter's last-10 line into a 0-100 "heat" number.

   Deliberately transparent and additive rather than a fitted model:
   OPS carries most of the weight (it is the single best short-window
   summary of a hitter producing), with explicit kickers for the two
   things a bettor actually shops props on — power and RBI volume. */
function scoreHitter(b) {
  let score = 0;
  const reasons = [];

  // OPS over the window. 0.800 is the "interesting" floor; 1.200 saturates.
  if (b.ops >= 0.8) {
    score += Math.min(45, (b.ops - 0.8) * 112.5);
    if (b.ops >= 0.9) reasons.push(`${b.ops.toFixed(3)} OPS L10`);
  }
  // Batting average over the window — drives hit props.
  if (b.avg >= 0.3) {
    score += Math.min(25, (b.avg - 0.3) * 200);
    reasons.push(`.${String(Math.round(b.avg * 1000)).padStart(3, '0')} (${b.h}-for-${b.ab})`);
  }
  // Power: HR in the window.
  if (b.hr >= 2) {
    score += Math.min(20, b.hr * 5);
    reasons.push(`${b.hr} HR`);
  }
  // Run production.
  if (b.rbi >= 8) {
    score += Math.min(15, (b.rbi - 6) * 2);
    reasons.push(`${b.rbi} RBI`);
  }
  // Strikeout-heavy stretches are a real drag on contact props.
  if (b.ab > 0 && b.k / b.ab > 0.33) score -= 10;

  // Clamp to 0-100 so the UI can treat the score as a percentage safely.
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
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

/* Score a starter's recent run into 0-100 heat.

   Weighted toward strikeout rate because K props are the most commonly
   shopped pitcher market, then run prevention (which drives the ML/F5
   read the High Contact tab already models). */
function scorePitcher(starts, name) {
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
  const reasons = [];

  // Strikeout rate. League-average K/BF is ~.22; .28+ is a plus-K arm.
  if (kRate >= 0.26) {
    score += Math.min(40, (kRate - 0.26) * 400);
    reasons.push(`${k9} K/9`);
  }
  // Run prevention over the window.
  if (era <= 3.0) {
    score += Math.min(35, (3.0 - era) * 15);
    reasons.push(`${era.toFixed(2)} ERA L${starts.length}`);
  } else if (era >= 6.0) {
    // A starter getting hit hard is just as actionable — it points at the
    // opposing offense. Flagged separately so the UI can label it FADE.
    // Scored on the same 0-100 footing as a hot arm: 6.00 ERA already clears
    // the surfacing bar on its own, because an ERA that high over a multi-start
    // window is a strong signal, and the K/volume kickers below never apply to
    // a pitcher this bad (they'd otherwise be the only way to reach it).
    score += Math.min(55, 40 + (era - 6.0) * 5);
    reasons.push(`${era.toFixed(2)} ERA L${starts.length} (vulnerable)`);
  }
  // Volume: a starter who goes deep gives K/outs props room to clear.
  if (ipPerStart >= 6.0) {
    score += 12;
    reasons.push(`${ipPerStart} IP/start`);
  }

  const cold = era >= 6.0;
  return {
    kind: 'pitcher',
    name,
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
    direction: cold ? 'fade' : 'back',
    stat: cold ? `${era.toFixed(2)} ERA` : `${k9} K/9`,
    detail: { era, k9, ip: r1(ip), starts: starts.length, ipPerStart },
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

  const [awayHit, homeHit, awaySp, homeSp] = await Promise.all([
    getTeamRecentHitting(game.away?.id, season),
    getTeamRecentHitting(game.home?.id, season),
    getPitcherRecentStarts(game.away?.probablePitcher?.id, season),
    getPitcherRecentStarts(game.home?.probablePitcher?.id, season),
  ]);

  const signals = [];

  for (const [rows, ids, team, side] of [
    [awayHit, awayIds, game.away?.name, 'away'],
    [homeHit, homeIds, game.home?.name, 'home'],
  ]) {
    const { batters, confirmed } = pickBatters(rows, ids);
    for (const b of batters) {
      const { score, reasons } = scoreHitter(b);
      if (score < 35 || !reasons.length) continue;
      signals.push({
        kind: 'batter',
        name: b.name,
        team, side,
        // An unconfirmed pick is a guess about who plays, so discount it
        // rather than letting bench bats outrank confirmed starters.
        score: confirmed ? score : Math.round(score * 0.75),
        confirmed,
        direction: 'back',
        stat: b.hr >= 2 ? `${b.hr} HR L10` : `${b.ops.toFixed(3)} OPS L10`,
        reasons,
        why: reasons.join(' · '),
        detail: { g: b.g, ab: b.ab, h: b.h, hr: b.hr, rbi: b.rbi, ops: b.ops, avg: b.avg },
      });
    }
  }

  for (const [starts, p, team, side] of [
    [awaySp, game.away?.probablePitcher, game.away?.name, 'away'],
    [homeSp, game.home?.probablePitcher, game.home?.name, 'home'],
  ]) {
    if (!p?.id) continue;
    const s = scorePitcher(starts, p.name);
    if (!s || s.score < 35 || !s.reasons.length) continue;
    signals.push({ ...s, team, side, confirmed: true, why: s.reasons.join(' · ') });
  }

  signals.sort((a, b) => b.score - a.score);
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
