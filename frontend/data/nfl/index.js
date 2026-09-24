// NFL-only data helpers.
//
// Two things make football different from the sports already wired up, and both
// are handled here rather than by bending the shared helpers:
//
//  1. NFL is WEEKLY, not daily. A date-keyed scoreboard query returns an empty
//     slate on the ~4 days a week nobody plays, so `fetchNflWeek` queries by
//     week number and the games screen shows the whole week's slate.
//  2. Football box scores are SPLIT INTO STAT GROUPS (passing / rushing /
//     receiving / defensive / ...), each with its own `labels` array. The
//     shared `enrichFormWithPlayerStats` reads `statistics[0]` only, which for
//     NFL is passing alone — so form enrichment gets its own parser here.

// ESPN's scoreboard exposes the season calendar; `seasontype` 1=pre 2=reg 3=post.
const NFL_SEASON_TYPES = { PRE: 1, REG: 2, POST: 3 };

// Resolve which week is "current" straight from ESPN rather than computing it
// from a hardcoded season-start date (which drifts every year and breaks in
// January when the playoffs restart the week counter).
async function fetchNflCurrentWeek() {
  const data = await espnFetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
  if (!data) return null;
  return {
    week: data.week?.number ?? null,
    seasonType: data.season?.type ?? NFL_SEASON_TYPES.REG,
    seasonYear: data.season?.year ?? getSeasonYear('nfl'),
    typeLabel: data.leagues?.[0]?.season?.type?.name || 'Regular Season',
  };
}

// One week's slate, shaped to match what `fetchAllGames` returns so the games
// screen and game-detail screen can consume NFL games without special-casing.
async function fetchNflWeek({ week, seasonType, seasonYear } = {}) {
  let wk = week, st = seasonType, yr = seasonYear;
  if (wk == null) {
    const cur = await fetchNflCurrentWeek();
    if (!cur) return [];
    wk = cur.week; st = cur.seasonType; yr = cur.seasonYear;
  }
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`
    + `?week=${wk}&seasontype=${st ?? NFL_SEASON_TYPES.REG}&dates=${yr ?? getSeasonYear('nfl')}`;
  const data = await espnFetch(url);
  const events = data?.events || [];
  const games = [];
  for (const ev of events) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) continue;
    const odds = comp.odds?.[0];
    const parseScore = s => {
      const v = parseInt(s?.displayValue ?? s ?? '', 10);
      return Number.isNaN(v) ? null : v;
    };
    games.push({
      sportKey: 'nfl', sportLabel: 'NFL', sport: 'football', league: 'nfl',
      eventId: ev.id,
      awayFull: away.team.displayName, awayAbbr: away.team.abbreviation, awayTeamId: away.team.id,
      awayScore: parseScore(away.score), awayLogo: teamLogoUrl('nfl', away.team.abbreviation, away.team.id),
      awayRecord: away.records?.[0]?.summary || '',
      homeFull: home.team.displayName, homeAbbr: home.team.abbreviation, homeTeamId: home.team.id,
      homeScore: parseScore(home.score), homeLogo: teamLogoUrl('nfl', home.team.abbreviation, home.team.id),
      homeRecord: home.records?.[0]?.summary || '',
      statusText: ev.status?.type?.description || 'Scheduled',
      statusState: ev.status?.type?.state,
      statusDetail: ev.status?.type?.shortDetail || '',
      date: ev.date, venue: comp.venue?.fullName,
      spread: odds?.details, overUnder: odds?.overUnder,
      awayMoneyline: odds?.awayTeamOdds?.moneyLine,
      homeMoneyline: odds?.homeTeamOdds?.moneyLine,
      nflWeek: wk,
      broadcast: comp.broadcasts?.[0]?.names?.[0] || '',
    });
  }
  // Kickoff order, so Thursday night reads first and Monday night last.
  games.sort((a, b) => new Date(a.date) - new Date(b.date));
  return games;
}

// Which box-score group + label each headline stat lives in. Football has no
// single "best player" the way PTS or H does, so we surface one leader per
// phase of the game: passing yards, rushing yards, receiving yards.
// `label` is what the FormTab stat buttons show, so it stays short.
const NFL_FORM_CATS = [
  { key: 'pass', label: 'PASS', group: 'passing', statLabel: 'YDS' },
  { key: 'rush', label: 'RUSH', group: 'rushing', statLabel: 'YDS' },
  { key: 'rec', label: 'REC', group: 'receiving', statLabel: 'YDS' },
];

// Football-aware replacement for the shared enrichFormWithPlayerStats. Walks
// the named stat group (not statistics[0]) and finds that group's leader.
async function enrichNflFormWithPlayerStats(teamId, formGames) {
  const summaries = await Promise.all(
    formGames.map(g => g.eventId
      ? espnFetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${g.eventId}`)
      : Promise.resolve(null))
  );
  return formGames.map((g, i) => {
    const summary = summaries[i];
    const teamPlayers = summary?.boxscore?.players?.find(p => String(p.team?.id) === String(teamId));
    if (!teamPlayers) return { ...g, player: null };
    const player = {};
    for (const cat of NFL_FORM_CATS) {
      const grp = (teamPlayers.statistics || []).find(s => s.name === cat.group);
      if (!grp) continue;
      const idx = (grp.labels || []).indexOf(cat.statLabel);
      if (idx === -1) continue;
      let best = null, max = -1;
      for (const ath of grp.athletes || []) {
        // Football yardage can be negative (sacks, losses) — parseInt handles
        // the sign, and we still want the max, so seed max at -1 not 0.
        const val = parseInt(ath.stats?.[idx] ?? '', 10);
        if (Number.isNaN(val)) continue;
        if (val > max) {
          max = val;
          const a = ath.athlete || {};
          best = {
            name: a.shortName || a.displayName || '?',
            headshot: a.headshot?.href || null,
            value: val,
          };
        }
      }
      if (best && max > 0) player[cat.key] = { ...best, label: cat.label };
    }
    // `cats` tells the shared FormTab which stat buttons to show. Without it
    // FormTab falls back to basketball keys (pts/reb/ast), which NFL never
    // sets — every card would render empty.
    return {
      ...g,
      cats: NFL_FORM_CATS.map(c => ({ key: c.key, label: c.label })),
      player: Object.keys(player).length ? player : null,
    };
  });
}

