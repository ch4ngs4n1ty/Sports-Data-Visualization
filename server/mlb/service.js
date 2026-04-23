const { cacheGet, cacheSet, CACHE_TTL, LIVE_CACHE_TTL } = require('../shared/cache');
const { fetchUrl, fetchJson } = require('../shared/http');

const MLB_API = 'https://statsapi.mlb.com/api/v1';
const UNCONFIRMED_LINEUP_TTL = 30 * 1000;
const CONFIRMED_LINEUP_TTL = 30 * 60 * 1000;
const WEATHER_TTL = 24 * 60 * 60 * 1000;

function getLocalDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function getGames(dateOverride) {
  const date = dateOverride || getLocalDate();
  const cacheKey = `games_${date}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const data = await fetchJson(`${MLB_API}/schedule?sportId=1&date=${date}&hydrate=probablePitcher`);
  const games = [];
  for (const d of data.dates || []) {
    for (const g of d.games || []) {
      games.push({
        gamePk: g.gamePk,
        away: {
          id: g.teams.away.team.id,
          name: g.teams.away.team.name,
          probablePitcher: g.teams.away.probablePitcher ? {
            id: g.teams.away.probablePitcher.id,
            name: g.teams.away.probablePitcher.fullName,
          } : null,
        },
        home: {
          id: g.teams.home.team.id,
          name: g.teams.home.team.name,
          probablePitcher: g.teams.home.probablePitcher ? {
            id: g.teams.home.probablePitcher.id,
            name: g.teams.home.probablePitcher.fullName,
          } : null,
        },
        status: g.status.detailedState,
        startTime: g.gameDate,
      });
    }
  }
  cacheSet(cacheKey, games, LIVE_CACHE_TTL);
  return games;
}

function normalizeName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function lastNameKey(s) {
  const parts = normalizeName(s).split(' ');
  return parts[parts.length - 1] || '';
}

async function getTeamRosterMap(teamId) {
  if (!teamId) return { byFull: {}, byLast: {} };
  const cacheKey = `mlb_roster_${teamId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  try {
    const data = await fetchJson(`${MLB_API}/teams/${teamId}/roster?rosterType=40Man`);
    const byFull = {};
    const byLast = {};
    for (const p of data.roster || []) {
      const person = p.person || {};
      if (!person.id || !person.fullName) continue;
      const entry = { id: person.id, name: person.fullName, position: p.position?.abbreviation || '?' };
      const fullKey = normalizeName(person.fullName);
      if (fullKey) byFull[fullKey] = entry;
      const lastKey = lastNameKey(person.fullName);
      if (lastKey) byLast[lastKey] = byLast[lastKey] === undefined ? entry : null;
    }
    const map = { byFull, byLast };
    cacheSet(cacheKey, map, CONFIRMED_LINEUP_TTL);
    return map;
  } catch {
    return { byFull: {}, byLast: {} };
  }
}

function resolveRosterEntry(name, rosterMap) {
  const fullKey = normalizeName(name);
  if (rosterMap.byFull[fullKey]) return rosterMap.byFull[fullKey];
  const lastKey = lastNameKey(name);
  if (lastKey && rosterMap.byLast[lastKey]) return rosterMap.byLast[lastKey];
  return null;
}

async function getGameLineups(gamePk, options = {}) {
  const cacheKey = `lineup_${gamePk}_${options.awayLineup?.join(',') || ''}_${options.homeLineup?.join(',') || ''}`;
  if (!options.refresh) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const [boxData, feedData] = await Promise.all([
    fetchJson(`${MLB_API}/game/${gamePk}/boxscore`),
    fetchJson(`${MLB_API.replace('/v1', '/v1.1')}/game/${gamePk}/feed/live`),
  ]);

  const probablePitchers = feedData.gameData?.probablePitchers || {};
  const result = {};

  for (const side of ['away', 'home']) {
    const team = boxData.teams[side];
    const battingOrder = team.battingOrder || [];
    const players = team.players || {};
    let lineup = battingOrder.slice(0, 9).map((pid, idx) => {
      const p = players[`ID${pid}`] || {};
      const person = p.person || {};
      return { id: pid, name: person.fullName || `Player ${pid}`, position: p.position?.abbreviation || '?', order: idx + 1 };
    });

    const providedLineup = options[`${side}Lineup`];
    if (lineup.length === 0 && Array.isArray(providedLineup) && providedLineup.length) {
      const rosterMap = await getTeamRosterMap(team.team?.id);
      lineup = providedLineup.slice(0, 9).map((name, idx) => {
        const hit = resolveRosterEntry(name, rosterMap);
        return hit ? {
          id: hit.id,
          name: hit.name,
          position: hit.position,
          order: idx + 1,
          resolvedFrom: 'roster',
        } : {
          id: null,
          name,
          position: '?',
          order: idx + 1,
          resolvedFrom: 'unmatched',
        };
      }).filter(b => b.id);
    }

    const pp = probablePitchers[side];
    result[side] = {
      teamId: team.team?.id,
      teamName: team.team?.name,
      lineup,
      probablePitcher: pp ? { id: pp.id, name: pp.fullName } : null,
    };
  }

  const fullyLoaded = result.away.lineup.length >= 9 && result.home.lineup.length >= 9 && result.away.probablePitcher && result.home.probablePitcher;
  const ttl = fullyLoaded ? CONFIRMED_LINEUP_TTL : UNCONFIRMED_LINEUP_TTL;
  cacheSet(cacheKey, result, ttl);
  return result;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { result.push(current); current = ''; }
    else current += ch;
  }
  result.push(current);
  return result;
}

