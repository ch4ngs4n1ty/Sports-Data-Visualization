/* ── MLB SPORT CONFIG ───────────────────────────────────── */
window.SportConfig = window.SportConfig || {};

SportConfig.mlb = {
  h2hCategories: ['hits', 'runs', 'hrs'],

  propsStats: {
    paceAndScoring: [
      { label: 'Runs / Game',    key: 'avgRuns' },
      { label: 'Hits / Game',    key: 'avgHits' },
      { label: 'Batting Avg',    key: 'battingAvg', pct: true },
      { label: 'On-base %',      key: 'onBasePct',  pct: true },
    ],
    scoringMethods: [
      { label: 'HRs / Game',     key: 'avgHomeRuns' },
      { label: 'Slugging %',     key: 'sluggingPct', pct: true },
      { label: 'OPS',            key: 'OPS' },
      { label: 'RBI / Game',     key: 'avgRbi' },
    ],
    defense: [
      { label: 'ERA',            key: 'ERA' },
      { label: 'WHIP',           key: 'WHIP' },
      { label: 'Strikeouts / 9', key: 'strikeoutsPerNineInnings' },
    ],
  },
};
