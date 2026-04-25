/* ============================================================
   PLAYIQ — NBA DATA LAYER
   NBA-only frontend helpers
   ============================================================ */

async function fetchNbaPlayerGameLog(playerId, { season } = {}) {
  if (!playerId) return [];
  const yr = season || getSeasonYear('nba');
  const data = await espnFetch(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog?season=${yr}`);
  if (!data) return [];

  const names = (data.names || []).map(n => String(n).toLowerCase());
  // Try a couple of known label variants for the FG/3P/FT pairs
  const findIdx = (...candidates) => {
    for (const c of candidates) { const i = names.indexOf(c); if (i >= 0) return i; }
    return -1;
  };
  const idx = {
    min: findIdx('minutes'),
    reb: findIdx('totalrebounds', 'rebounds'),
    ast: findIdx('assists'),
    pts: findIdx('points'),
    stl: findIdx('steals'),
    blk: findIdx('blocks'),
    to:  findIdx('turnovers'),
    fgm: findIdx('fieldgoalsmade'),
    fga: findIdx('fieldgoalsattempted'),
    tpm: findIdx('threepointfieldgoalsmade'),
    tpa: findIdx('threepointfieldgoalsattempted'),
    ftm: findIdx('freethrowsmade'),
    fta: findIdx('freethrowsattempted'),
  };

  const events = data.events || {};
  const out = [];
  for (const st of (data.seasonTypes || [])) {
    const typeName = String(st.displayName || '').toLowerCase();
    if (typeName.includes('preseason')) continue;
    for (const cat of (st.categories || [])) {
      for (const ev of (cat.events || [])) {
        const meta = events[ev.eventId] || {};
        const stats = ev.stats || [];
        const num = i => { if (i < 0) return 0; const v = parseFloat(stats[i]); return Number.isNaN(v) ? 0 : v; };
        out.push({
          eventId: ev.eventId,
          rawDate: meta.gameDate || '',
          date: meta.gameDate ? new Date(meta.gameDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
          opp: meta.opponent?.abbreviation || '?',
          oppTeamId: meta.opponent?.id ? String(meta.opponent.id) : null,
          home: meta.atVs === 'vs',
          min: num(idx.min),
          pts: num(idx.pts),
          reb: num(idx.reb),
          ast: num(idx.ast),
          stl: num(idx.stl),
          blk: num(idx.blk),
          to:  num(idx.to),
          fgm: num(idx.fgm),
          fga: num(idx.fga),
          tpm: num(idx.tpm),
          tpa: num(idx.tpa),
          ftm: num(idx.ftm),
          fta: num(idx.fta),
          result: meta.gameResult || null,
          score: meta.score || null,
        });
      }
    }
  }
  out.sort((a, b) => String(b.rawDate).localeCompare(String(a.rawDate)));
  return out;
}

async function buildNbaEdgeData(gameInfo) {
  if (gameInfo?.sportKey !== 'nba') return null;
  const [awayRoster, homeRoster] = await Promise.all([
    fetchRoster('nba', gameInfo.awayTeamId),
    fetchRoster('nba', gameInfo.homeTeamId),
  ]);

  const TOP_N = 8;
  const isActive = p => !/^(out|suspended|injured_reserve)/i.test(p.status || '');
  const pick = r => (r || []).filter(isActive).slice(0, TOP_N);

  const buildMeta = (players, side, teamAbbr, teamColor, oppTeamId, oppAbbr) =>
    players.map(p => ({
      id: p.id, name: p.name, pos: p.pos, jersey: p.jersey,
      headshot: p.headshot, status: p.status,
      side, teamAbbr, teamColor, oppTeamId: String(oppTeamId), oppAbbr,
    }));

  const all = [
    ...buildMeta(pick(awayRoster), 'away', gameInfo.awayAbbr, '#00d4ff', gameInfo.homeTeamId, gameInfo.homeAbbr),
    ...buildMeta(pick(homeRoster), 'home', gameInfo.homeAbbr, '#ffd060', gameInfo.awayTeamId, gameInfo.awayAbbr),
  ];

  await Promise.all(all.map(async p => {
    const log = await fetchNbaPlayerGameLog(p.id);
    p.l5 = log.slice(0, 5);
    p.h2h = log.filter(g => g.oppTeamId === p.oppTeamId).slice(0, 5);
    const avg = (arr, key) => arr.length ? arr.reduce((s, g) => s + (g[key] || 0), 0) / arr.length : 0;
    p.avgPts = avg(p.l5, 'pts');
    p.avgReb = avg(p.l5, 'reb');
    p.avgAst = avg(p.l5, 'ast');
  }));

  all.forEach(p => {
    const l5Pts = p.avgPts;
    const h2hPts = p.h2h.length ? p.h2h.reduce((s, g) => s + (g.pts || 0), 0) / p.h2h.length : 0;
    const l3Pts = p.l5.slice(0, 3).length
      ? p.l5.slice(0, 3).reduce((s, g) => s + (g.pts || 0), 0) / p.l5.slice(0, 3).length : l5Pts;

    const trendRatio = l5Pts > 0 ? Math.min(l3Pts / l5Pts, 2.0) : 1.0;
    const elevationBonus = h2hPts > l5Pts ? (h2hPts - l5Pts) * 0.5 : 0;

    let ptStreak = 0;
    for (const g of p.l5) { if ((g.pts || 0) >= 20) ptStreak++; else break; }

    p.hotScore = p.h2h.length
      ? (h2hPts * 0.5 + l5Pts * 0.5) * trendRatio + elevationBonus + ptStreak * 0.3
      : l5Pts * trendRatio + ptStreak * 0.3;

    const h2hElite = h2hPts > 0 && h2hPts >= l5Pts * 1.15 && h2hPts >= 20;
    if ((ptStreak >= 3 && l5Pts >= 20) || h2hElite) p.hotTier = 'elite';
    else if (trendRatio >= 1.15 || (h2hPts > 0 && h2hPts > l5Pts)) p.hotTier = 'hot';
    else if (trendRatio < 0.80 || (p.l5.length >= 3 && l5Pts < 8)) p.hotTier = 'cold';
    else p.hotTier = 'neutral';
  });

  const sortByHot = list => list.slice().sort((a, b) => (b.hotScore ?? 0) - (a.hotScore ?? 0));
  const away = sortByHot(all.filter(p => p.side === 'away'));
  const home = sortByHot(all.filter(p => p.side === 'home'));

  return { players: [...away, ...home], awayAbbr: gameInfo.awayAbbr, homeAbbr: gameInfo.homeAbbr };
}

/* ============================================================
   NBA LINEUP MATCHUPS
   Pick the most-likely starter at each position (PG/SG/SF/PF/C)
   and pair them across teams. For each pair compute season
   averages AND head-to-head averages (games where both faced
   the opposing team) for MIN/PTS/REB/AST/STL/BLK/FG%/3P%/FT%.
   ============================================================ */

const NBA_LINEUP_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

function _avgGames(games, key) {
  if (!games?.length) return 0;
  const sum = games.reduce((s, g) => s + (Number(g[key]) || 0), 0);
  return sum / games.length;
}

function _pctSafe(num, den) {
  if (!den) return 0;
  return num / den;
}

// Aggregate a list of games into season-style averages for a player
function _aggregatePlayerGames(games) {
  if (!games?.length) return null;
  const sumKey = key => games.reduce((s, g) => s + (Number(g[key]) || 0), 0);
  const fgm = sumKey('fgm'), fga = sumKey('fga');
  const tpm = sumKey('tpm'), tpa = sumKey('tpa');
  const ftm = sumKey('ftm'), fta = sumKey('fta');
  return {
    games: games.length,
    min: _avgGames(games, 'min'),
    pts: _avgGames(games, 'pts'),
    reb: _avgGames(games, 'reb'),
    ast: _avgGames(games, 'ast'),
    stl: _avgGames(games, 'stl'),
    blk: _avgGames(games, 'blk'),
    to:  _avgGames(games, 'to'),
    fgPct: _pctSafe(fgm, fga),
    tpPct: _pctSafe(tpm, tpa),
    ftPct: _pctSafe(ftm, fta),
  };
}

// Pick the most-played player at a given position from a roster, given that
// player's gamelog for sorting. Falls back to looser matches (G/F) when no
// exact PG/SG/SF/PF/C match is available.
function _pickStarterByPosition(playersWithLogs, position, takenIds) {
  const exactMatch = playersWithLogs
    .filter(p => !takenIds.has(p.id))
    .filter(p => (p.pos || '').toUpperCase() === position)
    .sort((a, b) => (b.season?.min || 0) - (a.season?.min || 0));
  if (exactMatch[0]) return exactMatch[0];

  // Fallbacks for ambiguous "G" / "F" / "G-F" rosters
  const looseGroup = position === 'PG' || position === 'SG' ? ['G']
    : position === 'SF' || position === 'PF' ? ['F']
    : [];
  if (looseGroup.length) {
    const loose = playersWithLogs
      .filter(p => !takenIds.has(p.id))
      .filter(p => looseGroup.includes((p.pos || '').toUpperCase()))
      .sort((a, b) => (b.season?.min || 0) - (a.season?.min || 0));
    if (loose[0]) return loose[0];
  }
  return null;
}

async function buildNbaLineupData(gameInfo, awayRoster, homeRoster) {
  if (gameInfo?.sportKey !== 'nba') return null;

  const isActive = p => !/^(out|suspended|injured_reserve)/i.test(p.status || '');
  const TOP_N = 12;
  const awayPick = (awayRoster || []).filter(isActive).slice(0, TOP_N);
  const homePick = (homeRoster || []).filter(isActive).slice(0, TOP_N);

  const enrich = async (players, oppTeamId) => {
    return Promise.all(players.map(async p => {
      const log = await fetchNbaPlayerGameLog(p.id);
      const h2hGames = log.filter(g => g.oppTeamId === String(oppTeamId));
      return {
        id: p.id,
        name: p.name,
        pos: p.pos,
        jersey: p.jersey,
        headshot: p.headshot,
        status: p.status,
        season: _aggregatePlayerGames(log),
        h2h: _aggregatePlayerGames(h2hGames),
        h2hCount: h2hGames.length,
        l5: _aggregatePlayerGames(log.slice(0, 5)),
      };
    }));
  };

  const [awayEnriched, homeEnriched] = await Promise.all([
    enrich(awayPick, gameInfo.homeTeamId),
    enrich(homePick, gameInfo.awayTeamId),
  ]);

  const awayTaken = new Set();
  const homeTaken = new Set();
  const matchups = [];
  for (const pos of NBA_LINEUP_POSITIONS) {
    const a = _pickStarterByPosition(awayEnriched, pos, awayTaken);
    const h = _pickStarterByPosition(homeEnriched, pos, homeTaken);
    if (a) awayTaken.add(a.id);
    if (h) homeTaken.add(h.id);
    matchups.push({ position: pos, away: a || null, home: h || null });
  }

  return {
    matchups,
    awayAbbr: gameInfo.awayAbbr,
    homeAbbr: gameInfo.homeAbbr,
    awayTeamId: gameInfo.awayTeamId,
    homeTeamId: gameInfo.homeTeamId,
  };
}

Object.assign(window, { fetchNbaPlayerGameLog, buildNbaEdgeData, buildNbaLineupData });