function parseCsv(text) {
  text = text.replace(/^\ufeff/, '');
  const lines = text.split('\n');
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

function summarizeBvP(pitches, batterId, pitcherId) {
  let pa = 0, ab = 0, hits = 0, hr = 0, doubles = 0, triples = 0, singles = 0;
  let bb = 0, k = 0, hbp = 0, sf = 0;
  const gameResults = {};

  for (const p of pitches) {
    const ev = (p.events || '').trim();
    if (!ev) continue;
    pa++;
    const gameDate = p.game_date || '';
    const gamePk = p.game_pk || null;

    switch (ev) {
      case 'single': singles++; hits++; ab++; break;
      case 'double': doubles++; hits++; ab++; break;
      case 'triple': triples++; hits++; ab++; break;
      case 'home_run': hr++; hits++; ab++; break;
      case 'strikeout':
      case 'strikeout_double_play': k++; ab++; break;
      case 'walk':
      case 'intent_walk': bb++; break;
      case 'hit_by_pitch': hbp++; break;
      case 'sac_fly':
      case 'sac_fly_double_play': sf++; break;
      case 'sac_bunt':
      case 'sac_bunt_double_play': break;
      default: ab++;
    }

    if (!gameResults[gameDate]) {
      gameResults[gameDate] = { gamePk, pa: 0, ab: 0, h: 0, hr: 0, bb: 0, k: 0, hbp: 0, singles: 0, doubles: 0, triples: 0, sf: 0, events: [] };
    }
    const gm = gameResults[gameDate];
    if (!gm.gamePk && gamePk) gm.gamePk = gamePk;
    gm.pa++;
    gm.events.push(ev);
    switch (ev) {
      case 'single': gm.singles++; gm.h++; gm.ab++; break;
      case 'double': gm.doubles++; gm.h++; gm.ab++; break;
      case 'triple': gm.triples++; gm.h++; gm.ab++; break;
      case 'home_run': gm.hr++; gm.h++; gm.ab++; break;
      case 'strikeout':
      case 'strikeout_double_play': gm.k++; gm.ab++; break;
      case 'walk':
      case 'intent_walk': gm.bb++; break;
      case 'hit_by_pitch': gm.hbp++; break;
      case 'sac_fly':
      case 'sac_fly_double_play': gm.sf++; break;
      case 'sac_bunt':
      case 'sac_bunt_double_play': break;
      default: gm.ab++;
    }
  }

  const avg = ab > 0 ? hits / ab : 0;
  const obp = (ab + bb + hbp + sf) > 0 ? ((hits + bb + hbp) / (ab + bb + hbp + sf)) : 0;
  const slg = ab > 0 ? ((singles + doubles * 2 + triples * 3 + hr * 4) / ab) : 0;

  const gameByGame = Object.entries(gameResults)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, g]) => ({
      date,
      gamePk: g.gamePk || null,
      pa: g.pa, ab: g.ab, h: g.h, hr: g.hr, bb: g.bb, k: g.k,
      avg: g.ab > 0 ? Number((g.h / g.ab).toFixed(3)) : 0,
    }));

  return {
    batterId: Number(batterId),
    pitcherId: Number(pitcherId),
    totalPitches: pitches.length,
    pa, ab, hits, singles, doubles, triples, hr, bb, k, hbp, sf,
    avg: Number(avg.toFixed(3)),
    obp: Number(obp.toFixed(3)),
    slg: Number(slg.toFixed(3)),
    ops: Number((obp + slg).toFixed(3)),
    gamesPlayed: Object.keys(gameResults).length,
    lastFaced: Object.keys(gameResults).sort().pop() || null,
    gameByGame,
  };
}

