/* ── NCAAB SPORT CONFIG ─────────────────────────────────── */
window.SportConfig = window.SportConfig || {};

// NCAAB uses same ESPN stat keys as NBA
SportConfig.ncaamb = {
  h2hCategories: ['pts', 'reb', 'ast'],

  propsStats: {
    paceAndScoring: [
      { label: 'Ast/TO Ratio',   key: 'assistTurnoverRatio' },
      { label: 'Pts / Game',     key: 'avgPoints' },
      { label: 'Field Goal %',   key: 'fieldGoalPct',  pct: true },
      { label: 'FGA / Game',     key: 'avgFieldGoalsAttempted' },
    ],
    scoringMethods: [
      { label: '3PT Made / Game', key: 'avgThreePointFieldGoalsMade' },
      { label: '3PT %',           key: 'threePointFieldGoalPct', pct: true },
      { label: 'FT Attempted / Game', key: 'avgFreeThrowsAttempted' },
      { label: 'FT %',            key: 'freeThrowPct',           pct: true },
    ],
    defense: [
      { label: 'Blocks / Game',       key: 'avgBlocks' },
      { label: 'Steals / Game',       key: 'avgSteals' },
      { label: 'Def Rebounds / Game', key: 'avgDefensiveRebounds' },
    ],
  },
};