// Season-level team profile used by the NFL Matchup tab: record plus offensive
// production and what opponents have managed against this team (defense).
async function fetchNflTeamProfile(teamId) {
  const [teamData, statsData] = await Promise.all([
    espnFetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}`),
    espnFetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/statistics`),
  ]);
  const team = teamData?.team;
  const rec = team?.record?.items?.[0];

  // NOTE: this endpoint publishes NO `rank` field — verified against a live
  // payload. Don't reintroduce rank rendering without re-checking.
  //
  // `results.stats` is what this team did; `results.opponent` mirrors the same
  // tree for what opponents did AGAINST them, which is the only defensive
  // data ESPN exposes here (including points allowed).
  const index = categories => {
    const out = {};
    for (const cat of categories || []) {
      for (const st of cat.stats || []) {
        out[`${cat.name}.${st.name}`] = {
          value: st.value,
          display: st.displayValue,
          label: st.displayName || st.name,
        };
      }
    }
    return out;
  };
  const byName = index(statsData?.results?.stats?.categories);
  const oppByName = index(statsData?.results?.opponent);
  const pick = (...keys) => {
    for (const k of keys) if (byName[k]) return byName[k];
    return null;
  };
  const pickOpp = (...keys) => {
    for (const k of keys) if (oppByName[k]) return oppByName[k];
    return null;
  };
  return {
    teamId,
    name: team?.displayName || '',
    abbr: team?.abbreviation || '',
    record: rec?.summary || '',
    // Category placement is NOT intuitive here and was read off a live payload,
    // not guessed: `totalYards` sits under `rushing`, and the third-down /
    // turnover stats sit under `miscellaneous`.
    // OFFENSE
    pointsFor: pick('scoring.totalPointsPerGame', 'scoring.totalPoints'),
    totalYards: pick('rushing.totalYards'),
    passYards: pick('passing.netPassingYardsPerGame'),
    rushYards: pick('rushing.rushingYardsPerGame'),
    thirdDown: pick('miscellaneous.thirdDownConvPct'),
    turnoverDiff: pick('miscellaneous.turnOverDifferential'),
    takeaways: pick('miscellaneous.totalTakeaways'),
    sacks: pick('defensive.sacks', 'passing.sacks'),
    // DEFENSE — what opponents managed against this team.
    pointsAgainst: pickOpp('scoring.totalPointsPerGame', 'scoring.totalPoints'),
    yardsAllowed: pickOpp('rushing.totalYards'),
    passYardsAllowed: pickOpp('passing.netPassingYardsPerGame'),
    rushYardsAllowed: pickOpp('rushing.rushingYardsPerGame'),
    thirdDownAllowed: pickOpp('miscellaneous.thirdDownConvPct'),
  };
}

