/* ── NBA SPORT CONFIG ───────────────────────────────────────
   Stat keys must match what ESPN's site API returns for NBA.
   Available keys: see fetchTeamStats() in app.js
─────────────────────────────────────────────────────────── */
window.SportConfig = window.SportConfig || {};

SportConfig.nba = {
  // key: internal key used in data objects
  // label: button label shown in UI
  // espnBoxLabel: column header in ESPN boxscore statistics array
  // espnLeaderCat: category name in ESPN summary leaders array
  statCategories: [
    { key: 'pts', label: 'PTS', espnBoxLabel: 'PTS', espnLeaderCat: 'points'   },
    { key: 'reb', label: 'REB', espnBoxLabel: 'REB', espnLeaderCat: 'rebounds' },
    { key: 'ast', label: 'AST', espnBoxLabel: 'AST', espnLeaderCat: 'assists'  },
  ],

  propsStats: {
    paceAndScoring: [
      { label: 'Ast/TO Ratio',   key: 'assistTurnoverRatio' },
      { label: 'Pts / Game',     key: 'avgPoints' },
      { label: 'Field Goal %',   key: 'fieldGoalPct',  pct: true },
      { label: 'FGA / Game',     key: 'avgFieldGoalsAttempted' },
    ],
    scoringMethods: [
      { label: '2PT Made / Game', key: 'avgTwoPointFieldGoalsMade' },
      { label: '2PT %',           key: 'twoPointFieldGoalPct',          pct: true },
      { label: '3PT Made / Game', key: 'avgThreePointFieldGoalsMade' },
      { label: '3PT %',           key: 'threePointFieldGoalPct',         pct: true },
      { label: 'FT Attempted / Game', key: 'avgFreeThrowsAttempted' },
      { label: 'FT %',            key: 'freeThrowPct',                   pct: true },
    ],
    defense: [
      { label: 'Blocks / Game',        key: 'avgBlocks' },
      { label: 'Steals / Game',        key: 'avgSteals' },
      { label: 'Def Rebounds / Game',  key: 'avgDefensiveRebounds' },
    ],
  },
};
