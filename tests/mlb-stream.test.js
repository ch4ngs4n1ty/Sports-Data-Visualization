'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createLiveHub } = require('../server/shared/live-stream');
const { snapshotFromFeed } = require('../server/mlb/live-service');
const fs = require('node:fs'), vm = require('node:vm');
const flush = () => new Promise(resolve => setImmediate(resolve));
function response() {
  const r = new EventEmitter();
  r.messages = []; r.writableLength = 0;
  r.writeHead = (status, headers) => { r.status = status; r.headers = headers; };
  r.write = text => { r.messages.push(text); return true; };
  r.end = text => { if (text) r.messages.push(text); r.emit('close'); };
  r.destroy = () => { r.destroyed = true; r.emit('close'); };
  return r;
}
function timers() {
  const tasks = new Map(); let id = 0;
  return { tasks, schedule(fn, ms) { tasks.set(++id, { fn, ms }); return id; }, cancel(i) { tasks.delete(i); },
    async next() { const [i, task] = tasks.entries().next().value; tasks.delete(i); await task.fn(); } };
}
test('viewers share one serial fetch; last disconnect releases topic and timer', async () => {
  const clock = timers(); let calls = 0, finish;
  const hub = createLiveHub({ ...clock, load: () => { calls++; return new Promise(r => { finish = r; }); } });
  const a = response(), b = response();
  hub.attach({}, a, 'game:1', 'a'); hub.attach({}, b, 'game:1', 'b');
  assert.equal(calls, 1); assert.equal(clock.tasks.size, 0);
  finish({ revision: 'one', pollSeconds: 10 }); await flush();
  assert(a.messages.some(s => s.includes('"one"'))); assert(b.messages.some(s => s.includes('"one"')));
  assert.equal(clock.tasks.size, 1);
  a.emit('close'); assert.equal(hub.topics.size, 1);
  b.emit('close'); assert.equal(hub.topics.size, 0); assert.equal(clock.tasks.size, 0);
});
test('provider failure marks old data stale, backs off, and resumes with correction', async () => {
  const clock = timers(); let calls = 0;
  const hub = createLiveHub({ ...clock, load: async () => { if (++calls === 2) throw Error('offline'); return { revision: calls }; } });
  const a = response(); hub.attach({}, a, 'game:2', 'a'); await flush();
  await clock.next(); assert(a.messages.some(s => s.includes('event: stale')));
  assert.equal([...clock.tasks.values()][0].ms, 20000);
  const b = response(); hub.attach({}, b, 'game:2', 'b');
  assert(b.messages.at(-1).includes('event: stale'));
  await clock.next(); assert(a.messages.at(-1).includes('"revision":3'));
  a.emit('close'); b.emit('close');
});
test('disconnect during pending fetch cannot revive a retired topic', async () => {
  const clock = timers(); let finish;
  const hub = createLiveHub({ ...clock, load: () => new Promise(r => { finish = r; }) });
  const r = response(); hub.attach({}, r, 'game:3', 'a'); r.emit('close');
  finish({ revision: 1 }); await flush();
  assert.equal(clock.tasks.size, 0); assert.equal(hub.topics.size, 0);
});
test('connection limit and slow reader protection bound resource use', async () => {
  const clock = timers(); const hub = createLiveHub({ ...clock, maxPerIp: 1, load: async () => ({}) });
  const a = response(), b = response(); hub.attach({}, a, 'game:1', 'a'); hub.attach({}, b, 'game:1', 'a');
  assert.equal(b.status, 429);
  a.writableLength = 300000; await flush();
  assert.equal(a.destroyed, true); assert.equal(hub.topics.size, 0);
});
function feed() {
  return { gamePk: 1, metaData: { timeStamp: '20260920_010000', wait: 10 },
    gameData: { status: { abstractGameState: 'Live', detailedState: 'In Progress' }, teams: { away: { id: 1 }, home: { id: 2 } } },
    liveData: { linescore: { currentInning: 4, inningHalf: 'Top', outs: 1, teams: { away: { runs: 2 }, home: { runs: 1 } } },
      boxscore: { teams: { away: { players: { ID9: { person: { id: 9, fullName: 'Batter' }, stats: { batting: { hits: 1 } } } } } } },
      plays: { allPlays: [{ about: { isComplete: true, atBatIndex: 3 }, result: { description: 'Single' } }] } } };
}
test('snapshot revision ignores heartbeat but changes for player stats and corrected plays', () => {
  const f = feed(), before = snapshotFromFeed(f);
  f.metaData.timeStamp = '20260920_010010'; assert.equal(snapshotFromFeed(f).revision, before.revision);
  f.liveData.boxscore.teams.away.players.ID9.stats.batting.hits = 2;
  const after = snapshotFromFeed(f); assert.notEqual(after.revision, before.revision); assert.equal(after.players[0].batting.hits, 2);
  f.liveData.plays.allPlays[0].result.description = 'Fielding error'; assert.notEqual(snapshotFromFeed(f).revision, after.revision);
  assert.equal(snapshotFromFeed(f).recentPlays.length, 1);
});
function browserContext(extra = {}) {
  const c = vm.createContext({ window: {}, URLSearchParams, ...extra });
  vm.runInContext(fs.readFileSync('frontend/data/mlb/paper.js', 'utf8'), c);
  return c;
}
test('paper model includes pushes and prices both American odds signs', () => {
  const c = browserContext(), price = c.window.paperPrice;
  const model = { homeWinProb: .6, awayWinProb: .4, remainingRunsDistribution: [.2, .3, .5] };
  const state = { isLive: true, awayScore: 2, homeScore: 1 };
  assert(Math.abs(price(model, state, 'MONEYLINE', 'HOME', null, -200).ev + .1) < 1e-9);
  const total = price(model, state, 'TOTAL', 'OVER', 4, 100);
  assert.equal(total.win, .5); assert.equal(total.push, .3); assert(Math.abs(total.ev - .3) < 1e-9);
  assert(Math.abs(total.modelProb - .5 / .7) < 1e-9);
  for (const odds of ['', 0, 99, Infinity]) assert.equal(price(model, state, 'MONEYLINE', 'HOME', null, odds), null);
  assert.equal(price(model, { ...state, isLive: false }, 'MONEYLINE', 'HOME', null, 100), null);
});
test('paper audit freezes the decision and keeps unverified prices explicit', () => {
  const c = browserContext();
  const data = { ...snapshotFromFeed(feed()), model: { version: 'v1', homeWinProb: .6, awayWinProb: .4 } };
  const pick = c.window.paperSnapshot(data, { market: 'MONEYLINE', side: 'HOME', odds: 100, stakeUnits: 1 }, 1000);
  data.state.homeScore = 99;
  assert.equal(pick.snapshot.score, '2-1'); assert.equal(pick.audit.quoteFreshness, 'unknown'); assert.equal(pick.audit.executable, false);
  assert.equal(pick.selectedAt, '1970-01-01T00:00:01.000Z');
});
test('decision replay keeps paper results separate from actual bets and excludes push/void profit', () => {
  const { window: w } = browserContext();
  const records = [
    { id: 2, mode: 'PAPER', ts: '2026-02', odds: -110, stakeUnits: 1, result: 'LOSS' },
    { id: 1, mode: 'PAPER', ts: '2026-01', odds: 150, stakeUnits: 2, result: 'WIN' },
    { id: 3, mode: 'ACTUAL', ts: '2026-01', odds: 100, stakeUnits: 100, result: 'WIN' },
    { id: 4, mode: 'PAPER', ts: '2026-03', odds: 100, stakeUnits: 5, result: 'PUSH' },
  ];
  const replay = w.paperReplay(records);
  assert.equal(replay.length, 3); assert.equal(replay[0].profit, 3); assert.equal(replay[2].profit, 2);
});
test('slate merges by game ID/time and never guesses ambiguous doubleheaders', () => {
  const c = browserContext(); vm.runInContext(fs.readFileSync('frontend/data/mlb/live-stream.js', 'utf8'), c);
  const game = { sportKey: 'mlb', eventId: 'espn1', awayFull: 'Away', homeFull: 'Home', date: '2026-09-20T18:00:00Z' };
  const slate = { games: [{ gamePk: 1, away: 'Away', home: 'Home', date: '2026-09-20T18:00:00Z', awayScore: 3 },
    { gamePk: 2, away: 'Away', home: 'Home', date: '2026-09-20T22:00:00Z', awayScore: 7 }] };
  assert.equal(c.window.mergeMlbSlate([game], slate)[0].gamePk, 1);
  assert.equal(c.window.mergeMlbSlate([{ ...game, date: 'unknown' }], slate)[0].gamePk, undefined);
});

