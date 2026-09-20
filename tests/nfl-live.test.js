const test=require('node:test'),assert=require('node:assert/strict');
const {NflLive:n}=require('../frontend/data/nfl/live');
const state={home:{score:10},away:{score:7},period:3,remaining:1200,live:true,final:false,players:[{id:'1',stat:'rushing',value:40}]};
test('NFL score distribution conserves mass and complementary totals include push',()=>{
 const d=n.distribution(state);assert(Math.abs(d.reduce((s,o)=>s+o.p,0)-1)<1e-8);
 const over=n.probability(state,{market:'TOTAL',side:'OVER',line:30},d),under=n.probability(state,{market:'TOTAL',side:'UNDER',line:30},d);
 assert(Math.abs(over.win+under.win+over.push-1)<1e-8);assert(over.push>0);
 const higher=n.probability(state,{market:'TOTAL',side:'OVER',line:50},d);assert(higher.win<over.win);
});
test('NFL spreads preserve signs and final regulation excludes overtime points',()=>{
 const s={...state,period:5,final:true,home:{score:27,regScore:20},away:{score:20,regScore:20}},d=n.distribution(s);
 assert.equal(n.probability(s,{market:'WIN',side:'HOME'},d).push,1);
 assert.equal(n.probability(s,{market:'SPREAD',side:'HOME',line:-3.5},d).win,0);
 assert.equal(n.probability(s,{market:'SPREAD',side:'AWAY',line:3.5},d).win,1);
 assert.equal(n.distribution({...s,home:{score:27}}),null);
});
test('NFL missing clock and pregame do not create forecasts',()=>{
 assert.equal(n.distribution({...state,remaining:null}),null);
 assert.equal(n.distribution({...state,live:false}),null);
});
test('player yardage can decline, missing players and overtime are withheld',()=>{
 const p={market:'PLAYER',playerId:'1',stat:'rushing',side:'OVER',line:39.5};
 assert(n.probability(state,p).win<1);
 assert.equal(n.probability({...state,period:5},p),null);
 assert.equal(n.probability({...state,players:[]},p),null);
 assert.equal(n.probability({...state,remaining:3500},p),null);
 assert.equal(n.probability({...state,final:true},p).win,1);
 assert.equal(n.probability({...state,final:true},{...p,line:40}).push,1);
});
test('NFL normalization reads end position and negative player yards',()=>{
 const d=n.normalize({header:{competitions:[{status:{period:2,displayClock:'1:00',type:{state:'in'}},competitors:['home','away'].map((side,i)=>({id:String(i),homeAway:side,score:'3',team:{abbreviation:side}}))}]},drives:{current:{plays:[{id:'1',sequenceNumber:'1',end:{yardsToEndzone:23,distance:4,team:{id:'0'}}}]}},boxscore:{players:[{team:{abbreviation:'H'},statistics:[{name:'rushing',labels:['YDS'],athletes:[{athlete:{id:'1',displayName:'Runner'},stats:['-2']}]}]}]}});
 assert.equal(d.remaining,1860);assert.equal(d.field.position,77);assert.equal(d.players[0].value,-2);
});
