/* ============================================================
   PLAYIQ — NBA SLATE SIGNALS
   The NBA counterpart of server/mlb/slate-signals.js: "is there a play
   in this game, and WHICH point do I look at?" for the WHOLE slate in
   one request, so the games list can badge each card before it's opened.
   Triage only — the per-game Edge Finder / projection model stays the
   source of truth.

   What a signal is (same contract as MLB):
     A STREAK plus at least one piece of MATCHUP CONTEXT.
       - `streak` — a consecutive-game run read off the player's real ESPN
                    game log (30+/25+/20+ PTS, 10+ REB, 8+ AST, 3+ threes,
                    40+ PRA, double-doubles, or "over his usual line" for
                    role players whose numbers no fixed threshold catches).
                    It is the entry ticket: no run, no badge.
       - `angles` — the labeled reasons to look, each with a `kind`:
           'streak'  — the run itself
           'vsteam'  — his recent games vs TONIGHT'S opponent (this + last
                       season), measured against the streak's own line
           'defense' — the opponent's defense vs HIS position, ranked
                       within that position (from positional-defense.js)
           'role'    — teammate absences. Two-sided on purpose: a key
                       teammate OUT tonight who played during the streak
                       is a usage bump (back); a key teammate who MISSED
                       the whole streak and is available tonight is the
                       classic way a streak dies (fade)
           'minutes' — L5 minutes vs his usual (role growing / shrinking)
           'lineup'  — Rotowire's starting five: confirmed starter, or an
                       injury tag on him (makes the signal provisional)
           'rest'    — 2nd night of a back-to-back
           'form'    — L5 vs his own baseline, supporting detail only
     `market` names the prop the streak points at, and `line` is the
     threshold the streak cleared, so "vs team" compares like with like.

   Design constraints (see CLAUDE.md):
     - zero npm deps, ESPN public JSON through ../shared/http
     - additive: a new endpoint, no existing endpoint changes shape
     - transparent additive scoring, NOT ML; every signal carries `why`
     - affordable slate-wide: one roster call per team + one game-log call
       per player-season, through a global concurrency limiter. Prior-season
       logs are immutable and cached 24h; the positional-defense table is
       NEVER awaited past a short timeout (its first crawl takes minutes —
       the angle is simply absent until it's warm).
   ============================================================ */

const { cacheGet, cacheSet, dedupe } = require('../shared/cache');
const { getPositionalDefense } = require('./positional-defense');
const { getPositionMap, resolvePosition, normalizeName } = require('./positions');
const { getNbaStartingLineups, findGameLineup } = require('./service');

const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const ESPN_WEB = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba';

const SIGNALS_TTL = 10 * 60 * 1000;          // whole-slate result
const SCOREBOARD_TTL = 2 * 60 * 1000;
const ROSTER_TTL = 20 * 60 * 1000;           // injury tags move through the day
const LOG_TTL = 20 * 60 * 1000;              // current-season game log
const PRIOR_LOG_TTL = 24 * 60 * 60 * 1000;   // a finished season never changes
const SIDECAR_TIMEOUT_MS = 2500;             // defense table / position map

// A player needs real, recent minutes for a run to mean anything.
const MIN_PLAYED = 3;
const MIN_MPG = 14;
// A key teammate — the one whose absence actually moves usage.
const KEY_PPG = 15;
const KEY_MPG = 24;
const MIN_VSTEAM_G = 2;
// Defense-vs-position is noise until each team has a few games logged.
const MIN_DEF_GAMES = 4;
const SURFACE_SCORE = 35;

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = n => Math.round(n * 10) / 10;
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const ordinal = n => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
};
const etDate = iso => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : '');

// ESPN → Rotowire / positional-defense abbreviations (same table as
// service.js's findGameLineup). The defense table is keyed Rotowire-style.
const ABBR_ALIAS = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS', PHX: 'PHO' };
const defAbbr = a => ABBR_ALIAS[String(a || '').toUpperCase()] || String(a || '').toUpperCase();

/* ── Concurrency limiter ────────────────────────────────────
   A 14-game slate is ~400 game-log calls cold. ESPN tolerates a steady
   dozen in flight; an unbounded Promise.all of 400 gets throttled. */
function makeLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
  };
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
const limit = makeLimiter(12);

/* JSON over Node's built-in fetch (undici), NOT ../shared/http. Same
   zero-dep rule, one difference that matters here: undici keeps connections
   alive, so ~1000 calls to the same two ESPN hosts reuse a handful of TLS
   sessions instead of doing a fresh handshake each. Fewer connections is
   also gentler on ESPN, not just faster for us. */
