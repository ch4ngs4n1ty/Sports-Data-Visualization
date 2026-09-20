function LivePortrait({ player, size = 40 }) {
  return <span className="li-portrait" style={{ width: size, height: size }}>
    {player?.id ? <img alt="" src={`https://img.mlbstatic.com/mlb-photos/image/upload/w_120,q_auto:best/v1/people/${player.id}/headshot/67/current`} onError={e => { e.currentTarget.style.display = 'none'; }} /> : null}
  </span>;
}
function LiveBases({ bases, outs }) {
  return <div className="li-bases" aria-label={`${bases & 1 ? 'Runner on first. ' : ''}${bases & 2 ? 'Runner on second. ' : ''}${bases & 4 ? 'Runner on third. ' : ''}${outs} outs`}>
    <svg viewBox="0 0 170 120" aria-hidden="true">
      {[[85,32,2],[128,75,1],[42,75,4]].map(([x,y,bit]) => <rect key={bit} x={x-22} y={y-22} width="44" height="44" transform={`rotate(45 ${x} ${y})`} fill={bases & bit ? '#fb3345' : '#272c30'} />)}
    </svg>
    <div className="li-out-dots">{[0,1,2].map(i => <i key={i} className={i < outs ? 'on' : ''} />)}</div>
  </div>;
}
function livePitchKind(p) {
  return /foul/i.test(p.description || '') ? 'foul' : p.kind;
}
function LivePitchZone({ pitches }) {
  const located = pitches.filter(p => Number.isFinite(p.x) && Number.isFinite(p.z) && p.zoneTop > p.zoneBottom);
  return <div className="li-zone">
    <svg viewBox="0 0 200 225" role="img" aria-label="Pitch locations from the pitcher's view. Numbered by pitch sequence.">
      <rect x="50" y="45" width="100" height="112" fill="#151b23" stroke="#656a73" />
      {[1,2].map(i => <g key={i} stroke="#454a52"><path d={`M${50+i*100/3} 45V157`} /><path d={`M50 ${45+i*112/3}H150`} /></g>)}
      <path d="M76 205 L100 191 L124 205 V217 H76 Z" fill="#353b42" />
      {located.map(p => {
        const x = 100 - p.x * (100 / (17/12));
        const y = 45 + (p.zoneTop - p.z) / (p.zoneTop - p.zoneBottom) * 112;
        if (x < 10 || x > 190 || y < 10 || y > 180) return null;
        return <g key={p.id}><circle cx={x} cy={y} r="11" className={`li-pitch-dot ${livePitchKind(p)}`} stroke="#07090d" strokeWidth="2" /><text x={x} y={y+4} fill="white" fontSize="12" textAnchor="middle" fontWeight="700">{p.number}</text></g>;
      })}
    </svg>
    <div className="li-pitch-legend" aria-label="Pitch outcome colors">{[['ball','Ball'],['strike','Strike'],['foul','Foul'],['inplay','In play']].map(([kind,label]) => <span key={kind}><i className={kind} />{label}</span>)}</div>
    <small>{located.length ? 'Pitcher view · measured locations' : 'Pitch location data unavailable'}</small>
  </div>;
}
function LiveProbability({ value, muted = false }) {
  const percent = value == null ? null : value * 100;
  const label = percent == null ? '—' : percent > 0 && percent < 1 ? '<1%' : percent < 100 && percent > 99 ? '>99%' : `${Math.round(percent)}%`;
  return <div className={`li-prob ${muted ? 'muted' : ''}`}>
    <strong>{label}</strong>
    <div className="li-meter"><i style={{ width: `${percent || 0}%` }} /></div>
  </div>;
}
function LiveIndicatorBoard({ data, gameInfo, status, healthy, error, onRefresh, auto, onToggle }) {
  const s = data.state;
  const [view, setView] = React.useState('feed');
  const [mobilePane, setMobilePane] = React.useState('feed');
  const [market, setMarket] = React.useState('MONEYLINE');
  const [totalLine, setTotalLine] = React.useState('8.5');
  const [runLine, setRunLine] = React.useState('-1.5');
  const [hitLine, setHitLine] = React.useState('0.5');
  const [storageError, setStorageError] = React.useState(false);
  const [following, setFollowing] = React.useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(`piq_live_follows_${data.gamePk}`) || '[]'); return Array.isArray(saved) ? saved.slice(0,12) : []; }
    catch { return []; }
  });
  const [history, setHistory] = React.useState({});
  const totalEdited = React.useRef(false);
  React.useEffect(() => {
    if (!totalEdited.current && Number.isFinite(data.market?.live?.total)) setTotalLine(String(data.market.live.total));
  }, [data.market?.live?.total]);
  const ready = healthy && (s.isFinal || !!data.model);
  const follow = pick => {
    const id = indicatorKey(pick);
    const next = following.some(p => indicatorKey(p) === id) ? following.filter(p => indicatorKey(p) !== id)
      : following.length >= 12 ? following : [...following, { ...pick, followedAt: new Date().toISOString() }];
    setFollowing(next);
    try { localStorage.setItem(`piq_live_follows_${data.gamePk}`, JSON.stringify(next)); setStorageError(false); }
    catch { setStorageError(true); }
  };
  React.useEffect(() => {
    if (!ready) return;
    setHistory(prev => {
      const next = { ...prev };
      following.forEach(p => {
        const result = liveIndicator(data, p), id = indicatorKey(p);
        if (!result) return;
        const rows = next[id] || [];
        if (rows.at(-1)?.revision === data.revision) return;
        const updated = [...rows, { revision: data.revision, p: result.win }];
        next[id] = updated.length > 40 ? [updated[0], ...updated.slice(-39)] : updated;
      });
      return next;
    });
  }, [data.revision, data.model, ready, following]);
  const validLine = v => v !== '' && Number.isFinite(Number(v)) && Number(v) * 2 === Math.round(Number(v) * 2);
  let picks = market === 'MONEYLINE' ? ['AWAY','HOME'].map(side => ({ market, side }))
    : market === 'RUNLINE' && validLine(runLine) ? [{market,side:'HOME',line:Number(runLine)}, {market,side:'AWAY',line:-Number(runLine)}]
    : market === 'TOTAL' && validLine(totalLine) && Number(totalLine) >= 0 ? ['OVER','UNDER'].map(side => ({ market, side, line:Number(totalLine) }))
    : market === 'HITS' && validLine(hitLine) && Number(hitLine) >= 0 ? (data.players || []).filter(p => p.active && p.battingOrder && p.seasonBatting?.plateAppearances >= 50)
      .map(p => ({ market, playerId:p.id, playerName:p.name, line:Number(hitLine) })) : [];
  const candidates = picks.map(pick => ({ pick, result: ready ? liveIndicator(data, pick) : null }));
  const best = Math.max(0, ...candidates.filter(c => c.result && c.result.win < 1).map(c => c.result.win));
  const bat = data.currentAtBat;
  const batterId = bat && !bat.complete ? bat.batter?.id : s.currentBatter?.id;
  const batter = data.players?.find(p => p.id === batterId);
  const batterName = bat && !bat.complete ? bat.batter?.fullName : s.currentBatter?.name;
  const pitcher = data.players?.find(p => p.id === s.currentPitcher?.id);
  const statLine = p => p ? `${p.batting.hits ?? 0}/${p.batting.atBats ?? 0}${p.seasonBatting?.avg ? ` · ${p.seasonBatting.avg}` : ''}` : 'Stats pending';
  return <section className={`li-live li-pane-${mobilePane}`}>
    <header className="li-scoreboard">
      {['away','home'].map((side,i) => <React.Fragment key={side}>
        {i === 1 && <div className="li-inning"><b><i /> {s.isFinal ? 'Final' : s.isLive ? `${s.betweenInnings ? 'Next · ' : ''}${s.half === 'top' ? 'Top' : 'Bot'} ${s.inning}` : s.status}</b><span>{s.isFinal ? 'Game complete' : `${s.outs} out${s.outs === 1 ? '' : 's'}`}</span><small>{status === 'live' ? '● LIVE FEED' : status.toUpperCase()}</small></div>}
        <div className={`li-team ${side}`}><img alt="" src={gameInfo[`${side}Logo`] || `https://www.mlbstatic.com/team-logos/${s[side].id}.svg`} /><strong>{s[`${side}Score`]}</strong><span>{s[side].name || s[side].abbr}</span></div>
      </React.Fragment>)}
    </header>
    <div className="li-toolbar"><span>MLB · {s.venue || 'Live game'}</span><div><button onClick={onToggle}>{auto ? 'Pause' : 'Resume'}</button><button onClick={onRefresh}>↻ Refresh</button></div></div>
    {(!healthy || error) && <div className="li-notice" role="status">{error || 'Updates paused or reconnecting.'} Last received values remain visible; probabilities are paused.</div>}
    <nav className="li-mobile-switch" aria-label="Live panel"><button aria-pressed={mobilePane === 'feed'} onClick={() => setMobilePane('feed')}>Game feed</button><button aria-pressed={mobilePane === 'indicators'} onClick={() => setMobilePane('indicators')}>Live indicators {following.length ? `· ${following.length} following` : ''}</button></nav>
    <div className="li-columns">
      <div className="li-game">
        <nav className="li-nav" aria-label="Live game views">{[['feed','Feed'],['game','Game'],['away',s.away.abbr],['home',s.home.abbr]].map(([id,label]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}</nav>
        {view === 'feed' ? <>
          <div className="li-next"><div>{[[s.onDeck,'On deck'],[s.inHole,'In the hole']].map(([p,label]) => <div className="li-next-player" key={label}><LivePortrait player={p} /><div><small>{label}</small><b>{p?.name || 'Waiting for lineup'}</b><span>{statLine(data.players?.find(x => x.id === p?.id))}</span></div></div>)}</div><LiveBases bases={s.bases} outs={s.outs} /></div>
          <div className="li-atbat"><div className="li-matchup"><LivePortrait player={{id:batterId}} size={54} /><div><h3>{s.isFinal ? 'Final plate appearance' : s.betweenInnings ? 'Between innings' : `${s.balls} ball${s.balls === 1 ? '' : 's'}, ${s.strikes} strike${s.strikes === 1 ? '' : 's'}`}</h3><b>{batterName || 'Batter pending'} <span>· {statLine(batter)} {bat?.batSide ? `(${bat.batSide})` : ''}</span></b><p>{s.currentPitcher?.name || 'Pitcher pending'} · {pitcher?.pitching.inningsPitched ?? '—'} IP, {pitcher?.pitching.strikeOuts ?? '—'} K, {pitcher?.pitching.earnedRuns ?? '—'} ER, {pitcher?.pitching.numberOfPitches ?? '—'} P</p></div></div>
          <div className="li-pitch-content"><div className="li-pitches"><small>{bat?.complete ? 'Last plate appearance' : 'This plate appearance'}</small>{(bat?.pitches || []).slice().reverse().map(p => <div className="li-pitch" key={p.id}><i className={livePitchKind(p)}>{p.number}</i><div><b>{p.description}</b><span>{p.type || 'Pitch'}{p.speed != null ? ` · ${p.speed.toFixed(1)} mph` : ''}</span></div></div>)}{!bat?.pitches?.length && <p>Waiting for pitch data.</p>}</div><LivePitchZone pitches={bat?.pitches || []} /></div></div>
          <div className="li-plays"><h3>Recent plays</h3>{(data.recentPlays || []).map(p => <div key={p.id}><small>{p.half === 'top' ? '▲' : '▼'} {p.inning}</small><p>{p.description}</p><b>{p.awayScore}–{p.homeScore}</b></div>)}</div>
        </> : view === 'game' ? <div className="li-linescore"><h3>Inning by inning</h3><div><table><thead><tr><th>Team</th>{s.innings.map(i => <th key={i.num}>{i.num}</th>)}<th>R</th></tr></thead><tbody>{['away','home'].map(side => <tr key={side}><th>{s[side].abbr}</th>{s.innings.map(i => <td key={i.num}>{i[side] ?? '—'}</td>)}<td>{s[`${side}Score`]}</td></tr>)}</tbody></table></div></div>
        : <div className="li-team-stats"><h3>{s[view].name}</h3>{(data.players || []).filter(p => p.side === view).map(p => <div key={p.id}><LivePortrait player={p} /><div><b>{p.name}</b><span>{p.batting.atBats != null ? `${p.batting.hits} H · ${p.batting.atBats} AB · ${p.batting.rbi} RBI · ${p.batting.homeRuns} HR` : `${p.pitching.inningsPitched || '0.0'} IP · ${p.pitching.strikeOuts || 0} K · ${p.pitching.earnedRuns || 0} ER`}</span></div></div>)}</div>}
      </div>
      <aside className="li-indicators">
        <div className="li-section-title"><small>PLAYIQ LIVE</small><h2>Live indicators</h2><p>Choose a line. Follow its chance as the game unfolds.</p></div>
        <div className="li-market-nav" aria-label="Prediction markets">{[['MONEYLINE','Win'],['RUNLINE','Run line'],['TOTAL','Total'],['HITS','Player hits']].map(([id,label]) => <button key={id} aria-pressed={market === id} onClick={() => setMarket(id)}>{label}</button>)}</div>
        {market !== 'MONEYLINE' && <label className="li-line-input">{market === 'TOTAL' ? 'Total runs line' : market === 'RUNLINE' ? `${s.home.abbr} run line` : 'Player hits line'}<input type="number" step="0.5" min={market === 'RUNLINE' ? undefined : 0} value={market === 'TOTAL' ? totalLine : market === 'RUNLINE' ? runLine : hitLine} onChange={e => { if (market === 'TOTAL') { totalEdited.current = true; setTotalLine(e.target.value); } else if (market === 'RUNLINE') setRunLine(e.target.value); else setHitLine(e.target.value); }} /><small>{market === 'TOTAL' && !totalEdited.current && data.market?.live?.total != null ? 'Reference line · quote age unknown' : 'Your line · not a verified sportsbook quote'}</small></label>}
        {!ready && <div className="li-notice" role="status">{healthy ? 'Updating probabilities for the latest game state…' : 'Waiting for a current game snapshot…'}</div>}
        {!s.isLive && !s.isFinal && <p className="li-empty">Live predictions begin when play starts.</p>}
        {!picks.length && <p className="li-empty">{market === 'HITS' ? 'No eligible hitters or valid line available.' : 'Enter a valid line in half-run increments.'}</p>}
        <div className="li-candidates">{candidates.map(({pick,result}) => {
          const selected = following.some(p => indicatorKey(p) === indicatorKey(pick));
          const favored = result && result.win === best && best >= .6;
          return <button className={`li-pick ${selected ? 'selected' : ''}`} key={indicatorKey(pick)} disabled={!ready || !result || (!selected && following.length >= 12)} aria-pressed={selected} onClick={() => follow(pick)}>
            <div><b>{indicatorLabel(pick,s,data.players)}</b><span>{result?.progress || (favored ? 'Higher likelihood · model estimate' : 'Estimated chance to hit')}</span><small>{result?.push > .001 ? `${(result.push*100).toFixed(1)}% push · ` : ''}{result?.fairOdds != null ? `Fair price ${result.fairOdds > 0 ? '+' : ''}${result.fairOdds}` : result?.status || ''}</small></div><LiveProbability value={result?.win} /><em>{selected ? '✓ Following' : '＋ Follow'}</em>
          </button>;
        })}</div>
        <p className="li-disclaimer">Probabilities estimate outcomes, not betting value. A likely winner can still be overpriced. No paid odds feed is connected.</p>
        <div className="li-section-title"><h2>Following <span>{following.length}/12</span></h2><p>Your original lines stay fixed. The percentages update.</p></div>
        {!following.length && <p className="li-empty">Tap an indicator above to follow a pick.</p>}
        {storageError && <div className="li-notice">Selections are kept for this visit, but browser storage is unavailable.</div>}
        {following.map(pick => {
          const id = indicatorKey(pick), rows = history[id] || [], result = ready ? liveIndicator(data,pick) : null;
          const last = result?.win ?? rows.at(-1)?.p;
          const change = result && rows.length ? (result.win - rows[0].p)*100 : null;
          return <div className="li-follow" key={id}><div className="li-follow-title"><b>{indicatorLabel(pick,s,data.players)}</b><button aria-label={`Stop following ${indicatorLabel(pick,s,data.players)}`} onClick={() => follow(pick)}>×</button></div>
            <div className="li-follow-value"><LiveProbability value={last} muted={!result} /><span>{!result ? 'Paused / updating' : result.status !== 'LIVE' ? result.status : change == null || Math.abs(change) < .1 ? 'Holding steady' : `${change > 0 ? '↑' : '↓'} ${Math.abs(change).toFixed(1)} pts this visit`}</span></div>
            {rows.length > 1 && <svg className="li-trend" viewBox="0 0 200 36" preserveAspectRatio="none" role="img" aria-label="Probability trend during this visit"><polyline points={rows.map((r,i) => `${i/(rows.length-1)*200},${34-r.p*32}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" /></svg>}
            <small>{result?.progress || (result?.push > .001 ? `${(result.push*100).toFixed(1)}% chance of a push` : 'Estimated chance of winning this selection')}</small>
          </div>;
        })}
        <details className="li-method"><summary>How these estimates work</summary><p>Game estimates use inning, runners, outs and pitcher/bullpen assumptions, with extra innings and game-ending rules. The current ball/strike count is displayed but not modeled. Walk-off home-run excess is omitted, so totals and run lines near the end are approximate.</p><p>Player hits use season hit rate and estimated remaining regulation opportunities. They do not adjust for batting order, current count, individual matchup or future extra innings. These estimates have not been calibrated against live betting results.</p><p>Free-feed updates are periodic, not instantaneous. Final results can be corrected; sportsbook rules can differ.</p></details>
      </aside>
    </div>
  </section>;
}
Object.assign(window, { LiveIndicatorBoard });
