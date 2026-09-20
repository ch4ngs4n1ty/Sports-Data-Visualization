'use strict';
const M = require('./live-model');

// Approximate final-score distribution. End games after a home lead following
// top regulation, cap walk-offs at the winning run (walk-off HR excess omitted),
// and carry ties into extras. This is an estimate, not calibrated betting odds.
function finalScoreDistribution(state, env) {
  if (state.isFinal) return { outcomes: [{ away: state.awayScore, home: state.homeScore, p: 1 }], unresolved: 0 };
  if (!state.isLive) return null;
  const reg = state.scheduledInnings || 9;
  const full = {}, extra = {};
  for (const side of ['away', 'home']) {
    const mix = M.distForRpi(env[`${side}Rpi`]);
    full[side] = M.halfInningRunDist(0, 0, mix);
    extra[side] = M.halfInningRunDist(state.automaticRunner ? 2 : 0, 0, mix);
  }
  const key = (a, h) => `${a},${h}`;
  let active = new Map([[key(state.awayScore, state.homeScore), 1]]);
  const finished = new Map();
  const add = (map, a, h, p) => { const k = key(a, h); map.set(k, (map.get(k) || 0) + p); };
  let inning = state.inning, half = state.half, first = true;
  const stopAt = Math.max(reg, inning) + 12;
  while (active.size && inning <= stopAt) {
    const side = half === 'top' ? 'away' : 'home';
    const dist = first ? M.halfInningRunDist(state.bases, state.outs, M.distForRpi(env[`${side}Rpi`]))
      : inning > reg ? extra[side] : full[side];
    first = false;
    const next = new Map();
    for (const [k, mass] of active) {
      const [away, home] = k.split(',').map(Number);
      // No bottom half if the home team has already won.
      if (half === 'bottom' && inning >= reg && home > away) { add(finished, away, home, mass); continue; }
      for (let runs = 0; runs < dist.length; runs++) {
        const p = mass * dist[runs];
        if (p < 1e-12) continue;
        const a = away + (side === 'away' ? runs : 0);
        let h = home + (side === 'home' ? runs : 0);
        if (half === 'bottom' && inning >= reg && h > a) h = a + 1;
        if (inning >= reg && (half === 'top' ? h > a : h !== a)) add(finished, a, h, p);
        else add(next, a, h, p);
      }
    }
    active = next;
    if (half === 'top') half = 'bottom'; else { half = 'top'; inning++; }
  }
  const outcomes = [...finished].map(([k, p]) => { const [away, home] = k.split(',').map(Number); return { away, home, p }; });
  const resolved = outcomes.reduce((sum, o) => sum + o.p, 0);
  return { outcomes, unresolved: Math.max(0, 1 - resolved),
    method: 'Base/out run distributions with extra innings and game-ending rules; walk-off home-run excess omitted.' };
}
module.exports = { finalScoreDistribution };
