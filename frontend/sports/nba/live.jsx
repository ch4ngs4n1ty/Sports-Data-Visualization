/* ============================================================
   PLAYIQ — NBA LIVE tab
   Court tracker (real on-floor fives, ball + acting player at the real
   event location) + live win / spread / total pricing vs DraftKings' live
   line + live player-prop projections. Data + model: frontend/data/nba/live.js
   (window.NbaLive). Every top-level name here starts with _nl or NbaLive — all .jsx
   files share ONE global scope, and a collision kills the whole file.
   ============================================================ */

const _nlPct = p => (p == null ? '—' : p > 0.995 ? '>99%' : p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`);
const _nlOdds = a => (a == null ? '—' : a > 0 ? `+${a}` : `${a}`);
const _nlLast = n => { const s = String(n || '').replace(/\s+(Jr\.|Sr\.|II|III|IV)$/i, '').split(' '); return s.length > 1 ? s.slice(1).join(' ') : s[0]; };
const _nlAge = s => (s == null ? '' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
/* A readable team colour on a dark floor: ESPN's primary is sometimes near
   black (e.g. #000000), so fall back to the alternate, then to a theme hue. */
function _nlTeamColor(team, fallback) {
  const ok = hex => { if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return false; const n = parseInt(hex.slice(1), 16); const l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); return l > 45; };
  return ok(team?.color) ? team.color : ok(team?.alt) ? team.alt : fallback;
}

/* ── the court ─────────────────────────────────────────────────── */
function NbaLiveCourtEnd({ mirror, paint, line }) {
  // One half's markings in feet; the right end is the same group mirrored.
  const g = mirror ? 'translate(94 0) scale(-1 1)' : undefined;
  const arcX = 5.25 + Math.sqrt(23.75 ** 2 - 22 ** 2);
  return (
    <g transform={g} stroke={line} strokeWidth="0.22" fill="none">
      <rect x="0" y="17" width="19" height="16" fill={paint} />
      <circle cx="19" cy="25" r="6" />
      <path d="M 4 22 V 28" strokeWidth="0.35" />
      <circle cx="5.25" cy="25" r="0.75" stroke="#ff8a3c" strokeWidth="0.25" />
      <path d="M 5.25 21 A 4 4 0 0 1 5.25 29" />
      <path d={`M 0 3 H ${arcX} A 23.75 23.75 0 0 1 ${arcX} 47 H 0`} />
    </g>
  );
}

function NbaLiveCourt({ data, poss, lastEvent, trail, layout, selectedId, onSelect, tilt }) {
  const awayCol = _nlTeamColor(data.away, '#00d4ff');
  const homeCol = _nlTeamColor(data.home, '#ffd060');
  const colorOf = side => (side === 'home' ? homeCol : awayCol);
  const line = 'rgba(230,240,255,0.55)';
  // Ball: at the newest located event, else with the offense's top player.
  let ball = null;
  if (lastEvent?.court) {
    if (lastEvent.kind === 'shot' && lastEvent.scoring) {
      const end = window.NbaLive.attackEnd(lastEvent.side);
      ball = { X: end === 'right' ? 88.75 : 5.25, Y: 25 };
    } else ball = lastEvent.court;
  } else if (poss?.side) {
    const handler = layout.find(t => t.side === poss.side && t.role !== 'def');
    if (handler) ball = { X: handler.X + 1.2, Y: handler.Y - 1.2 };
  }
  const pop = lastEvent?.kind === 'shot' && lastEvent.scoring ? `+${lastEvent.value || 2}` : lastEvent?.kind === 'ft' && lastEvent.scoring ? '+1' : null;
  return (
    <div className="nl-courtwrap" style={{ '--tilt': `${tilt}deg` }}>
      <div className="nl-plane" role="img" aria-label={`Court: ${data.away.abbr} attack the left basket, ${data.home.abbr} the right.`}>
        <svg viewBox="0 0 94 50" preserveAspectRatio="none">
          <defs>
            <linearGradient id="nlWood" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#3a2a1c" /><stop offset="0.5" stopColor="#4a3523" /><stop offset="1" stopColor="#33251a" />
            </linearGradient>
            <pattern id="nlBoards" width="94" height="1.6" patternUnits="userSpaceOnUse">
              <rect width="94" height="1.6" fill="url(#nlWood)" /><path d="M0 1.58 H94" stroke="rgba(0,0,0,0.22)" strokeWidth="0.06" />
            </pattern>
          </defs>
          <rect width="94" height="50" fill="url(#nlBoards)" />
          <rect width="94" height="50" fill="rgba(5,8,15,0.42)" />
          <NbaLiveCourtEnd paint={`${awayCol}38`} line={line} />
          <NbaLiveCourtEnd mirror paint={`${homeCol}38`} line={line} />
          <g stroke={line} strokeWidth="0.22" fill="none">
            <rect x="0.15" y="0.15" width="93.7" height="49.7" strokeWidth="0.35" />
            <path d="M 47 0 V 50" /><circle cx="47" cy="25" r="6" /><circle cx="47" cy="25" r="2" />
          </g>
          {data.home.logo && <image href={data.home.logo} x="43" y="21" width="8" height="8" opacity="0.5" preserveAspectRatio="xMidYMid meet" />}
          <text x="11" y="1.9" fontSize="1.5" fill="rgba(230,240,255,0.6)" fontFamily="Orbitron, monospace" textAnchor="middle">{data.away.abbr} ATTACK ←</text>
          <text x="83" y="1.9" fontSize="1.5" fill="rgba(230,240,255,0.6)" fontFamily="Orbitron, monospace" textAnchor="middle">→ {data.home.abbr} ATTACK</text>
          {/* recent shots: filled = made, × = missed. Newest is largest. */}
          {trail.map((s, i) => {
            const c = colorOf(s.side), r = i === trail.length - 1 ? 0.95 : 0.6, o = 0.35 + 0.65 * ((i + 1) / trail.length);
            return s.made
              ? <circle key={s.id} cx={s.court.X} cy={s.court.Y} r={r} fill={c} opacity={o} stroke="#fff" strokeWidth="0.1"><title>{s.text}</title></circle>
              : <g key={s.id} opacity={o} stroke={c} strokeWidth="0.3"><path d={`M${s.court.X - r} ${s.court.Y - r} L${s.court.X + r} ${s.court.Y + r} M${s.court.X + r} ${s.court.Y - r} L${s.court.X - r} ${s.court.Y + r}`} /><title>{s.text}</title></g>;
          })}
        </svg>
        {layout.map(t => {
          const p = data.players[t.id];
          if (!p) return null;
          const c = colorOf(t.side);
          return (
            <button key={t.id} type="button" className={`nl-tok ${t.role} ${selectedId === t.id ? 'sel' : ''}`}
              style={{ left: `${(t.X / 94) * 100}%`, top: `${(t.Y / 50) * 100}%` }}
              onClick={() => onSelect(t.id)}
              aria-label={`#${p.jersey} ${p.name}, ${t.side === 'home' ? data.home.abbr : data.away.abbr}${t.tracked ? ', at the location of the last play' : ''}`}>
              <span className="nl-tok-in">
                <span className="nl-jersey" style={{ background: c, color: '#05080f' }}>{p.jersey || '?'}</span>
                <span className="nl-name">{_nlLast(p.name)}</span>
              </span>
            </button>
          );
        })}
        {ball && <span className="nl-ball" style={{ left: `${(ball.X / 94) * 100}%`, top: `${(ball.Y / 50) * 100}%` }} />}
        {pop && lastEvent?.court && <span key={lastEvent.id} className="nl-pop" style={{ left: `${(lastEvent.court.X / 94) * 100}%`, top: `${(lastEvent.court.Y / 50) * 100}%` }}>{pop}</span>}
      </div>
    </div>
  );
}