function streamBrowser() {
  const clock = timers(), events = new Map(), sources = [];
  const document = { hidden: false, addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) };
  class Source {
    constructor(url) { this.url = url; this.handlers = {}; sources.push(this); }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    close() { this.closed = true; }
    send(snapshot) { this.handlers.snapshot({ data: JSON.stringify(snapshot) }); }
  }
  let requests = 0;
  const context = vm.createContext({ window: { EventSource: Source }, EventSource: Source, document,
    API_BASE: 'http://localhost:3011', URLSearchParams, AbortController,
    setTimeout: clock.schedule, clearTimeout: clock.cancel,
    fetch: async () => { requests++; return { ok: true, json: async () => ({ revision: 'rest', checkedAt: new Date().toISOString() }) }; } });
  vm.runInContext(fs.readFileSync('frontend/data/mlb/live-stream.js', 'utf8'), context);
  return { subscribe: context.window.subscribeMlbLive, sources, clock, document, events, get requests() { return requests; } };
}
test('browser shares one connection, pauses when hidden and resubscribes on return', () => {
  const b = streamBrowser(), aUpdates = [], bUpdates = [];
  const a = b.subscribe({ gamePk: 1 }, u => aUpdates.push(u));
  const other = b.subscribe({ gamePk: 1 }, u => bUpdates.push(u));
  assert.equal(b.sources.length, 1);
  b.sources[0].send({ revision: 'r1', checkedAt: new Date().toISOString() });
  assert.equal(aUpdates.at(-1).snapshot.revision, 'r1'); assert.equal(bUpdates.at(-1).status, 'live');
  b.document.hidden = true; b.events.get('visibilitychange')();
  assert.equal(b.sources[0].closed, true); assert.equal(aUpdates.at(-1).status, 'paused');
  b.document.hidden = false; b.events.get('visibilitychange')(); assert.equal(b.sources.length, 2);
  a(); assert.notEqual(b.sources[1].closed, true);
  other(); assert.equal(b.sources[1].closed, true); assert.equal(b.events.size, 0); assert.equal(b.clock.tasks.size, 0);
});
test('browser rejects an aged cached snapshot and falls back when SSE fails', async () => {
  const b = streamBrowser(), updates = [];
  const stop = b.subscribe({ gamePk: 2 }, u => updates.push(u));
  b.sources[0].send({ revision: 'old', checkedAt: '2020-01-01T00:00:00Z' });
  assert.equal(updates.at(-1).status, 'stale');
  b.sources[0].onerror(); await flush();
  assert.equal(b.sources[0].closed, true); assert.equal(b.requests, 1);
  assert.equal(updates.at(-1).status, 'polling'); assert.equal(updates.at(-1).snapshot.revision, 'rest');
  stop(); assert.equal(b.clock.tasks.size, 0);
});

test('ambiguous doubleheader odds are withheld instead of attached to the wrong game', async () => {
  const { cacheSet, cache } = require('../server/shared/cache');
  const { espnEventIdFor } = require('../server/mlb/live-service');
  const state = { away: { name: 'Away' }, home: { name: 'Home' } };
  cacheSet('espnmap_2026-09-20', { 'away@home': ['first', 'second'] });
  assert.equal(await espnEventIdFor(state, '2026-09-20'), null);
  cacheSet('espnmap_2026-09-20', { 'away@home': ['first'] });
  assert.equal(await espnEventIdFor(state, '2026-09-20'), 'first');
  cache.delete('espnmap_2026-09-20');
});