// ── EDGE FINDER: player game logs ─────────────────────────────────────────
//
// Built on ESPN's athlete gamelog (`common/v3/.../athletes/{id}/gamelog`),
// read off a live payload rather than guessed:
//
//  * Columns are identified by `names` (camelCase, UNIQUE), never by `labels`
//    — labels repeat ("YDS" is both passing and rushing yards for a QB).
//  * Each player's payload only carries the columns for HIS stat groups, so a
//    WR has no `passingYards` column at all. Missing columns read as 0.
//  * `filters[season].options` lists every season the player has logged,
//    which is what makes "vs this team, every season" affordable: one call
//    tells us exactly which seasons to fetch, instead of probing years.
//  * A postseason game played in January belongs to the PREVIOUS NFL season
//    (`?season=2025` returns the Jan-2026 playoffs). `season` below is the NFL
//    season; the calendar year shown on chart bars comes from `rawDate`.
//  * Event metadata carries the player's OWN team at the time (`meta.team`),
//    so traded players show who they were with, and the opponent's team id —
//    which is stable across relocations/renames (OAK→LV, WSH) where the
//    abbreviation is not. vs-team matching therefore keys on the id.
const NFL_GAMELOG_FIELDS = {
  cmp: 'completions', att: 'passingAttempts', passYds: 'passingYards',
  passTd: 'passingTouchdowns', int: 'interceptions',
  rushAtt: 'rushingAttempts', rushYds: 'rushingYards', rushTd: 'rushingTouchdowns',
  rec: 'receptions', tgt: 'receivingTargets', recYds: 'receivingYards', recTd: 'receivingTouchdowns',
};

// Per-position stat menus. The first entry is the headline stat the board
// averages and ranks on. `td` is ANYTIME TD (rush + rec), the way the prop is
// sold; a QB's passing TDs are their own stat.
const NFL_EDGE_STATS = {
  QB: [
    { key: 'passYds', label: 'PASS YDS' }, { key: 'passTd', label: 'PASS TD' },
    { key: 'cmp', label: 'CMP' }, { key: 'att', label: 'ATT' },
    { key: 'int', label: 'INT' }, { key: 'rushYds', label: 'RUSH YDS' },
  ],
  RB: [
    { key: 'rushYds', label: 'RUSH YDS' }, { key: 'rushAtt', label: 'CAR' },
    { key: 'rec', label: 'REC' }, { key: 'recYds', label: 'REC YDS' },
    { key: 'scrimYds', label: 'SCRIM YDS' }, { key: 'td', label: 'ANY TD' },
  ],
  WR: [
    { key: 'recYds', label: 'REC YDS' }, { key: 'rec', label: 'REC' },
    { key: 'tgt', label: 'TGT' }, { key: 'td', label: 'ANY TD' },
  ],
};
NFL_EDGE_STATS.TE = NFL_EDGE_STATS.WR;
NFL_EDGE_STATS.FB = NFL_EDGE_STATS.RB;
const nflEdgeStatsFor = pos => NFL_EDGE_STATS[pos] || NFL_EDGE_STATS.WR;

