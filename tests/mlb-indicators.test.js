'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
const { finalScoreDistribution } = require('../server/mlb/live-indicators');
const { snapshotFromFeed } = require('../server/mlb/live-service');
const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync('frontend/data/mlb/indicators.js','utf8'),context);
const {liveIndicator,indicatorKey} = context.window;
const env = { awayRpi:.45, homeRpi:.5 };
const state = {isLive:true,isFinal:false,inning:9,half:'top',outs:2,bases:0,awayScore:1,homeScore:3,scheduledInnings:9,automaticRunner:true};
test('final scores include no unnecessary home half and retain nearly all probability mass', () => {
  const dist = finalScoreDistribution(state,env);
  assert(dist.unresolved < .00001);
  assert(dist.outcomes.some(o => o.away === 1 && o.home === 3));
  assert(!dist.outcomes.some(o => o.away === 1 && o.home > 3));
  assert(dist.outcomes.every(o => o.away !== o.home));
});
test('tie in bottom ninth continues into extras; walkoff stops at winning run', () => {
  const dist = finalScoreDistribution({...state,half:'bottom',outs:0,bases:7,awayScore:3,homeScore:3},env);
  assert(dist.outcomes.some(o=>o.home===4 && o.away===3));
  assert(!dist.outcomes.some(o=>o.home>4 && o.away===3));
  assert(dist.outcomes.some(o=>o.away>3));
  assert(dist.unresolved < .00001);
});
test('moneyline, runline and total use the same final-score outcomes, with pushes', () => {
  const data = {state,model:{finalScores:{unresolved:0,outcomes:[{away:2,home:4,p:.6},{away:3,home:4,p:.2},{away:5,home:4,p:.2}]}}};
  assert(Math.abs(liveIndicator(data,{market:'MONEYLINE',side:'HOME'}).win-.8)<1e-9);
  assert.equal(liveIndicator(data,{market:'RUNLINE',side:'HOME',line:-1.5}).win,.6);
  const over=liveIndicator(data,{market:'TOTAL',side:'OVER',line:7});
  assert.equal(over.win,.2);assert.equal(over.push,.2);
  const under=liveIndicator(data,{market:'TOTAL',side:'UNDER',line:7});
  assert.equal(under.win,.6);
  assert.equal(liveIndicator({...data,model:null},{market:'MONEYLINE',side:'HOME'}),null);
});
test('following keeps original total even as the available market changes', () => {
  const pick={market:'TOTAL',side:'OVER',line:7.5};
  const data={state,market:{live:{total:9.5}},model:{finalScores:{unresolved:0,outcomes:[{away:4,home:4,p:1}]}}};
  assert.equal(liveIndicator(data,pick).win,1);
  assert.equal(indicatorKey(pick),'TOTAL:OVER::7.5');
  assert.equal(pick.line,7.5);
});
test('final selections resolve using actual score without requiring the model', () => {
  const data={state:{...state,isLive:false,isFinal:true,awayScore:3,homeScore:4}};
  assert.equal(liveIndicator(data,{market:'MONEYLINE',side:'HOME'}).status,'HIT');
  assert.equal(liveIndicator(data,{market:'RUNLINE',side:'HOME',line:-1.5}).status,'MISSED');
  assert.equal(liveIndicator(data,{market:'TOTAL',side:'OVER',line:7}).status,'PUSH');
  assert.equal(liveIndicator({...data,state:{...data.state,isFinal:false}},{market:'MONEYLINE',side:'HOME'}),null);
});
test('hitter estimate uses observed progress, stops for replaced players, and requires sample data', () => {
  const p={id:1,side:'away',active:true,batting:{hits:0},seasonBatting:{hits:100,plateAppearances:400}};
  const data={state:{...state,inning:4,battingTeam:'away'},players:[p],model:{}};
  const pick={market:'HITS',playerId:1,line:.5};
  const result=liveIndicator(data,pick);
  assert(result.win>0 && result.win<1);assert.equal(result.approximate,true);
  p.batting.hits=1;assert.equal(liveIndicator(data,pick).status,'REACHED');
  p.batting.hits=0;p.active=false;assert.equal(liveIndicator(data,pick).win,0);
  p.active=true;p.seasonBatting.plateAppearances=0;assert.equal(liveIndicator(data,pick),null);
});
test('snapshot preserves measured pitch locations and detects a corrected pitch', () => {
  const f={gamePk:1,gameData:{status:{abstractGameState:'Live'},game:{type:'R'}},liveData:{plays:{currentPlay:{about:{atBatIndex:1},playEvents:[{isPitch:true,playId:'one',pitchNumber:1,details:{description:'Ball',isBall:true,type:{description:'Slider'}},pitchData:{startSpeed:89,coordinates:{pX:.8,pZ:2},strikeZoneTop:3.5,strikeZoneBottom:1.5}}]}}}};
  const first=snapshotFromFeed(f);assert.equal(first.currentAtBat.pitches[0].x,.8);
  assert.equal(first.currentAtBat.pitches[0].kind,'ball');
  f.liveData.plays.currentPlay.playEvents[0].pitchData.coordinates.pX=.7;
  assert.notEqual(snapshotFromFeed(f).revision,first.revision);
});
