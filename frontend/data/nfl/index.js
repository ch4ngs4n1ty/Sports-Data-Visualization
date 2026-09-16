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

Object.assign(window, {
  NFL_SEASON_TYPES,
  fetchNflCurrentWeek,
  fetchNflWeek,
  enrichNflFormWithPlayerStats,
  fetchNflTeamProfile,
  NFL_FORM_CATS,
});