/* ── win / spread / total panel ─────────────────────────────────── */
function NbaLiveOddsPanel({ data, price, market }) {
  const espn = data.espnWinProb.length ? data.espnWinProb[data.espnWinProb.length - 1] : null;
  const live = market?.live;
  const ml = live ? window.NbaLive.devig(live.homeML, live.awayML) : null;
  const awayCol = _nlTeamColor(data.away, '#00d4ff'), homeCol = _nlTeamColor(data.home, '#ffd060');
  const series = data.espnWinProb;
  const spark = series.length > 1 ? series.map((v, i) => `${(i / (series.length - 1)) * 100},${(1 - v) * 30}`).join(' ') : null;
  return (
    <div className="nl-card">
      <h3 className="nl-h">{data.home.abbr} WIN CHANCE</h3>
      <div className="nl-tiles">
        <div className="nl-tile"><small>PLAYIQ</small><b style={{ color: 'var(--accent)' }}>{_nlPct(price.pHome)}</b><span>our model</span></div>
        <div className="nl-tile"><small>ESPN</small><b>{_nlPct(espn)}</b><span>their model</span></div>
        <div className="nl-tile"><small>DRAFTKINGS</small><b>{_nlPct(ml?.a)}</b><span>{ml ? 'hold removed' : 'no live line'}</span></div>
      </div>
      <div className="nl-bar" aria-hidden="true">
        <div style={{ width: `${price.pAway * 100}%`, background: awayCol }} />
        <div style={{ width: `${price.pHome * 100}%`, background: homeCol }} />
      </div>
      <div className="nl-sub" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{data.away.abbr} {_nlPct(price.pAway)}</span><span>{data.home.abbr} {_nlPct(price.pHome)}</span></div>
      {spark && (
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ width: '100%', height: 46, marginTop: 10, display: 'block' }} aria-label="ESPN home win probability over the game">
          <path d="M0 15 H100" stroke="var(--dim)" strokeWidth="0.4" strokeDasharray="1 1" />
          <polyline points={spark} fill="none" stroke="var(--accent)" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {spark && <p className="nl-sub">ESPN's {data.home.abbr} win chance after every play — above the dotted line, {data.home.abbr} favoured.</p>}
      <div style={{ marginTop: 12 }}>
        <div className="nl-row"><span>Projected final</span><b>{data.away.abbr} {price.projAway.toFixed(0)} – {price.projHome.toFixed(0)} {data.home.abbr}</b></div>
        <div className="nl-row"><span>Projected total</span><b>{price.projTotal.toFixed(1)}</b></div>
        {live && <div className="nl-row"><span>DraftKings live</span><b>{live.details || '—'} · O/U {live.total ?? '—'}</b></div>}
        {live && <div className="nl-row"><span>Moneyline</span><b>{data.away.abbr} {_nlOdds(live.awayML)} · {data.home.abbr} {_nlOdds(live.homeML)}</b></div>}
        {data.pregame && <div className="nl-row"><span>Pregame</span><b>{data.pregame.details} · O/U {data.pregame.total ?? '—'}</b></div>}
      </div>
    </div>
  );
}

function NbaLiveMoves({ data, price, market }) {
  const L = window.NbaLive;
  const live = market?.live;
  const res = L.buildMoves(data, price, live);
  const ls = res.lineStatus || L.lineIsCurrent(data, live);
  const fair = L.fairBoard(data, price, live);
  const confColor = c => (c === 'HIGH' ? 'var(--green)' : c === 'MED' ? 'var(--gold)' : 'var(--muted)');
  const posted = live?.postedState;
  const why = {
    'no-line': 'No DraftKings live line is posted for this game right now.',
    'unknown-age': "The DraftKings line shown on ESPN only refreshes at quarter breaks, and this page hasn't seen it change yet — so we can't tell how old it is. No edges are calculated against it until it updates.",
    'lagging': posted ? `This line was posted at Q${posted.period} ${Math.floor(posted.secLeft / 60)}:${String(Math.floor(posted.secLeft % 60)).padStart(2, '0')} with the score ${data.away.abbr} ${posted.away}–${posted.home} ${data.home.abbr}. The game has moved since, and the real DraftKings price has too — comparing against this number would show fake edges.` : 'The line is older than the current game state.',
    'break-unconfirmed': "It's a break — the line usually updates now. Edges appear once this page sees the new number.",
  }[ls.reason];
  return (
    <div className="nl-card">
      <h3 className="nl-h">LIVE BETTING EDGES</h3>
      {ls.current ? (
        <p className="nl-sub">Comparing against a fresh DraftKings line ({ls.reason === 'break' ? 'posted during this break' : `updated ${_nlAge(live.ageSec)} ago, nothing has happened since`}).</p>
      ) : (
        <p className="nl-sub">{why}</p>
      )}
      {ls.current && data.state === 'in' && !res.moves.length && (
        <p className="nl-sub" style={{ marginTop: 10 }}>No side is 3+ points better than the market after the hold is removed. That is the usual answer: the book and the model mostly agree.</p>
      )}
      {res.moves.slice(0, 4).map(m => (
        <div key={m.label} className={`nl-move ${m.confidence}`}>
          <div className="nl-move-top"><b>{m.label} <span style={{ color: 'var(--muted)', fontSize: 11 }}>{_nlOdds(m.price)}</span></b>
            <span className="nl-chip" style={{ color: confColor(m.confidence) }}>{m.confidence}</span></div>
          <div className="nl-move-nums">
            <div>MODEL<b>{_nlPct(m.model)}</b></div>
            <div>MARKET<b>{_nlPct(m.fair)}</b></div>
            <div>EDGE<b style={{ color: 'var(--green)' }}>+{m.edgePts.toFixed(1)}</b></div>
            <div>¼ KELLY<b>{(m.kelly * 100).toFixed(1)}%</b></div>
          </div>
          <p>{m.why} Fair price {_nlOdds(m.fairOdds)}; average return per $100: {m.ev >= 0 ? '+' : ''}${(m.ev * 100).toFixed(0)}.</p>
          {m.caveats.map(c => <p key={c} className="cav">⚠ {c}</p>)}
        </div>
      ))}
      {res.notes.map(n => <p key={n} className="nl-sub" style={{ color: 'var(--orange)', marginTop: 8 }}>{n}</p>)}
      {data.state === 'in' && (
        <div style={{ marginTop: 14 }}>
          <h4 className="nl-h" style={{ fontSize: 10, color: 'var(--text)' }}>FAIR PRICES RIGHT NOW</h4>
          <p className="nl-sub" style={{ marginBottom: 6 }}>What the model thinks each side is worth this second. If your sportsbook pays more than this (e.g. +150 when fair is +120), that side is value.</p>
          {fair.map(r => (
            <div key={r.label} className="nl-row"><span>{r.label}</span><span><b>{_nlOdds(r.fair)}</b> <small style={{ color: 'var(--muted)' }}>({_nlPct(r.p)})</small></span></div>
          ))}
        </div>
      )}
      <p className="nl-sub" style={{ marginTop: 10 }}>This feed runs several seconds behind the book. Treat these as things to check at a timeout or quarter break, not as a race.</p>
    </div>
  );
}

/* ── live player projections ────────────────────────────────────── */
function NbaLiveProps({ data, price, seasons, selectedId, onSelect }) {
  const L = window.NbaLive;
  const [stat, setStat] = React.useState('pts');
  const [lines, setLines] = React.useState({});
  const players = [...data.away.players.map(p => ({ ...p, side: 'away' })), ...data.home.players.map(p => ({ ...p, side: 'home' }))]
    .filter(p => !p.dnp && (p.onCourt || (p.stats.min || 0) > 0));
  const rows = players.map(p => {
    const proj = L.projectStat(p, seasons[p.id], stat, data, price);
    const key = `${p.id}:${stat}`;
    const typed = lines[key];
    const line = typed != null && typed !== '' && Number.isFinite(+typed) ? +typed : L.defaultLine(proj);
    return { p, proj, line, key, typed, prob: L.probOver(proj, line) };
  }).sort((a, b) => (b.p.onCourt - a.p.onCourt) || (b.proj.proj - a.proj.proj));
  const statLabel = L.PROP_STATS.find(s => s.key === stat).label;
  const loading = players.some(p => seasons[p.id] === undefined);
  return (
    <div className="nl-card">
      <h3 className="nl-h">PLAYER PROJECTIONS · LIVE</h3>
      <div className="nl-stats" role="group" aria-label="Stat">
        {L.PROP_STATS.map(s => <button key={s.key} aria-pressed={stat === s.key} onClick={() => setStat(s.key)}>{s.label}</button>)}
      </div>
      <p className="nl-sub" style={{ marginBottom: 8 }}>
        "On pace for" = the current total plus the player's per-minute rate × the minutes likely still to come. The line starts at the season average; type your book's line to change it.
        {loading && ' Loading season averages…'}
      </p>
      {rows.map(({ p, proj, line, key, typed, prob }) => {
        const c = _nlTeamColor(p.side === 'home' ? data.home : data.away, p.side === 'home' ? '#ffd060' : '#00d4ff');
        const max = Math.max(line * 1.4, proj.proj * 1.1, 1);
        const need = Math.max(0, Math.floor(line) + 1 - proj.cur);
        return (
          <div key={p.id} className="nl-prop" style={selectedId === p.id ? { background: 'var(--accent-soft)' } : null}>
            <div className="who" onClick={() => onSelect(p.id)}>
              <span className="num" style={{ background: c, color: '#05080f' }}>{p.jersey}</span>
              <span>{p.short}</span>{p.onCourt && <span className="nl-on">ON</span>}
            </div>
            <div className="pace">
              <div className="nl-track">
                <i style={{ width: `${(proj.proj / max) * 100}%`, background: `color-mix(in srgb, ${c} 35%, transparent)` }} />
                <i style={{ width: `${(proj.cur / max) * 100}%`, background: c }} />
                <em style={{ left: `${(line / max) * 100}%` }} />
              </div>
              <small>
                {proj.cur} now → on pace for {proj.proj.toFixed(1)}
                {data.final ? '' : need > 0 ? ` · needs ${need} more in ~${proj.remMin.toFixed(0)} min` : ' · already over'}
                {proj.minReasons.length ? ` · ${proj.minReasons.join('; ')}` : ''}
              </small>
            </div>
            <label style={{ fontSize: 9.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
              O<input inputMode="decimal" aria-label={`${p.name} ${statLabel} line`} value={typed ?? line}
                onChange={e => setLines(s => ({ ...s, [key]: e.target.value }))} />
            </label>
            <div className="nl-prob" style={{ color: prob >= 0.6 ? 'var(--green)' : prob <= 0.4 ? 'var(--orange)' : 'var(--text)' }}>
              {_nlPct(prob)}<small>{prob >= 0.99 || prob <= 0.01 ? 'settled' : `fair ${_nlOdds(L.probToAmerican(prob))}`}</small>
            </div>
          </div>
        );
      })}
      {!rows.length && <p className="nl-sub">Box score not posted yet.</p>}
    </div>
  );
}

function NbaLivePlayerCard({ data, price, season, id, onClose }) {
  const L = window.NbaLive;
  const p = data.players[id];
  if (!p) return null;
  const s = p.stats;
  const team = p.side === 'home' ? data.home : data.away;
  const c = _nlTeamColor(team, '#00d4ff');
  const projs = ['pts', 'reb', 'ast', 'tpm'].map(k => L.projectStat(p, season, k, data, price));
  return (
    <div className="nl-card" style={{ borderColor: c }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {p.headshot && <img src={p.headshot} alt="" style={{ width: 54, height: 40, objectFit: 'cover', borderRadius: 4 }} onError={e => { e.target.style.display = 'none'; }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontFamily: 'Orbitron, monospace', fontSize: 13 }}>#{p.jersey} {p.name}</b>
          <p className="nl-sub">{team.abbr} · {p.pos || '—'} · {p.onCourt ? 'on the floor now' : 'on the bench'}{season ? ` · season ${season.mpg.toFixed(1)} min/g (${season.sample})` : ''}</p>
        </div>
        <button onClick={onClose} aria-label="Close player card">✕</button>
      </div>
      <div className="nl-tiles" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginTop: 12 }}>
        {projs.map(pr => (
          <div key={pr.key} className="nl-tile"><small>{L.PROP_STATS.find(x => x.key === pr.key).label}</small><b>{pr.cur}</b>
            <span>on pace {pr.proj.toFixed(1)}{pr.seasonAvg != null ? ` · usually ${pr.seasonAvg.toFixed(1)}` : ''}</span></div>
        ))}
      </div>
      <p className="nl-sub" style={{ marginTop: 10 }}>
        {s.min || 0} min · {s.fgm ?? 0} of {s.fga ?? 0} shots · {s.tpm ?? 0} of {s.tpa ?? 0} threes · {s.ftm ?? 0} of {s.fta ?? 0} free throws · {s.pf ?? 0} fouls · {s.pm > 0 ? '+' : ''}{s.pm ?? 0} while on the floor
        {projs[0].minReasons.length ? ` · ${projs[0].minReasons.join('; ')}` : ''}
      </p>
    </div>
  );
}

/* ── the tab ─────────────────────────────────────────────────────── */
function NbaLiveTab({ gameInfo }) {
  const L = window.NbaLive;
  const league = gameInfo.sportKey === 'wnba' ? 'wnba' : 'nba';
  const [feed, setFeed] = React.useState({});
  const [paused, setPaused] = React.useState(false);
  const [now, setNow] = React.useState(Date.now());
  const [selectedId, setSelectedId] = React.useState(null);
  const [seasons, setSeasons] = React.useState({});
  const [tilt, setTilt] = React.useState(() => { try { return localStorage.getItem('piq_nba_court_view') === '3d' ? 42 : 0; } catch { return 0; } });
  const subRef = React.useRef(null);

  React.useEffect(() => {
    if (paused) return;
    const sub = L.subscribe(gameInfo.eventId, league, u => setFeed(u));
    subRef.current = sub;
    return () => { sub.unsubscribe(); subRef.current = null; };
  }, [gameInfo.eventId, league, paused]);
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const data = feed.data;
  // Season rates for every player who has appeared — fetched once each.
  const idsKey = data ? [...data.away.players, ...data.home.players].filter(p => p.onCourt || (p.stats.min || 0) > 0).map(p => p.id).sort().join(',') : '';
  React.useEffect(() => {
    if (!idsKey) return;
    const need = idsKey.split(',').filter(id => !(id in seasons));
    if (!need.length) return;
    setSeasons(s => { const n = { ...s }; need.forEach(id => { if (!(id in n)) n[id] = undefined; }); return n; });
    let dead = false;
    L.fetchSeasons(need, league, (id, v) => { if (!dead) setSeasons(s => ({ ...s, [id]: v || null })); });
    return () => { dead = true; };
  }, [idsKey]);

  const toggleTilt = () => setTilt(t => { const n = t ? 0 : 42; try { localStorage.setItem('piq_nba_court_view', n ? '3d' : 'top'); } catch {} return n; });

  if (!data) {
    return (
      <div className="nl-live">
        <div className="nl-card">
          <p className="nl-sub">{feed.status === 'reconnecting' ? `Can't reach ESPN right now (${feed.error || 'network'}). Retrying automatically…` : 'Connecting to the live feed…'}</p>
          {feed.status === 'reconnecting' && <button style={{ marginTop: 10 }} onClick={() => subRef.current?.refresh()}>Retry now</button>}
        </div>
      </div>
    );
  }

  const price = L.priceGame(data);
  const poss = L.inferPossession(data);
  const lastEvent = L.lastLocatedEvent(data);
  const layout = data.state === 'pre' ? [] : L.layout(data, L.layoutPossession(poss, lastEvent), lastEvent);
  const trail = L.shotTrail(data);
  const age = feed.checkedAt ? Math.round((now - feed.checkedAt) / 1000) : null;
  const stale = feed.status === 'reconnecting' || paused;
  const recent = data.plays.slice(-14).reverse();
  const selected = selectedId && data.players[selectedId] ? selectedId : null;

  return (
    <div className="nl-live">
      {/* scoreboard */}
      <div className="nl-card">
        <div className="nl-score">
          <div className="nl-team">
            {data.away.logo && <img src={data.away.logo} alt="" />}
            <div><b>{data.away.abbr}{poss.side === 'away' && <span className="nl-poss l" title="Possession" />}</b><small>{data.away.record}{data.away.timeouts != null ? ` · ${data.away.timeouts} TO` : ''}{data.away.fouls?.bonusState && data.away.fouls.bonusState !== 'NONE' ? ' · BONUS' : ''}</small></div>
            <strong>{data.state === 'pre' ? '' : data.away.score}</strong>
          </div>
          <div className="nl-clock">
            <b>{data.state === 'pre' ? 'PRE' : data.final ? 'FINAL' : data.detail}</b>
            <small>{data.live && !stale ? <><span className="nl-livedot" />LIVE · ESPN</> : stale ? (paused ? 'PAUSED' : 'RECONNECTING') : data.state === 'pre' ? (data.tipoff ? new Date(data.tipoff).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'TIP-OFF TBD') : ''}</small>
          </div>
          <div className="nl-team home">
            {data.home.logo && <img src={data.home.logo} alt="" />}
            <div><b>{poss.side === 'home' && <span className="nl-poss r" title="Possession" />}{data.home.abbr}</b><small>{data.home.record}{data.home.timeouts != null ? ` · ${data.home.timeouts} TO` : ''}{data.home.fouls?.bonusState && data.home.fouls.bonusState !== 'NONE' ? ' · BONUS' : ''}</small></div>
            <strong>{data.state === 'pre' ? '' : data.home.score}</strong>
          </div>
        </div>
      </div>
      <div className="nl-toolbar">
        <span>Updated {age != null ? `${age}s ago` : '—'} · checks every {Math.round((feed.interval || 5000) / 1000)}s · ESPN's feed itself runs a few seconds behind TV</span>
        <button onClick={() => setPaused(p => !p)}>{paused ? 'Resume' : 'Pause'}</button>
        <button onClick={() => subRef.current?.refresh()} disabled={paused}>Refresh</button>
      </div>
      {feed.status === 'reconnecting' && <div className="nl-banner">Connection interrupted — showing the last update and retrying automatically.</div>}

      {data.state === 'pre' ? (
        <div className="nl-card">
          <h3 className="nl-h">NOT STARTED</h3>
          <p className="nl-sub">The court tracker and live projections switch on at tip-off. Starting win chance from the pregame line: {data.home.abbr} {_nlPct(price.pHome)}, projected total {price.projTotal.toFixed(1)}.{data.pregame ? ` (${data.pregame.provider}: ${data.pregame.details}, O/U ${data.pregame.total})` : ''}</p>
        </div>
      ) : (
        <div className="nl-grid">
          <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
            <div className="nl-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h3 className="nl-h" style={{ margin: 0 }}>COURT · WHO'S ON THE FLOOR</h3>
                <button onClick={toggleTilt} aria-pressed={!!tilt}>{tilt ? 'Top view' : '3D view'}</button>
              </div>
              <NbaLiveCourt data={data} poss={poss} lastEvent={lastEvent} trail={trail} layout={layout} selectedId={selected} onSelect={id => setSelectedId(s => (s === id ? null : id))} tilt={tilt} />
              <div className="nl-event" aria-live="polite">
                {lastEvent ? <><b>Q{lastEvent.period} {lastEvent.clock}</b><span>{lastEvent.text}</span></> : <span className="nl-sub">{data.final ? 'Game over.' : data.halftime ? 'Halftime.' : 'Waiting for the next play…'}</span>}
              </div>
              <div className="nl-legend">
                <span>The ten players shown are the real five on the floor for each team (from ESPN).</span>
                <span><i style={{ background: 'var(--gold)' }} />Ringed player + ball = where the last play actually happened</span>
                <span>Everyone else is drawn at a typical spot for their position — the NBA does not publish live player locations.</span>
                <span>Solid = offense · dashed = defense · dots/× = recent made/missed shots</span>
              </div>
            </div>
            {selected && <NbaLivePlayerCard data={data} price={price} season={seasons[selected]} id={selected} onClose={() => setSelectedId(null)} />}
            <NbaLiveProps data={data} price={price} seasons={seasons} selectedId={selected} onSelect={id => setSelectedId(s => (s === id ? null : id))} />
          </div>
          <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
            <NbaLiveOddsPanel data={data} price={price} market={feed.market} />
            <NbaLiveMoves data={data} price={price} market={feed.market} />
            {/* Simulated slip (play-slip lane). Suggestions are only the moves
                that passed the line-freshness gate — none while the line is stale. */}
            {window.PlaySlip && (
              <PlaySlip sportKey={gameInfo.sportKey} eventId={gameInfo.eventId}
                suggestions={window.PlaySlipData.fromHoopsMoves(L.buildMoves(data, price, feed.market?.live).moves, data)}
                suggestionNote="From the PlayIQ live model." />
            )}
            <div className="nl-card">
              <h3 className="nl-h">PLAY-BY-PLAY</h3>
              <div className="nl-plays">
                {recent.map(p => (
                  <div key={p.id} className={`nl-play ${p.scoring ? 'score' : ''}`}>
                    <small>Q{p.period} {p.clock}</small><span>{p.text}</span>
                    <b>{p.awayScore != null ? `${p.awayScore}-${p.homeScore}` : ''}</b>
                  </div>
                ))}
                {!recent.length && <p className="nl-sub">No plays yet.</p>}
              </div>
            </div>
            <div className="nl-card">
              <details>
                <summary>How the win chance is calculated</summary>
                <p>We start from the pregame DraftKings line ({data.home.abbr} expected to win by {price.inputs.homeMarginPre > 0 ? '' : '−'}{Math.abs(price.inputs.homeMarginPre)}, total {price.inputs.totalPre}) and treat the rest of the game as a random walk around that (Stern, 1994).</p>
                <p>How swingy that walk is ({price.inputs.sigma.toFixed(1)} points over a full game) is {price.inputs.sigmaSource === 'pregame' ? "set so the model gives exactly DraftKings' own pregame moneyline at tip-off" : 'a league-typical value (no usable pregame line to calibrate from)'}.</p>
                <p>Scoring pace: tonight's {(price.inputs.livePace * 48).toFixed(0)} points per 48 minutes counts {Math.round(price.inputs.paceWeight * 100)}%, the pregame total the rest. {price.inputs.minLeft.toFixed(1)} minutes left.</p>
                <p>Player projections: the season rate per minute (pooled with last season early on), nudged toward tonight's rate as the player logs more minutes, times the player's usual share of the remaining minutes. Foul trouble and blowouts cut or add minutes and say so.</p>
                <p>Not modelled: end-of-game intentional fouling, injuries during the game, and who has the ball in the final seconds.</p>
              </details>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { NbaLiveTab, NbaLiveCourt });
