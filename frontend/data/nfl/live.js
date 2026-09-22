// Free ESPN snapshots; pure normalization and explicit, uncalibrated regulation models.
(function(root) {
  const number = v => v == null || v === '' || v === '--' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
  function normalize(summary) {
    const c = summary.header?.competitions?.[0];
    if (!c?.competitors?.length) throw new Error('Game feed unavailable');
    const status = c.status || {}, period = number(status.period);
    const parts = (status.displayClock || '').split(':').map(Number);
    const clock = parts.length === 2 && parts.every(Number.isFinite) ? parts[0]*60+parts[1] : null;
    const final = !!status.type?.completed;
    const team = side => { const t = c.competitors.find(x=>x.homeAway===side); return {id:String(t.id),abbr:t.team.abbreviation,name:t.team.displayName,color:/^[a-f0-9]{6}$/i.test(t.team.color || '')?'#'+t.team.color:'#174b38',logo:t.team.logos?.[0]?.href,score:number(t.score),regScore: t.linescores?.length >= 4 ? t.linescores.slice(0,4).reduce((n,q)=>n+Number(q.displayValue || 0),0) : null}; };
    const plays = [...(summary.drives?.previous || []).flatMap(d=>d.plays || []), ...(summary.drives?.current?.plays || [])];
    const unique = [...new Map(plays.map(p=>[p.id,p])).values()].sort((a,b)=>Number(a.sequenceNumber)-Number(b.sequenceNumber));
    const last = unique.at(-1), end = last?.end;
    const players = [];
    for (const t of summary.boxscore?.players || []) for (const g of t.statistics || []) {
      if (!['passing','rushing','receiving'].includes(g.name)) continue;
      const idx = g.labels?.indexOf('YDS');
      if (idx == null || idx < 0) continue;
      for (const a of g.athletes || []) { const value = number(a.stats?.[idx]); if(value != null) players.push({id:String(a.athlete.id),name:a.athlete.displayName,team:t.team.abbreviation,stat:g.name,value}); }
    }
    return {venue:summary.gameInfo?.venue?.fullName || c.venue?.fullName || null,neutralSite:!!c.neutralSite,lastPlayAt:last?.wallclock || null,home:team('home'),away:team('away'),period,clock,final,live:status.type?.state==='in',status:status.type?.shortDetail || status.type?.description,
      remaining:period && period<=4 && clock!=null ? Math.max(0,(4-period)*900+clock) : period>4 || final ? 0 : null,
      field:end && number(end.yardsToEndzone)!=null ? {position:100-number(end.yardsToEndzone),distance:number(end.distance),down:end.down,team:String(end.team?.id),text:end.downDistanceText || end.possessionText || `${100-number(end.yardsToEndzone)} yards from own goal`} : null,
      plays:unique.slice(-12).reverse(),players,receivedAt:Date.now()};
  }
  // Compound Poisson: assumed 65% seven-point and 35% three-point scoring events.
  function points(mean) {
    const lambda=mean/5.6, out=Array(121).fill(0);out[0]=Math.exp(-lambda);
    for(let n=1;n<out.length;n++) out[n]=lambda*((n>=3?3*.35*out[n-3]:0)+(n>=7?7*.65*out[n-7]:0))/n;
    const mass=out.reduce((a,b)=>a+b,0);return out.map(p=>p/mass);
  }
  function distribution(d) {
    if(d.remaining==null || (!d.live && !d.final) || d.home.score==null || d.away.score==null) return null;
    if(d.final || d.period>4) {
      const h=d.home.regScore ?? (d.period<=4?d.home.score:null), a=d.away.regScore ?? (d.period<=4?d.away.score:null);
      return h==null || a==null ? null : [{home:h,away:a,p:1}];
    }
    const elapsed=3600-d.remaining;
    // Shrink observed scoring pace toward an explicitly assumed 22 points/team/game.
    const rate=score=>(22+score)/(3600+elapsed)*d.remaining;
    const h=points(rate(d.home.score)),a=points(rate(d.away.score)),out=[];
    h.forEach((hp,hi)=>a.forEach((ap,ai)=>{if(hp*ap>1e-12)out.push({home:d.home.score+hi,away:d.away.score+ai,p:hp*ap});}));return out;
  }
  function cdf(x) {const t=1/(1+.2316419*Math.abs(x));const p=.39894228*Math.exp(-x*x/2)*t*(.31938153+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return x>=0?1-p:p;}
  function probability(d,pick,dist) {
    if(!Number.isFinite(pick.line) && pick.market!=='WIN') return null;
    if(pick.market==='PLAYER') {
      const p=d.players.find(x=>x.id===pick.playerId && x.stat===pick.stat); if(!p)return null;
      if(d.final) {const v=(p.value-pick.line)*(pick.side==='OVER'?1:-1);return {win:v>0?1:0,push:v===0?1:0,settled:true,value:p.value};}
      const elapsed=3600-d.remaining;
      if(!d.live || d.period>4 || d.remaining==null || elapsed<600 || d.remaining<=0)return null;
      // Yardage may fall: do not declare a hit when current yards cross the line.
      const mean=p.value+Math.max(0,p.value)/elapsed*d.remaining;
      const sd=Math.max(8,Math.sqrt(d.remaining/60)*(pick.stat==='passing'?9:5));
      const lower=Number.isInteger(pick.line)?pick.line-.5:Math.floor(pick.line)+.5;
      const upper=Number.isInteger(pick.line)?pick.line+.5:lower;
      const under=cdf((lower-mean)/sd),over=1-cdf((upper-mean)/sd);
      return {win:pick.side==='OVER'?over:under,push:Math.max(0,1-over-under),value:p.value};
    }
    if(!dist)return null;
    let win=0,push=0;
    for(const o of dist) {let v=pick.market==='TOTAL'?(o.home+o.away-pick.line)*(pick.side==='OVER'?1:-1):(pick.side==='HOME'?o.home-o.away:o.away-o.home)+(pick.market==='SPREAD'?pick.line:0);if(v>0)win+=o.p;else if(v===0)push+=o.p;}
    return {win,push,settled:d.final || d.period>4 || d.remaining===0};
  }
  const key=p=>[p.market,p.side,p.playerId || '',p.stat || '',p.line??''].join(':');
  root.NflLive={normalize,distribution,probability,key};
})(typeof window==='undefined'?module.exports:window);