async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'PlayIQ/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise.catch(() => null),
    new Promise(resolve => setTimeout(() => resolve(null), ms)),
  ]);
}

/* ── Slate ─────────────────────────────────────────────────── */
async function getScoreboard(date) {
  const ymd = String(date).replace(/-/g, '');
  const cacheKey = `nbasig_board_${ymd}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const data = await fetchJson(`${ESPN_SITE}/scoreboard?dates=${ymd}`);
  const games = (data?.events || []).map(e => {
    const comp = e.competitions?.[0] || {};
    const side = ha => {
      const c = (comp.competitors || []).find(x => x.homeAway === ha) || {};
      return { id: String(c.team?.id || ''), abbr: c.team?.abbreviation || '', name: c.team?.displayName || '' };
    };
    return {
      eventId: String(e.id),
      date: e.date,
      state: e.status?.type?.state || '',
      season: num(e.season?.year),
      seasonType: num(e.season?.type),
      away: side('away'),
      home: side('home'),
    };
  });
  cacheSet(cacheKey, games, SCOREBOARD_TTL);
  return games;
}

/* ── Roster + injury tags (one call per team) ───────────────── */
async function getRoster(teamId) {
  const cacheKey = `nbasig_roster_${teamId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const data = await limit(() => fetchJson(`${ESPN_SITE}/teams/${teamId}/roster`));
  const rows = (data?.athletes || []).map(a => ({
    id: String(a.id),
    name: a.displayName || a.fullName || '',
    pos: a.position?.abbreviation || '',
    // ESPN puts the CURRENT report on the roster: 'Out' | 'Day-To-Day' | …
    injury: a.injuries?.[0]?.status || null,
  }));
  cacheSet(cacheKey, rows, ROSTER_TTL);
  return rows;
}

/* ── Game log (one call per player-season) ──────────────────
   Shooting columns are COMBINED ("2-7" under
   `threePointFieldGoalsMade-threePointFieldGoalsAttempted`) — verified
   against a live payload — so made/attempted are split here rather than
   looked up as separate columns. Newest-first; preseason dropped. */
function parseGameLog(data) {
  const names = (data?.names || []).map(n => String(n).toLowerCase());
  const col = key => names.indexOf(key.toLowerCase());
  const idx = {
    min: col('minutes'), pts: col('points'), reb: col('totalRebounds'), ast: col('assists'),
    stl: col('steals'), blk: col('blocks'), to: col('turnovers'),
    tp: col('threePointFieldGoalsMade-threePointFieldGoalsAttempted'),
  };
  const events = data?.events || {};
  const out = [];
  for (const st of data?.seasonTypes || []) {
    if (/preseason/i.test(st.displayName || '')) continue;
    for (const cat of st.categories || []) {
      for (const ev of cat.events || []) {
        const meta = events[ev.eventId] || {};
        const s = ev.stats || [];
        const n = i => (i < 0 ? 0 : num(parseFloat(s[i])));
        const g = {
          eventId: String(ev.eventId),
          date: meta.gameDate || '',
          oppId: meta.opponent?.id ? String(meta.opponent.id) : null,
          oppAbbr: meta.opponent?.abbreviation || '',
          min: n(idx.min), pts: n(idx.pts), reb: n(idx.reb), ast: n(idx.ast),
          stl: n(idx.stl), blk: n(idx.blk), to: n(idx.to),
          tpm: idx.tp >= 0 ? num(parseInt(String(s[idx.tp] || '').split('-')[0], 10)) : 0,
        };
        g.pra = g.pts + g.reb + g.ast;
        g.dd = [g.pts, g.reb, g.ast, g.stl, g.blk].filter(v => v >= 10).length >= 2 ? 1 : 0;
        out.push(g);
      }
    }
  }
  out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return out;
}

async function getGameLog(playerId, season, prior) {
  const cacheKey = `nbasig_log_${playerId}_${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  return dedupe(cacheKey, async () => {
    const again = cacheGet(cacheKey);
    if (again) return again;
    try {
      const data = await limit(() => fetchJson(`${ESPN_WEB}/athletes/${playerId}/gamelog?season=${season}`));
      const log = parseGameLog(data);
      cacheSet(cacheKey, log, prior ? PRIOR_LOG_TTL : LOG_TTL);
      return log;
    } catch {
      // Don't cache a failure — a transient 5xx would blank him for 20 min.
      return [];
    }
  });
}

/* ── Defense vs position, ranked WITHIN the position ─────────
   The table's own `rank` is across all 150 team×position rows, which
   mixes "allows a lot to centers" with "allows a lot to guards". For a
   prop you want "where does this team sit among the 30 vs PGs", so
   re-rank per position, per stat. 1 = allows the MOST (softest). */
const DEF_FIELDS = { pts: 'points_allowed_per_48', reb: 'reb_per_48', ast: 'ast_per_48', tpm: 'three_pm_per_48' };
const DEF_LABEL = { pts: 'PTS', reb: 'REB', ast: 'AST', tpm: '3PM' };

function buildDefenseIndex(table) {
  if (!table?.rows?.length) return null;
  const idx = {};
  const byPos = {};
  for (const r of table.rows) (byPos[r.position] = byPos[r.position] || []).push(r);
  for (const [pos, rows] of Object.entries(byPos)) {
    for (const [stat, field] of Object.entries(DEF_FIELDS)) {
      const sorted = rows.slice().sort((a, b) => num(b[field]) - num(a[field]));
      sorted.forEach((r, i) => {
        const k = `${r.defensive_team}|${pos}`;
        idx[k] = idx[k] || { games: num(r.games_sampled), n: rows.length };
        idx[k][stat] = { rank: i + 1, per48: num(r[field]) };
      });
    }
  }
  return idx;
}

/* ── Streaks ──────────────────────────────────────────────────
   Current run of consecutive PLAYED games over a prop-shaped line. A DNP
   neither extends nor breaks a run (same convention as the MLB hit
   streak). Picked on run × weight so a 3-game 30-point run outranks a
   6-game 20-point one. */
const FIXED_STREAKS = [
  { key: 'pts30', stat: 'pts', line: 30, market: 'POINTS 29.5+',   min: 2, weight: 4.6, label: n => `30+ PTS in ${n} straight` },
  { key: 'pts25', stat: 'pts', line: 25, market: 'POINTS 24.5+',   min: 3, weight: 3.1, label: n => `25+ PTS in ${n} straight` },
  { key: 'pts20', stat: 'pts', line: 20, market: 'POINTS 19.5+',   min: 4, weight: 2.0, label: n => `20+ PTS in ${n} straight` },
  { key: 'reb12', stat: 'reb', line: 12, market: 'REBOUNDS 11.5+', min: 3, weight: 3.6, label: n => `12+ REB in ${n} straight` },
  { key: 'reb10', stat: 'reb', line: 10, market: 'REBOUNDS 9.5+',  min: 3, weight: 2.6, label: n => `10+ REB in ${n} straight` },
  { key: 'ast10', stat: 'ast', line: 10, market: 'ASSISTS 9.5+',   min: 3, weight: 3.8, label: n => `10+ AST in ${n} straight` },
  { key: 'ast8',  stat: 'ast', line: 8,  market: 'ASSISTS 7.5+',   min: 3, weight: 2.8, label: n => `8+ AST in ${n} straight` },
  { key: 'tpm4',  stat: 'tpm', line: 4,  market: 'THREES 3.5+',    min: 3, weight: 3.6, label: n => `4+ threes in ${n} straight` },
  { key: 'tpm3',  stat: 'tpm', line: 3,  market: 'THREES 2.5+',    min: 3, weight: 2.5, label: n => `3+ threes in ${n} straight` },
  { key: 'pra40', stat: 'pra', line: 40, market: 'PTS+REB+AST 39.5+', min: 3, weight: 2.6, label: n => `40+ PRA in ${n} straight` },
  { key: 'dd',    stat: 'dd',  line: 1,  market: 'DOUBLE-DOUBLE',  min: 3, weight: 2.4, label: n => `double-double in ${n} straight` },
];
const STAT_WORD = { pts: 'PTS', reb: 'REB', ast: 'AST', tpm: 'threes', pra: 'PRA' };
const MARKET_WORD = { pts: 'POINTS', reb: 'REBOUNDS', ast: 'ASSISTS' };
// "Over his usual" only means something above a floor — 4.5 points isn't a prop.
const USUAL_FLOOR = { pts: 8, reb: 5, ast: 4 };

function runLength(played, test) {
  let run = 0;
  for (const g of played) { if (test(g)) run++; else break; }
  return run;
}

/* Baseline per stat: the season so far once it's a real sample, otherwise
   last season — on Nov 4 "his season average" is six games, and a six-game
   run would be measured against itself. */
function baselineOf(cur, prev, stat) {
  if (cur.length >= 15) return { value: mean(cur.map(g => g[stat])), src: 'season' };
  if (prev.length >= 15) return { value: mean(prev.map(g => g[stat])), src: 'last season' };
  if (cur.length + prev.length >= 10) return { value: mean([...cur, ...prev].map(g => g[stat])), src: 'recent' };
  return null;
}

function readStreak(cur, prev) {
  if (cur.length < MIN_PLAYED) return null;
  let best = null;
  const consider = (def, run) => {
    if (run < def.min) return;
    const rank = run * def.weight;
    if (!best || rank > best.rank) best = { ...def, run, rank };
  };
  for (const def of FIXED_STREAKS) consider(def, runLength(cur, g => g[def.stat] >= def.line));

  // Role players: over a line set at his own baseline. A book hangs his
  // line near that baseline, so "over it N straight" is the bet shape.
  for (const stat of ['pts', 'reb', 'ast']) {
    const base = baselineOf(cur, prev, stat);
    if (!base || base.value < USUAL_FLOOR[stat]) continue;
    const line = Math.floor(base.value) + 0.5;
    consider({
      key: `usual_${stat}`, stat, line: Math.ceil(line), usual: true, min: 4, weight: 1.5,
      market: `${MARKET_WORD[stat]} ${line}+`,
      label: n => `over ${line} ${STAT_WORD[stat]} (his ${base.src} avg ${r1(base.value)}) in ${n} straight`,
    }, runLength(cur, g => g[stat] > line));
  }
  if (!best) return null;

  const window = cur.slice(0, best.run);
  return {
    key: best.key, stat: best.stat, line: best.line, market: best.market,
    games: best.run, rank: best.rank, label: best.label(best.run),
    eventIds: window.map(g => g.eventId),
    values: window.map(g => g[best.stat]),
  };
}

function scoreStreak(streak) {
  // Capped well below 100 so matchup context is what pushes a signal to HOT.
  return streak ? Math.min(45, Math.round(streak.rank * 3)) : 0;
}

/* ── Angles ─────────────────────────────────────────────────── */

// Recent meetings with tonight's opponent, judged against the STREAK'S OWN
// line — "averages 27 vs BOS" says nothing about a 10+ REB streak.
function scoreVsTeam(cur, prev, oppId, oppAbbr, streak) {
  const games = [...cur, ...prev].filter(g => g.oppId === oppId).slice(0, 5);
  if (games.length < MIN_VSTEAM_G) return { score: 0, angles: [], caution: false };
  const vals = games.map(g => g[streak.stat]);
  const avg = mean(vals);
  const hits = vals.filter(v => v >= streak.line).length;
  const n = games.length;
  const word = streak.stat === 'dd' ? 'double-doubles' : STAT_WORD[streak.stat];
  const desc = streak.stat === 'dd'
    ? `${hits} double-double${hits === 1 ? '' : 's'} in last ${n} vs ${oppAbbr}`
    : `${r1(avg)} ${word} in last ${n} vs ${oppAbbr} (${streak.line}+ in ${hits})`;
  const rate = hits / n;
  if (rate >= 0.67 && (streak.stat === 'dd' || avg >= streak.line)) {
    return { score: Math.min(18, 8 + n * 2), caution: false, angles: [{ kind: 'vsteam', direction: 'back', text: desc }] };
  }
  if (rate <= 0.34 && (streak.stat === 'dd' || avg < streak.line * 0.85)) {
    return { score: -10, caution: true, angles: [{ kind: 'vsteam', direction: 'fade', text: desc }] };
  }
  return { score: 0, caution: false, angles: [{ kind: 'vsteam', direction: 'neutral', text: desc }] };
}

function scoreDefense(defIdx, oppAbbr, pos, streak) {
  if (!defIdx || !pos) return { score: 0, angles: [], caution: false };
  const row = defIdx[`${defAbbr(oppAbbr)}|${pos}`];
  // PRA / double-double ride on scoring and the glass respectively.
  const stat = streak.stat === 'pra' ? 'pts' : streak.stat === 'dd' ? 'reb' : streak.stat;
  const cell = row?.[stat];
  if (!cell || row.games < MIN_DEF_GAMES) return { score: 0, angles: [], caution: false };
  const { rank } = cell;
  const n = row.n;
  if (rank <= 6) {
    return { score: Math.min(15, 6 + (7 - rank) * 1.5), caution: false,
      angles: [{ kind: 'defense', direction: 'back',
        text: `${oppAbbr} allows the ${rank === 1 ? '' : `${ordinal(rank)}-`}most ${DEF_LABEL[stat]} to ${pos}s` }] };
  }
  if (rank > n - 6) {
    const fromBottom = n - rank + 1;
    return { score: -10, caution: true,
      angles: [{ kind: 'defense', direction: 'fade',
        text: `${oppAbbr} allows the ${fromBottom === 1 ? '' : `${ordinal(fromBottom)}-`}fewest ${DEF_LABEL[stat]} to ${pos}s` }] };
  }
  return { score: 0, caution: false,
    angles: [{ kind: 'defense', direction: 'neutral', text: `${oppAbbr} ${ordinal(rank)} of ${n} in ${DEF_LABEL[stat]} allowed to ${pos}s` }] };
}

/* Teammate absences. The NBA angle MLB doesn't have, and the one that most
   often explains a streak: usage has to go somewhere. Judged against the
   streak WINDOW, so it can tell "he's been feasting since X went down"
   (stable while X is out, a red flag the night X returns) from "X just
   went out tonight" (new usage). */
function scoreRole(player, streak, teammates) {
  const angles = [];
  let score = 0;
  let caution = false;
  const window = new Set(streak.eventIds);
  for (const t of teammates) {
    if (t.id === player.id || !t.key) continue;
    const playedInWindow = t.eventIds.filter(id => window.has(id)).length;
    const out = /^out/i.test(t.injury || '');
    if (out && playedInWindow >= Math.ceil(window.size / 2)) {
      score += 10;
      angles.push({ kind: 'role', direction: 'back', text: `${t.name} OUT tonight (${r1(t.ppg)} PPG, played in this run)` });
    } else if (out && playedInWindow === 0) {
      angles.push({ kind: 'role', direction: 'neutral', text: `run came with ${t.name} out — still OUT` });
    } else if (!out && playedInWindow === 0 && window.size >= 3) {
      score -= 10;
      caution = true;
      angles.push({ kind: 'role', direction: 'fade',
        text: `${t.name} ${t.injury ? `(${t.injury}) ` : ''}missed all ${window.size} games of this run` });
    }
  }
  // Most actionable first, and keep it to two lines.
  const order = { back: 0, fade: 1, neutral: 2 };
  angles.sort((a, b) => order[a.direction] - order[b.direction]);
  return { score, caution, angles: angles.slice(0, 2) };
}

function scoreMinutes(cur, prev) {
  const l5 = cur.slice(0, 5);
  if (l5.length < 3) return { score: 0, angles: [] };
  const base = cur.length >= 15 ? mean(cur.map(g => g.min)) : prev.length >= 15 ? mean(prev.map(g => g.min)) : null;
  if (base == null) return { score: 0, angles: [] };
  const m = mean(l5.map(g => g.min));
  if (m - base >= 4) {
    return { score: 6, angles: [{ kind: 'minutes', direction: 'back', text: `minutes up: ${r1(m)} L${l5.length} vs ${r1(base)} usual` }] };
  }
  if (base - m >= 5) {
    return { score: -4, angles: [{ kind: 'minutes', direction: 'fade', text: `minutes down: ${r1(m)} L${l5.length} vs ${r1(base)} usual` }] };
  }
  return { score: 0, angles: [] };
}

function scoreRest(cur, gameDate) {
  const last = cur[0];
  if (!last) return { score: 0, angles: [] };
  const today = new Date(`${etDate(gameDate)}T12:00:00Z`);
  const yesterday = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
  if (etDate(last.date) === yesterday) {
    return { score: -6, angles: [{ kind: 'rest', direction: 'fade', text: '2nd night of a back-to-back' }] };
  }
  return { score: 0, angles: [] };
}

function scoreForm(cur, prev, streak) {
  if (streak.stat === 'dd') return { score: 0, angles: [] };
  const base = baselineOf(cur, prev, streak.stat);
  const l5 = cur.slice(0, 5);
  if (!base || base.value <= 0 || l5.length < 3) return { score: 0, angles: [] };
  const m = mean(l5.map(g => g[streak.stat]));
  const lift = m / base.value - 1;
  if (lift < 0.15) return { score: 0, angles: [] };
  return { score: Math.min(10, Math.round(lift * 25)),
    angles: [{ kind: 'form', direction: 'back',
      text: `${r1(m)} ${STAT_WORD[streak.stat]} L${l5.length} vs ${r1(base.value)} ${base.src === 'season' ? 'season' : 'baseline'}` }] };
}

/* Rotowire's starting five, when posted: confirms the role, and its injury
   tag (GTD / QUES / …) is the earliest warning we get. */
function scoreLineup(lineupSide, player) {
  if (!lineupSide?.starters?.length) return { score: 0, angles: [], starter: null, flagged: false };
  const key = normalizeName(player.name);
  const s = lineupSide.starters.find(x => normalizeName(x.name) === key);
  if (!s) return { score: 0, angles: [], starter: null, flagged: false };
  if (s.injuryStatus) {
    return { score: 0, starter: s, flagged: true,
      angles: [{ kind: 'lineup', direction: 'fade', text: `listed ${s.injuryStatus} in projected five` }] };
  }
  const confirmed = lineupSide.status === 'confirmed';
  return { score: confirmed ? 4 : 0, starter: s, flagged: false,
    angles: [{ kind: 'lineup', direction: confirmed ? 'back' : 'neutral',
      text: `${confirmed ? 'confirmed' : 'projected'} starter at ${s.pos}` }] };
}

/* ── Per-game assembly ──────────────────────────────────────── */
// 'minutes' counts like MLB's lineup spot: a bigger role is opportunity.
const MATCHUP_KINDS = new Set(['vsteam', 'defense', 'role', 'minutes']);

/* Last season's log is only read for (a) players who can carry a signal —
   for their baseline and older meetings with tonight's opponent — and (b)
   players with almost no games this season, whose "key teammate" status has
   to come from last year (the star who's been hurt since opening night).
   Everyone else — healthy bench minutes — can't be either, so skipping
   their prior season changes no output and cuts ~40% of the calls. */
function needsPriorSeason(p, cur) {
  if (cur.length < MIN_PLAYED) return true;
  if (/^out/i.test(p.injury || '')) return false;
  return mean(cur.map(g => g.min)) >= MIN_MPG;
}

async function buildTeamContext(team, season) {
  const roster = await getRoster(team.id);
  const players = await Promise.all(roster.map(async p => {
    const curAll = await getGameLog(p.id, season, false);
    const cur = curAll.filter(g => g.min > 0);
    const prevAll = needsPriorSeason(p, cur) ? await getGameLog(p.id, season - 1, true) : [];
    const prev = prevAll.filter(g => g.min > 0);
    const basis = cur.length >= 3 ? cur : prev;
    const ppg = mean(basis.map(g => g.pts));
    const mpg = mean(basis.map(g => g.min));
    return {
      ...p, cur, prev, ppg, mpg,
      eventIds: cur.map(g => g.eventId),
      // A teammate whose absence moves usage. Needs a real sample on one side.
      key: (cur.length >= 3 || prev.length >= 20) && ppg >= KEY_PPG && mpg >= KEY_MPG,
    };
  }));
  return players;
}

async function buildGameSignals(game, ctx) {
  const [awayCtx, homeCtx] = await Promise.all([
    buildTeamContext(game.away, game.season),
    buildTeamContext(game.home, game.season),
  ]);
  const lineup = findGameLineup(ctx.lineups, game.away.abbr, game.home.abbr);

  const signals = [];
  const sides = [
    { ctx: awayCtx, team: game.away, opp: game.home, side: 'away', lu: lineup?.away },
    { ctx: homeCtx, team: game.home, opp: game.away, side: 'home', lu: lineup?.home },
  ];

  for (const s of sides) {
    for (const p of s.ctx) {
      if (/^out/i.test(p.injury || '')) continue;
      if (p.cur.length < MIN_PLAYED || mean(p.cur.map(g => g.min)) < MIN_MPG) continue;
      const streak = readStreak(p.cur, p.prev);
      // The streak is the entry ticket — exactly as in the MLB scorer.
      if (!streak) continue;

      const lu = scoreLineup(s.lu, p);
      const pos = lu.starter?.pos || resolvePosition(p.name, ctx.positionMap) || null;
      const vsT = scoreVsTeam(p.cur, p.prev, s.opp.id, s.opp.abbr, streak);
      const def = scoreDefense(ctx.defIdx, s.opp.abbr, pos, streak);
      const role = scoreRole(p, streak, s.ctx);
      const mins = scoreMinutes(p.cur, p.prev);
      const rest = scoreRest(p.cur, game.date);
      const form = scoreForm(p.cur, p.prev, streak);

      let score = scoreStreak(streak) + vsT.score + def.score + role.score
        + mins.score + rest.score + form.score + lu.score;
      const angles = [
        { kind: 'streak', direction: 'back', text: streak.label },
        ...role.angles, ...vsT.angles, ...def.angles, ...lu.angles,
        ...mins.angles, ...rest.angles, ...form.angles,
      ];

      // A bare run is a trend, not a play: require one weighted matchup angle.
      const hasMatchup = angles.some(a => MATCHUP_KINDS.has(a.kind) && a.direction !== 'neutral');
      if (!hasMatchup) score -= 12;

      // Questionable / GTD → provisional, discounted like an unposted MLB lineup.
      const confirmed = !p.injury && !lu.flagged;
      if (!confirmed) score = Math.round(score * 0.75);
      score = Math.max(0, Math.min(100, Math.round(score)));
      if (score < SURFACE_SCORE) continue;

      const caution = vsT.caution || def.caution || role.caution;
      signals.push({
        kind: 'player',
        name: p.name,
        team: s.team.name, side: s.side, pos,
        score,
        confirmed,
        direction: caution ? 'caution' : 'back',
        market: streak.market,
        stat: streak.label,
        streak: { key: streak.key, games: streak.games, label: streak.label,
          line: { stat: streak.stat, threshold: streak.line, values: streak.values } },
        angles,
        why: angles.slice(0, 3).map(a => a.text).join(' · '),
        order: null,
        detail: {
          injury: p.injury || lu.starter?.injuryStatus || null,
          gamesPlayed: p.cur.length,
          mpg: r1(mean(p.cur.map(g => g.min))),
          l5: p.cur.slice(0, 5).map(g => ({ date: etDate(g.date), opp: g.oppAbbr,
            pts: g.pts, reb: g.reb, ast: g.ast, tpm: g.tpm, min: g.min })),
        },
      });
    }
  }

  // Same tie-break as MLB: inside a 6-point band, prefer the signal with
  // more concrete matchup evidence.
  const weight = sig => (sig.angles || []).reduce((n, a) => {
    if (a.direction === 'neutral') return n;
    return n + (a.kind === 'vsteam' ? 3 : a.kind === 'defense' ? 2 : a.kind === 'role' ? 2 : 0);
  }, 0);
  signals.sort((a, b) => {
    if (Math.abs(b.score - a.score) <= 6) {
      const d = weight(b) - weight(a);
      if (d) return d;
    }
    return b.score - a.score;
  });
  const top = signals[0] || null;

  return {
    eventId: game.eventId,
    away: game.away.name, home: game.home.name,
    awayAbbr: game.away.abbr, homeAbbr: game.home.abbr,
    top,
    count: signals.length,
    tier: !top ? 'none' : top.score >= 70 ? 'hot' : top.score >= 50 ? 'warm' : 'note',
    signals: signals.slice(0, 6),
  };
}

/* ── Public entry point ───────────────────────────────────────
   Three things make this feel fast without making it fetch more:

   1. PROGRESSIVE. A build runs as a background job; games finish one by one
      (earliest tip first, through a 4-wide worker pool) and a request that
      arrives mid-build gets what's done so far plus `pendingEventIds`, so
      cards fill in instead of the whole slate waiting on its slowest game.
   2. STALE-WHILE-REVALIDATE. After the first build, a request past the
      10-minute freshness window gets the previous result instantly
      (`refreshing: true`) while one rebuild runs behind it.
   3. WARM, BUT ONLY WHEN WATCHED. `startNbaSignalsWarmer` builds today's
      slate at server start, then rebuilds only while someone has asked for
      that day in the last 30 minutes. An idle server makes no calls. The
      rebuild cadence is the same 10 minutes a viewer's own refresh would
      cause — no extra load on ESPN, it just happens before you look. */
const FRESH_MS = SIGNALS_TTL;
const STALE_KEEP_MS = 6 * 60 * 60 * 1000;
const WATCH_WINDOW_MS = 30 * 60 * 1000;
const PARTIAL_WAIT_MS = 1500;

const jobs = new Map();       // day -> running build
const results = new Map();    // day -> { result, at }  (last COMPLETE build)
const lastAsked = new Map();  // day -> ts of the last real request

const todayEt = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startBuild(day) {
  if (jobs.has(day)) return jobs.get(day);
  const job = { done: new Map(), pendingIds: new Set(), finished: false, sources: null };
  job.promise = (async () => {
    const board = await getScoreboard(day);
    // Pre-game only: a live or final game has nothing left to research.
    // Earliest tip first — those are the games that need research soonest.
    const pending = board.filter(g => g.state === 'pre' && g.away.id && g.home.id)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    pending.forEach(g => job.pendingIds.add(g.eventId));

    // Sidecars. None may hold the slate hostage: the defense table's first
    // crawl takes minutes, Basketball-Reference and Rotowire can be slow or
    // down. Each is raced against a short timeout; missing → that angle is
    // just absent. (The defense crawl keeps running and fills its cache, so
    // the next rebuild picks it up.)
    const [table, positionMap, lineups] = await Promise.all([
      withTimeout(getPositionalDefense({}), SIDECAR_TIMEOUT_MS),
      withTimeout(getPositionMap({}), SIDECAR_TIMEOUT_MS),
      withTimeout(getNbaStartingLineups({}), SIDECAR_TIMEOUT_MS),
    ]);
    const ctx = { defIdx: buildDefenseIndex(table), positionMap, lineups };
    job.sources = { defense: !!ctx.defIdx, positions: !!positionMap, lineups: !!lineups };

    // Worker pool, not fixed batches: one slow game must not idle the others.
    const queue = pending.slice();
    const worker = async () => {
      for (let g = queue.shift(); g; g = queue.shift()) {
        try {
          job.done.set(g.eventId, await buildGameSignals(g, ctx));
        } catch (err) {
          console.error('[nba/slate-signals]', g.eventId, err?.message || err);
        }
        job.pendingIds.delete(g.eventId);
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));

    const result = {
      date: day,
      sources: job.sources,
      // Slate order (tip time), whatever order the workers finished in.
      signals: pending.map(g => job.done.get(g.eventId)).filter(Boolean),
    };
    // A slate built without the defense table is incomplete — mark it fresh
    // for only 2 min so the angle appears soon after the crawl lands.
    results.set(day, { result, at: Date.now(), freshMs: ctx.defIdx ? FRESH_MS : 2 * 60 * 1000 });
    return result;
  })().finally(() => { job.finished = true; jobs.delete(day); });
  job.promise.catch(err => console.error('[nba/slate-signals] build failed', day, err?.message || err));
  jobs.set(day, job);
  return job;
}

function snapshot(day, job) {
  return {
    date: day,
    partial: true,
    sources: job.sources,
    pendingEventIds: [...job.pendingIds],
    signals: [...job.done.values()],
  };
}

async function getNbaSlateSignals(date, { waitMs = PARTIAL_WAIT_MS } = {}) {
  const day = date || todayEt();
  lastAsked.set(day, Date.now());

  const prev = results.get(day);
  const age = prev ? Date.now() - prev.at : Infinity;
  if (prev && age < prev.freshMs) return prev.result;
  if (prev && age < STALE_KEEP_MS) {
    startBuild(day);                               // refresh behind the user
    return { ...prev.result, refreshing: true };
  }

  const job = startBuild(day);
  // A warm build often finishes inside this window; otherwise hand back
  // whatever games are done and let the client poll for the rest.
  await Promise.race([job.promise.catch(() => null), sleep(waitMs)]);
  if (results.get(day) && job.finished) return results.get(day).result;
  if (job.finished) throw new Error('NBA slate build failed');
  return snapshot(day, job);
}

let warmerTimer = null;
function startNbaSignalsWarmer() {
  if (warmerTimer) return;
  const tick = () => {
    const now = Date.now();
    const today = todayEt();
    for (const [day, ts] of lastAsked) {
      if (now - ts > WATCH_WINDOW_MS) { lastAsked.delete(day); continue; }
      const prev = results.get(day);
      if (!prev || now - prev.at >= prev.freshMs) startBuild(day);
    }
    // Old days fall out of memory once nobody is looking at them.
    for (const [day, r] of results) {
      if (day !== today && now - r.at > STALE_KEEP_MS) results.delete(day);
    }
  };
  // Server start: build today once so the first viewer isn't the one who pays
  // for the cold slate (on Render, the first request after a sleep).
  startBuild(todayEt());
  warmerTimer = setInterval(tick, 60 * 1000);
  warmerTimer.unref?.();
}

module.exports = { getNbaSlateSignals, startNbaSignalsWarmer, _internals: { readStreak, parseGameLog, buildDefenseIndex, scoreRole } };
