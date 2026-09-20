'use strict';
const { fetchJson } = require('../shared/http');
const { cacheGet, cacheSet, dedupe } = require('../shared/cache');
async function getLiveSlate(date) {
  const key = `live_slate_${date}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  return dedupe(key, async () => {
    const data = await fetchJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=linescore`);
    if (!Array.isArray(data.dates)) throw new Error('Scoreboard unavailable');
    const games = data.dates.flatMap(d => d.games || []).map(g => ({
      gamePk: g.gamePk, date: g.gameDate, away: g.teams.away.team.name, home: g.teams.home.team.name,
      awayScore: g.teams.away.score ?? null, homeScore: g.teams.home.score ?? null,
      statusState: g.status.abstractGameState === 'Final' ? 'post' : g.status.abstractGameState === 'Live' ? 'in' : 'pre',
      statusText: g.status.detailedState,
      statusDetail: g.linescore?.currentInning ? `${g.linescore.inningState} ${g.linescore.currentInningOrdinal}` : g.status.detailedState,
    }));
    const result = { games, checkedAt: new Date().toISOString(), source: 'MLB StatsAPI', pollSeconds: 15 };
    cacheSet(key, result, 10000);
    return result;
  });
}
module.exports = { getLiveSlate };
