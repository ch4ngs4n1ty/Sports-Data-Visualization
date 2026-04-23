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
  const idx = {
    min: names.indexOf('minutes'),
    reb: names.indexOf('totalrebounds'),
    ast: names.indexOf('assists'),
    pts: names.indexOf('points'),
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
        const num = i => { if (i < 0) return 0; const v = parseInt(stats[i], 10); return Number.isNaN(v) ? 0 : v; };
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

Object.assign(window, { fetchNbaPlayerGameLog, buildNbaEdgeData });