// Past seasons never change, so a season's log is cached for the life of the
// page; the in-flight promise is what's stored, so concurrent callers share
// one request. The CURRENT season is re-fetched after 5 minutes.
const _nflLogCache = new Map();
const NFL_LOG_TTL_MS = 5 * 60 * 1000;

// ~100 gamelog calls can be in play when every board player's career loads,
// so ESPN requests go through a small limiter instead of all at once.
const _nflLimiter = { active: 0, queue: [], max: 6 };
function nflLimited(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      _nflLimiter.active++;
      fn().then(resolve, reject).finally(() => {
        _nflLimiter.active--;
        const next = _nflLimiter.queue.shift();
        if (next) next();
      });
    };
    if (_nflLimiter.active < _nflLimiter.max) run(); else _nflLimiter.queue.push(run);
  });
}

function parseNflGameLog(data, season) {
  if (!data) return { games: [], seasons: [] };
  const names = data.names || [];
  const idx = {};
  for (const [k, n] of Object.entries(NFL_GAMELOG_FIELDS)) idx[k] = names.indexOf(n);
  const seasons = ((data.filters || []).find(f => f.name === 'season')?.options || [])
    .map(o => Number(o.value)).filter(Number.isFinite);

  const events = data.events || {};
  const seen = new Set();
  const games = [];
  for (const st of data.seasonTypes || []) {
    const typeName = String(st.displayName || '').toLowerCase();
    if (typeName.includes('preseason')) continue;
    const isPost = typeName.includes('postseason');
    for (const cat of st.categories || []) {
      for (const ev of cat.events || []) {
        if (!ev.eventId || seen.has(ev.eventId)) continue;
        seen.add(ev.eventId);
        const meta = events[ev.eventId] || {};
        const stats = ev.stats || [];
        // '-' and blanks are ESPN's "no value"; yardage can be negative.
        const num = i => { if (i < 0) return 0; const v = parseFloat(stats[i]); return Number.isNaN(v) ? 0 : v; };
        const g = { eventId: ev.eventId };
        for (const k of Object.keys(NFL_GAMELOG_FIELDS)) g[k] = num(idx[k]);
        g.td = g.rushTd + g.recTd;
        g.scrimYds = g.rushYds + g.recYds;
        const oppAbbr = meta.opponent?.abbreviation || '?';
        Object.assign(g, {
          rawDate: meta.gameDate || '',
          date: meta.gameDate ? new Date(meta.gameDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
          season,
          seasonType: isPost ? 'POST' : 'REG',
          week: meta.week ?? null,
          note: meta.eventNote || '',
          opp: oppAbbr,
          oppTeamId: meta.opponent?.id ? String(meta.opponent.id) : null,
          // Only build a logo URL off a real abbreviation — '?' is a certain
          // 404, and GameLogChart's text fallback beats a broken image.
          oppLogo: meta.opponent?.abbreviation ? teamLogoUrl('nfl', oppAbbr, meta.opponent.id) : null,
          home: meta.atVs === 'vs',
          teamAbbr: meta.team?.abbreviation || '',
          result: meta.gameResult || null,
          score: meta.score || null,
        });
        // A line of all zeros is a game he was listed for but never touched
        // the ball in (a rested starter in week 18, an early injury exit on
        // the first series). Counting it would drag every average toward 0,
        // so it's kept for the record but excluded from the math.
        g.dnp = Object.keys(NFL_GAMELOG_FIELDS).every(k => g[k] === 0);
        games.push(g);
      }
    }
  }
  games.sort((a, b) => String(b.rawDate).localeCompare(String(a.rawDate)));   // newest first
  return { games, seasons };
}

function fetchNflPlayerSeasonLog(playerId, season) {
  const key = `${playerId}:${season}`;
  const hit = _nflLogCache.get(key);
  const isCurrent = Number(season) >= getSeasonYear('nfl');
  if (hit && (!isCurrent || Date.now() - hit.at < NFL_LOG_TTL_MS)) return hit.promise;
  const promise = nflLimited(() => espnFetch(
    `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${playerId}/gamelog?season=${season}`
  )).then(data => parseNflGameLog(data, Number(season)));
  _nflLogCache.set(key, { promise, at: Date.now() });
  // A failed fetch resolves to an empty log (espnFetch returns null); don't
  // pin that for the page's lifetime.
  promise.then(r => { if (!r.games.length && !r.seasons.length) _nflLogCache.delete(key); });
  return promise;
}

// Current + previous season: enough for a Last-5 even in week 1-4, when the
// current season alone has fewer than five games.
async function fetchNflPlayerRecentLog(playerId) {
  const cur = getSeasonYear('nfl');
  const [a, b] = await Promise.all([
    fetchNflPlayerSeasonLog(playerId, cur),
    fetchNflPlayerSeasonLog(playerId, cur - 1),
  ]);
  const seasons = [...new Set([...a.seasons, ...b.seasons])].sort((x, y) => y - x);
  return { games: [...a.games, ...b.games], seasons };
}

// Every season the player has logged. Starts from the recent pair (already
// cached by the board), then fetches whatever older seasons `filters` lists.
async function fetchNflPlayerCareerLog(playerId) {
  const recent = await fetchNflPlayerRecentLog(playerId);
  const cur = getSeasonYear('nfl');
  const older = recent.seasons.filter(y => y < cur - 1);
  const rest = await Promise.all(older.map(y => fetchNflPlayerSeasonLog(playerId, y)));
  const games = [...recent.games, ...rest.flatMap(r => r.games)]
    .sort((a, b) => String(b.rawDate).localeCompare(String(a.rawDate)));
  return { games, seasons: recent.seasons };
}

const _avg = (games, key) => games.length ? games.reduce((s, g) => s + (g[key] || 0), 0) / games.length : null;

// Everything the Edge Finder shows for one player, from a (newest-first) log.
// Pure: no fetching, so the tab can re-run it as more seasons arrive.
//  - l5        : last five games he actually played, across the season break
//  - baseline  : his last 17 played games — one season's worth, and the
//                yardstick L5 and vs-team are compared against
//  - vsOpp     : every career game against `oppTeamId`, all seasons, both
//                regular season and playoffs
//  - bySeason  : vs-team games grouped per NFL season, newest first — the
//                timeline table
function summarizeNflPlayerLog(games, oppTeamId, statKeys) {
  const played = (games || []).filter(g => !g.dnp);
  const l5 = played.slice(0, 5);
  const baselineGames = played.slice(0, 17);
  const vsOpp = played.filter(g => g.oppTeamId && String(g.oppTeamId) === String(oppTeamId));
  const avgs = gs => Object.fromEntries(statKeys.map(k => [k, _avg(gs, k)]));
  const seasonsMap = new Map();
  for (const g of vsOpp) {
    if (!seasonsMap.has(g.season)) seasonsMap.set(g.season, []);
    seasonsMap.get(g.season).push(g);
  }
  const bySeason = [...seasonsMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([season, gs]) => ({
      season, games: gs, n: gs.length, avg: avgs(gs),
      teams: [...new Set(gs.map(g => g.teamAbbr).filter(Boolean))],
      wins: gs.filter(g => g.result === 'W').length,
      losses: gs.filter(g => g.result === 'L').length,
    }));
  return {
    l5, l5Avg: avgs(l5),
    baselineN: baselineGames.length, baselineAvg: avgs(baselineGames),
    vsOpp, vsOppAvg: avgs(vsOpp), bySeason,
    dnpCount: (games || []).length - played.length,
  };
}

// Hit rate vs a user-entered line: "over" means strictly greater, the way a
// .5 line settles. Returns null with no line or no games.
function nflHitRate(games, key, line) {
  if (line == null || !Number.isFinite(line) || !games?.length) return null;
  const hits = games.filter(g => (g[key] || 0) > line).length;
  return { hits, n: games.length, pct: hits / games.length };
}

// ── EDGE FINDER: who to show ───────────────────────────────────────────────
// ESPN's depth chart is the only source that says who STARTS. Its offensive
// formation is named after the personnel ("3WR 1TE") and varies by team, so
// pick whichever chart has a `qb` slot rather than matching the name.
async function fetchNflDepthStarters(teamId) {
  const data = await espnFetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/depthcharts`);
  const off = (data?.depthchart || []).find(dc => dc.positions?.qb);
  if (!off) return [];
  const slots = [['qb', 'QB', 'QB1'], ['rb', 'RB', 'RB1'], ['wr1', 'WR', 'WR1'], ['wr2', 'WR', 'WR2'], ['wr3', 'WR', 'WR3'], ['te', 'TE', 'TE1']];
  const out = [];
  for (const [slot, pos, depth] of slots) {
    const a = off.positions?.[slot]?.athletes?.[0];
    if (a?.id && !out.some(o => o.id === String(a.id))) {
      out.push({ id: String(a.id), name: a.displayName || a.fullName || '?', pos, depth });
    }
  }
  return out;
}

// Fallback when the depth chart is unavailable: the first skill players of
// each position from the roster (order is ESPN's, not a depth ranking).
function nflStartersFromRoster(roster) {
  const want = [['QB', 1], ['RB', 1], ['WR', 3], ['TE', 1]];
  const out = [];
  for (const [pos, n] of want) {
    (roster || []).filter(p => p.pos === pos).slice(0, n)
      .forEach((p, i) => out.push({ id: String(p.id), name: p.name, pos, depth: `${pos}${i + 1}` }));
  }
  return out;
}

// Board for both teams: depth-chart starters decorated with roster status +
// headshot, plus each player's recent (current + previous season) log. The
// career vs-team seasons load afterwards, per card, via fetchNflPlayerCareerLog.
async function buildNflEdgeData(gameInfo, awayRoster, homeRoster) {
  const [awayDc, homeDc] = await Promise.all([
    fetchNflDepthStarters(gameInfo.awayTeamId),
    fetchNflDepthStarters(gameInfo.homeTeamId),
  ]);
  const side = (dc, roster, sideKey) => {
    const list = dc.length ? dc : nflStartersFromRoster(roster);
    const isAway = sideKey === 'away';
    return list.map(p => {
      const r = (roster || []).find(x => String(x.id) === p.id);
      return {
        ...p,
        side: sideKey,
        teamAbbr: isAway ? gameInfo.awayAbbr : gameInfo.homeAbbr,
        oppAbbr: isAway ? gameInfo.homeAbbr : gameInfo.awayAbbr,
        oppTeamId: String(isAway ? gameInfo.homeTeamId : gameInfo.awayTeamId),
        oppLogo: isAway ? gameInfo.homeLogo : gameInfo.awayLogo,
        jersey: r?.jersey || '',
        status: r?.status || 'Active',
        injuryDesc: r?.injuryDesc || '',
        headshot: r?.headshot || `https://a.espncdn.com/i/headshots/nfl/players/full/${p.id}.png`,
        fromDepthChart: dc.length > 0,
      };
    });
  };
  const players = [
    ...side(awayDc, awayRoster, 'away'),
    ...side(homeDc, homeRoster, 'home'),
  ];
  const logs = await Promise.all(players.map(p => fetchNflPlayerRecentLog(p.id).catch(() => ({ games: [], seasons: [] }))));
  players.forEach((p, i) => { p.recent = logs[i]; });
  return { players, season: getSeasonYear('nfl'), depthChart: awayDc.length > 0 || homeDc.length > 0 };
}

Object.assign(window, {
  NFL_SEASON_TYPES,
  fetchNflCurrentWeek,
  fetchNflWeek,
  enrichNflFormWithPlayerStats,
  fetchNflTeamProfile,
  NFL_FORM_CATS,
  NFL_EDGE_STATS,
  nflEdgeStatsFor,
  parseNflGameLog,
  fetchNflPlayerSeasonLog,
  fetchNflPlayerRecentLog,
  fetchNflPlayerCareerLog,
  summarizeNflPlayerLog,
  nflHitRate,
  fetchNflDepthStarters,
  buildNflEdgeData,
});
