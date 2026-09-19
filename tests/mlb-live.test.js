'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseState } = require('../server/mlb/live-service');
const { checkpoints } = require('../server/mlb/live-moves');
const context = vm.createContext({});
const slip = fs.readFileSync(require.resolve('../frontend/sports/mlb/live-slip.jsx'), 'utf8');
vm.runInContext(slip.slice(0, slip.indexOf('function LiveSlipBuilder')), context);
const tabs = fs.readFileSync(require.resolve('../frontend/sports/mlb/tabs.jsx'), 'utf8');
vm.runInContext(tabs.slice(tabs.indexOf('function unitProfit'), tabs.indexOf('/* ── The tracker panel')), context);

test('single returns handle both American odds signs and reject invalid inputs', () => {
  assert.equal(context.liveSlipReturn(2, 150), 5);
  assert.equal(context.liveSlipReturn(2, -200), 3);
  for (const odds of ['', 0, 99, -99, Infinity, 'bad']) assert.equal(context.liveSlipReturn(1, odds), null);
  for (const stake of ['', 0, -1, Infinity, 'bad']) assert.equal(context.liveSlipReturn(stake, -110), null);
});
test('market board does not invent missing odds or total lines', () => {
  const data = { state: { away: { abbr: 'A' }, home: { abbr: 'H' } }, market: { live: { awayMoneyline: 120, homeMoneyline: -130, overOdds: -110, underOdds: -110, total: null } } };
  assert.equal(context.liveMarketSelections(data).length, 2);
  data.market.live.total = 8.5;
  assert.equal(context.liveMarketSelections(data).length, 4);
  data.market.live.overOdds = 0;
  assert.equal(context.liveMarketSelections(data).length, 3);
  assert.notEqual(context.liveSelectionKey({market:'TOTAL',side:'OVER',line:8.5}), context.liveSelectionKey({market:'TOTAL',side:'OVER',line:9.5}));
});
test('inning breaks normalize state without losing the checkpoint; pitcher comes from defense', () => {
  const state = parseState({ gameData: { status: { abstractGameState: 'Live' } }, liveData: { linescore: { currentInning: 5, inningHalf: 'Top', inningState: 'Middle', outs: 3, offense: { first: { id: 1 } }, defense: { pitcher: { id: 7, fullName: 'Current Pitcher' } } } } });
  assert.equal(state.inning, 5); assert.equal(state.half, 'bottom'); assert.equal(state.outs, 0); assert.equal(state.bases, 0);
  assert.equal(state.currentPitcher.name, 'Current Pitcher');
  assert.equal(checkpoints({ state }).some(c => c.kind === 'half-inning'), true);
  state.betweenInnings = false;
  assert.equal(checkpoints({ state }).some(c => c.kind === 'half-inning'), false);
});
test('tracker excludes missing probabilities, pushes and voids from calibration and profit', () => {
  const bets = [
    {result:'WIN',stakeUnits:2,odds:150,modelProb:0.6},
    {result:'LOSS',stakeUnits:1,odds:-110,modelProb:null},
    {result:'PUSH',stakeUnits:5,odds:-110,modelProb:0.8},
    {result:'VOID',stakeUnits:5,odds:-110,modelProb:0.8},
  ];
  const summary = context.trackerSummary(bets);
  assert.equal(summary.profit, 2); assert.equal(summary.staked, 3);
  assert.equal(summary.calibration.n, 1); assert.equal(summary.calibration.brier, 0.16);
});
test('stale reference quotes block model calls and delayed games pause analysis', () => {
  const { buildMoves } = require('../server/mlb/live-moves');
  const result = buildMoves({ market: { hasLive:true, live:{stale:true,ageSec:180} }, state:{innings:[]} });
  assert.equal(result.blocked, true); assert.equal(result.moves.length, 0);
  const state = parseState({ gameData:{status:{abstractGameState:'Live',detailedState:'Delayed: Rain'}} });
  assert.equal(state.isLive, false);
});
