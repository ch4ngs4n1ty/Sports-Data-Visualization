function NflField({data}) {
  const f=data.field, x=f?50+Math.max(0,Math.min(100,f.position))*5:null;
  const team=f && [data.home,data.away].find(t=>t.id===f.team);
  const [angled,setAngled]=React.useState(true);
  return <section className="nf-field" style={{'--stadium-color':data.home.color || '#174b38'}}>
    <div className="nf-stadium-title"><div><small>{data.neutralSite?'NEUTRAL VENUE':data.home.abbr+' · HOME FIELD'}</small><h3>{data.venue || data.home.name+' stadium'}</h3></div><button aria-pressed={angled} onClick={()=>setAngled(v=>!v)}>{angled?'3D view':'Top view'}</button></div><div className="nf-field-heading"><b>{team?.abbr || 'Field'} {f?.text || 'Position unavailable'}</b><span>Offense moves →</span></div>
    <div className={`nf-stadium ${angled ? 'angled' : ''}`}><div className="nf-stadium-lights" aria-hidden="true"/><div className="nf-stadium-bowl"><div className="nf-stadium-tier" aria-hidden="true"/><div className="nf-turf">
    <svg viewBox="0 0 600 270" role="img" aria-label={`Football field. Last reported position: ${f?.text || 'unavailable'}. Offense moves left to right.`}>
      <rect width="600" height="270" fill="#1a613f"/>
      {Array.from({length:10},(_,i)=><rect key={`grass-${i}`} x={50+i*50} y="0" width="25" height="270" fill="#24744c"/>)}
      <rect x="0" width="50" height="270" fill={data.home.color}/><rect x="550" width="50" height="270" fill={data.home.color}/>
      <rect x="50" y="6" width="500" height="258" fill="none" stroke="white" strokeWidth="2"/>
      {data.home.logo && <image href={data.home.logo} x="260" y="94" width="80" height="80" opacity=".65"/>}
      {Array.from({length:21},(_,i)=><g key={i}><path d={`M${50+i*25} 12V258`} stroke="white" opacity={i%2?.17:.55}/>{i%2===0 && i>0 && i<20 && <text x={50+i*25} y="42" fill="#cfdfd6" fontSize="13" textAnchor="middle">{Math.min(i*5,100-i*5)}</text>}</g>)}
      {Array.from({length:99},(_,i)=><path key={i} d={`M${55+i*5} 105v5 M${55+i*5} 160v5`} stroke="white" opacity=".4"/>)}
      {[0,550].map(offset=><g key={offset}><text transform={`translate(${offset+32} 135) rotate(${offset?90:-90})`} textAnchor="middle" fill="white" fontSize="19" fontWeight="bold" letterSpacing="3">{data.home.abbr}</text>{data.home.logo && <><circle cx={offset+25} cy="46" r="20" fill="#f4f7fa"/><circle cx={offset+25} cy="225" r="20" fill="#f4f7fa"/><image href={data.home.logo} x={offset+7} y="28" width="36" height="36"/><image href={data.home.logo} x={offset+7} y="207" width="36" height="36"/></>}</g>)}
      {f && <g><path d={`M${x} 12V258`} stroke="#44bcff" strokeWidth="3"/>{f.distance>0 && <path d={`M${Math.min(550,x+f.distance*5)} 12V258`} stroke="#ffd260" strokeWidth="3"/>}<ellipse cx={x} cy="135" rx="12" ry="8" fill="#a56032" stroke="white"/><path d={`M${x-6} 135h12`} stroke="white"/></g>}
    </svg></div></div></div><small>Blue: line of scrimmage · Gold: first down / goal · Last reported play position · Stylized stadium, offense always moves right</small>
  </section>;
}
function NflLiveTab({gameInfo}) {
  const [data,setData]=React.useState(null),[error,setError]=React.useState(''),[auto,setAuto]=React.useState(true),[refresh,setRefresh]=React.useState(0),[age,setAge]=React.useState(0);
  const [market,setMarket]=React.useState('WIN'),[line,setLine]=React.useState('44.5'),[player,setPlayer]=React.useState('');
  const storage=`piq_nfl_follows_${gameInfo.eventId}`;
  const [follows,setFollows]=React.useState(()=>{try{return JSON.parse(localStorage.getItem(storage)||'[]').filter(p=>p && typeof p.label==='string' && ['WIN','TOTAL','SPREAD','PLAYER'].includes(p.market)).slice(0,12);}catch{return [];}});
  const [history,setHistory]=React.useState({});
  React.useEffect(()=>{try{localStorage.setItem(storage,JSON.stringify(follows));}catch{}},[follows,storage]);
  const [connection,setConnection]=React.useState({status:'connecting',interval:5000});
  React.useEffect(()=>{
    if(!auto)return;
    return window.subscribeNflLive(gameInfo.eventId, update=>{
      setConnection(update);
      if(update.data){setData(update.data);setAge(Date.now()-update.data.receivedAt);}
      setError(update.status==='reconnecting'?'Connection interrupted. Retrying automatically; showing last received data.':'');
    });
  },[gameInfo.eventId,auto,refresh]);
  React.useEffect(()=>{const t=setInterval(()=>setAge(data?Date.now()-data.receivedAt:0),1000);return()=>clearInterval(t);},[data]);
  const dist=React.useMemo(()=>data?NflLive.distribution(data):null,[data]);
  const stale=!!error || age>45000 || !auto;
  React.useEffect(()=>{if(!data || stale)return;setHistory(prev=>{const next={...prev};for(const p of follows){const r=NflLive.probability(data,p,dist),k=NflLive.key(p);if(r)next[k]=[...(prev[k]||[]),r.win].slice(-40);}return next;});},[data,follows,stale,dist]);
  if(!data)return <div className="nf-live"><p>{error || 'Loading NFL live feed…'}</p><button onClick={()=>setRefresh(n=>n+1)}>Retry</button></div>;
  const changeMarket=m=>{setMarket(m);setLine(m==='SPREAD'?'-3.5':m==='PLAYER'?'249.5':'44.5');};
  const selected=data.players.find(p=>`${p.id}:${p.stat}`===player)||data.players[0];
  const numeric=line.trim()===''?NaN:Number(line);
  let picks=market==='WIN'?['AWAY','HOME'].map(side=>({market,side,label:`${data[side.toLowerCase()].abbr} regulation win`})):
    market==='SPREAD'?['HOME','AWAY'].map(side=>({market,side,line:side==='HOME'?numeric:-numeric,label:`${data[side.toLowerCase()].abbr} ${side==='HOME'?numeric>=0?'+':'':-numeric>=0?'+':''}${side==='HOME'?numeric:-numeric}`})):
    ['OVER','UNDER'].map(side=>({market,side,line:numeric,...(market==='PLAYER'?{playerId:selected?.id,stat:selected?.stat}:{}),label:`${market==='PLAYER'?selected?.name+' '+selected?.stat+' yards · ':''}${side==='OVER'?'Over':'Under'} ${numeric}`}));
  const toggle=p=>setFollows(prev=>prev.some(x=>NflLive.key(x)===NflLive.key(p))?prev.filter(x=>NflLive.key(x)!==NflLive.key(p)):prev.length<12?[...prev,p]:prev);
  const percent=r=>!r?'—':!r.settled && r.win>.99?'>99%':!r.settled && r.win<.01?'<1%':`${Math.round(r.win*100)}%`;
  const card=(p,following=false)=>{const r=NflLive.probability(data,p,dist),k=NflLive.key(p),saved=follows.some(x=>NflLive.key(x)===k),h=history[k]||[];return <div className="nf-pick" key={k}><div><b>{p.label}</b><strong className={stale?'nf-muted':''}>{percent(r)}</strong></div><meter min="0" max="1" value={r?.win || 0} aria-label={`${p.label} estimated chance`}/><small>{r?.settled?(p.market==='PLAYER'?'Final result':'Regulation result'):stale?(auto?'Reconnecting · last estimate':'Manually paused'):p.market==='PLAYER'?'Rough pace estimate':'Estimated chance'}{r?.push>=.0005?` · ${(r.push*100).toFixed(1)}% ${p.market==='WIN'?'tie':'push'}`:''}{r?.value!=null?` · ${r.value} yards now`:''}</small>{following && h.length>1 && <small>{((h.at(-1)-h[0])*100).toFixed(1)} percentage points since following this visit</small>}<button disabled={!following && (!r || stale || (!saved && follows.length>=12))} onClick={()=>toggle(p)}>{saved?'✓ Following · remove':'+ Follow'}</button></div>;};
  return <div className="nf-live"><header className="nf-score"><div><img src={data.away.logo} alt=""/><b>{data.away.abbr}</b><strong>{data.away.score??'—'}</strong></div><p>{data.status}<small>{!auto?'● MANUALLY PAUSED':stale?'● RECONNECTING':data.final?'FINAL':'● FREE ESPN FEED'}</small></p><div><strong>{data.home.score??'—'}</strong><b>{data.home.abbr}</b><img src={data.home.logo} alt=""/></div></header>
    <div className="nf-toolbar"><span>Checked {Math.floor(age/1000)}s ago · polls every {connection.interval/1000}s · provider delay unknown</span><button onClick={()=>setAuto(v=>!v)}>{auto?'Pause':'Resume'}</button><button onClick={()=>setRefresh(n=>n+1)}>Refresh</button></div>{error && <p role="status">{error}</p>}
    <div className="nf-columns"><div><NflField data={data}/><section className="nf-plays"><h3>Latest plays</h3>{data.plays.length?data.plays.map(p=><article key={p.id} className={p.scoringPlay?'score':p.isTurnover?'turnover':''}><small>Q{p.period?.number} · {p.clock?.displayValue} · {p.type?.text}</small><p>{p.text}</p></article>):<p>Play-by-play unavailable.</p>}</section></div>
    <aside><small>PLAYIQ · NFL LIVE</small><h2>Live indicators</h2><p>Follow a line and watch its estimated chance change.</p><nav>{[['WIN','Win'],['SPREAD','Spread'],['TOTAL','Total'],['PLAYER','Player yards']].map(([m,l])=><button key={m} aria-pressed={market===m} onClick={()=>changeMarket(m)}>{l}</button>)}</nav>
      <p className="nf-note">{market==='PLAYER'?'Player yards: rough projection to end of regulation; final results include overtime.':'Game markets: regulation only (first four quarters). Overtime excluded. Win ties shown separately.'}</p>
      {market==='PLAYER' && <label>Player / stat<select value={selected?`${selected.id}:${selected.stat}`:''} onChange={e=>setPlayer(e.target.value)}>{data.players.map(p=><option key={`${p.id}:${p.stat}`} value={`${p.id}:${p.stat}`}>{p.name} · {p.stat} ({p.value} yd)</option>)}</select></label>}
      {market!=='WIN' && <label>{market==='SPREAD'?`${data.home.abbr} spread`:'Your line'}<input type="number" step="0.5" value={line} onChange={e=>setLine(e.target.value)}/></label>}
      {picks.map(p=>card(p))}<p className="nf-note">User-entered lines, not sportsbook quotes. Higher probability does not mean better betting value.</p><h3>Following · {follows.length}/12</h3><p className="nf-note">Saved lines stay fixed as the game changes.</p>{follows.length?follows.map(p=>card(p,true)):<p>No selections followed yet.</p>}
      <details><summary>How the percentages work</summary><p>Game estimates use current score, clock, and a scoring-event distribution. Observed scoring pace is blended with an assumed 22 points per team per game; scoring events are assumed to be 65% seven points and 35% three points. These assumptions are not fitted or calibrated. The model does not use possession, field position, team strength, injuries, timeouts, or overtime.</p><p>Player yards extrapolate current pace after 10 minutes with an assumed uncertainty band. Negative yardage remains possible. Usage, substitutions, injuries, opponent strength, and overtime are not predicted. Percentages are unavailable in overtime until final stats arrive. These are experimental estimates, not validated recommendations.</p></details>
    </aside></div></div>;
}
window.NflLiveTab=NflLiveTab;
