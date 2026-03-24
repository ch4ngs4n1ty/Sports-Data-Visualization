/* ── NHL SPORT CONFIG ───────────────────────────────────── */
window.SportConfig = window.SportConfig || {};

SportConfig.nhl = {
  statCategories: [
    { key: 'goals',   label: 'G',   espnBoxLabel: 'G',   espnLeaderCat: 'goals'   },
    { key: 'assists', label: 'A',   espnBoxLabel: 'A',   espnLeaderCat: 'assists' },
    { key: 'pts',     label: 'PTS', espnBoxLabel: 'PTS', espnLeaderCat: 'points'  },
  ],

  propsStats: {
    paceAndScoring: [
      { label: 'Goals / Game',    key: 'avgGoals' },
      { label: 'Shots / Game',    key: 'avgShotsOnGoal' },
      { label: 'Shot %',          key: 'shootingPct', pct: true },
      { label: 'Power Play %',    key: 'powerPlayPct', pct: true },
    ],
    scoringMethods: [
      { label: 'PP Goals / Game', key: 'avgPowerPlayGoals' },
      { label: 'SH Goals / Game', key: 'avgShortHandedGoals' },
      { label: 'Faceoff Win %',   key: 'faceOffWinPct', pct: true },
    ],
    defense: [
      { label: 'Goals Against / Game', key: 'avgGoalsAgainst' },
      { label: 'Save %',               key: 'savePct', pct: true },
      { label: 'Penalty Kill %',       key: 'penaltyKillPct', pct: true },
    ],
  },
};