async function fetchSavantBvP(batterId, pitcherId, options = {}) {
  const cacheKey = `bvp_${batterId}_${pitcherId}`;
  if (!options.refresh) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const url = `https://baseballsavant.mlb.com/statcast_search/csv?all=true`
    + `&player_type=batter`
    + `&batters_lookup%5B%5D=${batterId}`
    + `&pitchers_lookup%5B%5D=${pitcherId}`
    + `&game_date_gt=2015-01-01`
    + `&game_date_lt=2026-12-31`
    + `&type=details`
    + `&min_pitches=0&min_results=0&min_pas=0`;

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = await fetchUrl(url);
      const pitches = parseCsv(text);
      const summary = summarizeBvP(pitches, batterId, pitcherId);
      cacheSet(cacheKey, summary);
      return summary;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

async function fetchGameWeather(gamePk) {
  if (!gamePk) return null;
  const cacheKey = `weather_${gamePk}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;
  try {
    const data = await fetchJson(`${MLB_API.replace('/v1', '/v1.1')}/game/${gamePk}/feed/live`);
    const w = data?.gameData?.weather || {};
    const venue = data?.gameData?.venue || {};
    const result = {
      condition: w.condition || null,
      temp: w.temp ? Number(w.temp) : null,
      wind: w.wind || null,
      venue: venue.name || null,
      roofType: venue.roofType || null,
    };
    cacheSet(cacheKey, result, WEATHER_TTL);
    return result;
  } catch {
    cacheSet(cacheKey, null, WEATHER_TTL);
    return null;
  }
}

async function enrichBvpGamesWithWeather(gameByGame) {
  if (!gameByGame?.length) return gameByGame;
  const pks = [...new Set(gameByGame.map(g => g.gamePk).filter(Boolean))];
  const weatherByPk = {};
  await Promise.all(pks.map(async pk => { weatherByPk[pk] = await fetchGameWeather(pk); }));
  return gameByGame.map(g => ({ ...g, weather: g.gamePk ? weatherByPk[g.gamePk] || null : null }));
}

async function getGameBvp(gamePk, options = {}) {
  const lineups = await getGameLineups(gamePk, options);
  const pitcherOverrides = {};
  for (const side of ['away', 'home']) {
    const pitcherName = options[`${side}Pitcher`];
    if (pitcherName && lineups[side]?.teamId) {
      const rosterMap = await getTeamRosterMap(lineups[side].teamId);
      const resolved = resolveRosterEntry(pitcherName, rosterMap);
      if (resolved) pitcherOverrides[side] = { id: resolved.id, name: resolved.name };
    }
  }

  const matchups = [];
  let totalBatters = 0;
  let resolvedBatters = 0;
  let failedBatters = 0;

  for (const [side, oppSide] of [['away', 'home'], ['home', 'away']]) {
    const team = lineups[side];
    const opponent = lineups[oppSide];
    const pitcher = pitcherOverrides[oppSide] || opponent.probablePitcher;

    if (!pitcher) {
      matchups.push({ side, teamName: team.teamName, pitcher: null, pitcherTeam: opponent.teamName, error: 'Probable pitcher not yet announced', batters: [] });
      continue;
    }
    if (!team.lineup?.length) {
      matchups.push({ side, teamName: team.teamName, pitcher: { id: pitcher.id, name: pitcher.name }, pitcherTeam: opponent.teamName, error: 'Lineup not yet posted', batters: [] });
      continue;
    }

    const batters = team.lineup;
    totalBatters += batters.length;
    const bvpResults = await Promise.all(
      batters.map(b =>
        fetchSavantBvP(b.id, pitcher.id, options).catch(err => ({
          batterId: b.id, pitcherId: pitcher.id, error: err.message,
          pa: 0, ab: 0, hits: 0, hr: 0, bb: 0, k: 0,
          avg: 0, obp: 0, slg: 0, ops: 0,
          totalPitches: 0, gamesPlayed: 0, lastFaced: null,
        }))
      )
    );

    bvpResults.forEach(r => { if (r.error) failedBatters++; else resolvedBatters++; });
    await Promise.all(bvpResults.map(async r => { if (r.gameByGame?.length) r.gameByGame = await enrichBvpGamesWithWeather(r.gameByGame); }));

    const batterDetails = batters.map((b, i) => ({
      id: b.id,
      name: b.name,
      position: b.position,
      order: b.order,
      bvp: bvpResults[i],
    }));

    matchups.push({
      side,
      teamName: team.teamName,
      pitcher: { id: pitcher.id, name: pitcher.name },
      pitcherTeam: opponent.teamName,
      batters: batterDetails,
    });
  }

  const awayFull = lineups.away.lineup.length >= 9 && lineups.away.probablePitcher;
  const homeFull = lineups.home.lineup.length >= 9 && lineups.home.probablePitcher;
  const lineupStatus = awayFull && homeFull ? 'confirmed' : (lineups.away.lineup.length || lineups.home.lineup.length) ? 'partial' : 'pending';

  return {
    gamePk,
    matchups,
    status: {
      lineupStatus,
      totalBatters,
      resolvedBatters,
      failedBatters,
      awayLineupPosted: lineups.away.lineup.length >= 9,
      homeLineupPosted: lineups.home.lineup.length >= 9,
      awayPitcherPosted: !!lineups.away.probablePitcher,
      homePitcherPosted: !!lineups.home.probablePitcher,
    },
    source: 'Baseball Savant Statcast + MLB Stats API',
    cachedAt: new Date().toISOString(),
  };
}

async function getMlbTeamsByAbbr() {
  const cacheKey = 'mlb_teams_by_abbr';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  try {
    const data = await fetchJson(`${MLB_API}/teams?sportId=1`);
    const map = {};
    for (const t of data.teams || []) {
      if (t.abbreviation) map[t.abbreviation.toUpperCase()] = { id: t.id, name: t.name };
    }
    cacheSet(cacheKey, map, 24 * 60 * 60 * 1000);
    return map;
  } catch {
    return {};
  }
}

async function findGamePkByAbbrDate(teamAbbr, date) {
  if (!teamAbbr || !date) return null;
  const teams = await getMlbTeamsByAbbr();
  const team = teams[teamAbbr.toUpperCase()];
  if (!team) return null;
  const cacheKey = `gamepk_${team.id}_${date}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;
  try {
    const data = await fetchJson(`${MLB_API}/schedule?sportId=1&date=${date}&teamId=${team.id}`);
    const games = data.dates?.[0]?.games || [];
    const gamePk = games[0]?.gamePk || null;
    cacheSet(cacheKey, gamePk, CACHE_TTL);
    return gamePk;
  } catch {
    return null;
  }
}

function normalizeTeamName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z]/g, '');
}

function matchTeams(games, aq, hq) {
  for (const g of games) {
    const gAway = normalizeTeamName(g.away.name);
    const gHome = normalizeTeamName(g.home.name);
    if ((gAway.includes(aq) || aq.includes(gAway)) && (gHome.includes(hq) || hq.includes(gHome))) return g.gamePk;
  }
  return null;
}

function offsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function findGamePkByTeams(awayName, homeName, date) {
  const aq = normalizeTeamName(awayName);
  const hq = normalizeTeamName(homeName);
  const today = getLocalDate();
  const candidates = [...new Set([date, date ? offsetDate(date, -1) : null, today, offsetDate(today, -1), offsetDate(today, 1)].filter(Boolean))];
  for (const d of candidates) {
    const games = await getGames(d).catch(() => []);
    const gamePk = matchTeams(games, aq, hq);
    if (gamePk) return gamePk;
  }
  return null;
}

module.exports = {
  getGames,
  getGameLineups,
  fetchSavantBvP,
  getGameBvp,
  fetchGameWeather,
  findGamePkByAbbrDate,
  findGamePkByTeams,
};
