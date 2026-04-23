/* ============================================================
   PLAYIQ — SHARED TABS
   Tabs used across multiple sports
   ============================================================ */

function OverviewTab({ gameData }) {
  const { gameInfo, awayForm, homeForm, injuries } = gameData;
  const awayW = awayForm.filter(g => g.result === 'W').length;
  const homeW = homeForm.filter(g => g.result === 'W').length;
  const getStreak = form => {
    if (!form.length) return '—';
    const last = form[form.length - 1].result;
    let c = 0;
    for (let i = form.length - 1; i >= 0; i--) { if (form[i].result === last) c++; else break; }
    return `${c}${last}`;
  };
  const avgScore = form => form.length ? (form.reduce((s, g) => s + g.myScore, 0) / form.length).toFixed(1) : '—';
  const avgAllowed = form => form.length ? (form.reduce((s, g) => s + g.oppScore, 0) / form.length).toFixed(1) : '—';

  const TeamSide = ({ team, abbr, logo, form, wins, color }) => (
    <div style={{ flex: 1, minWidth: 200 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {logo && <img src={logo} alt={abbr} style={{ width: 48, height: 48, objectFit: 'contain', filter: 'drop-shadow(0 0 8px rgba(0,0,0,0.5))' }} onError={e => e.target.style.display='none'} />}
        <div>
          <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 22, fontWeight: 700, color, letterSpacing: '0.04em' }}>{abbr}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>{team}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        {[['LAST ' + form.length, `${wins}-${form.length-wins}`], ['STREAK', getStreak(form)],
          ['AVG PF', avgScore(form)], ['AVG PA', avgAllowed(form)]].map(([l, v]) => (
          <div key={l} style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 3 }}>
            <div style={{ fontSize: 8, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.14em', marginBottom: 3 }}>{l}</div>
            <div style={{ fontSize: 18, fontFamily: 'Orbitron, monospace', color, fontWeight: 700 }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.14em', marginBottom: 8 }}>FORM</div>
        <FormDots form={form} />
      </div>
    </div>
  );

  const injBlock = (side, abbr) => {
    const list = (injuries?.[side] || []).filter(i => /out|doubtful|questionable/i.test(i.status));
    if (!list.length) return null;
    return (
      <div style={{ marginTop: 16, padding: '12px 14px', background: 'rgba(255,107,53,0.06)', border: '1px solid rgba(255,107,53,0.15)', borderRadius: 3 }}>
        <div style={{ fontSize: 9, color: '#ff6b35', fontFamily: 'Space Mono, monospace', letterSpacing: '0.14em', marginBottom: 8 }}>INJURY REPORT · {abbr}</div>
        {list.slice(0, 4).map((inj, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
              background: /out/i.test(inj.status) ? '#ff6b35' : '#ffd060',
              boxShadow: `0 0 4px ${/out/i.test(inj.status) ? '#ff6b35' : '#ffd060'}` }} />
            <span style={{ fontSize: 11, fontFamily: 'Space Mono, monospace', color: 'var(--text)' }}>{inj.name}</span>
            <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>{inj.pos}</span>
            <span style={{ fontSize: 9, color: /out/i.test(inj.status) ? '#ff6b35' : '#ffd060', fontFamily: 'Space Mono, monospace', marginLeft: 'auto' }}>{inj.status}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ padding: '20px 0' }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 24, padding: '20px', background: 'var(--card)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 4 }}>
        <TeamSide team={gameInfo.awayFull} abbr={gameInfo.awayAbbr} logo={gameInfo.awayLogo} form={awayForm} wins={awayW} color="var(--cyan)" />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '0 16px' }}>
          <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 20, color: 'var(--dim)', fontWeight: 700 }}>VS</div>
          <OddsStrip game={gameInfo} />
        </div>
        <TeamSide team={gameInfo.homeFull} abbr={gameInfo.homeAbbr} logo={gameInfo.homeLogo} form={homeForm} wins={homeW} color="#ffd060" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {injBlock('away', gameInfo.awayAbbr)}
        {injBlock('home', gameInfo.homeAbbr)}
      </div>
    </div>
  );
}

function H2HTab({ gameData }) {
  const { gameInfo, h2h } = gameData;
  const games = h2h?.games || [];
  if (!games.length) return <div style={emptyMsg}>No head-to-head data found for the last 3 seasons.</div>;
  const awayWins = games.filter(g => g.winner === 'away' && g.awayAbbr === gameInfo.awayAbbr || g.winner === 'home' && g.homeAbbr === gameInfo.awayAbbr).length;
  const catLabels = gameInfo.sportKey === 'mlb'
    ? [{ key: 'hits', label: 'H' }, { key: 'rbi', label: 'RBI' }, { key: 'runs', label: 'R' }]
    : [{ key: 'pts', label: 'PTS' }, { key: 'reb', label: 'REB' }, { key: 'ast', label: 'AST' }];

  return (
    <div style={{ padding: '20px 0' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        {[
          [gameInfo.awayAbbr, awayWins, 'var(--cyan)'],
          [gameInfo.homeAbbr, games.length - awayWins, '#ffd060'],
        ].map(([abbr, wins, color]) => (
          <HudCard key={abbr} style={{ flex: 1, padding: '14px 18px', textAlign: 'center' }} accent={color}>
            <div style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.16em', marginBottom: 6 }}>{abbr} WINS</div>
            <div style={{ fontSize: 40, fontFamily: 'Orbitron, monospace', color, fontWeight: 900 }}>{wins}</div>
            <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>last {games.length}</div>
          </HudCard>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {games.map((g, i) => {
          const awayWon = (g.awayAbbr === gameInfo.awayAbbr && g.winner === 'away') || (g.homeAbbr === gameInfo.awayAbbr && g.winner === 'home');
          return (
            <HudCard key={i} style={{ padding: '14px 16px' }} accent={awayWon ? 'var(--cyan)' : '#ffd060'}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', width: 80, flexShrink: 0 }}>{g.date}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                  <span style={{ fontFamily: 'Space Mono, monospace', fontSize: 12, color: g.awayAbbr===gameInfo.awayAbbr ? 'var(--cyan)' : '#ffd060', fontWeight: 700 }}>{g.awayAbbr}</span>
                  <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 18, fontWeight: 900,
                    color: g.awayScore > g.homeScore ? '#00ff88' : 'var(--text)' }}>{g.awayScore}</span>
                  <span style={{ color: 'var(--dim)', fontFamily: 'Space Mono, monospace', fontSize: 11 }}>—</span>
                  <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 18, fontWeight: 900,
                    color: g.homeScore > g.awayScore ? '#00ff88' : 'var(--text)' }}>{g.homeScore}</span>
                  <span style={{ fontFamily: 'Space Mono, monospace', fontSize: 12, color: g.homeAbbr===gameInfo.homeAbbr ? '#ffd060' : 'var(--cyan)', fontWeight: 700 }}>{g.homeAbbr}</span>
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {catLabels.map(cat => {
                    const awayLdr = g.awayLeaders?.[cat.key];
                    const homeLdr = g.homeLeaders?.[cat.key];
                    if (!awayLdr && !homeLdr) return null;
                    return (
                      <div key={cat.key} style={{ display: 'flex', gap: 8, fontSize: 9, fontFamily: 'Space Mono, monospace' }}>
                        <span style={{ color: 'var(--cyan)' }}>{awayLdr ? `${awayLdr.name} ${awayLdr.value}${cat.label}` : '—'}</span>
                        <span style={{ color: 'var(--dim)' }}>vs</span>
                        <span style={{ color: '#ffd060' }}>{homeLdr ? `${homeLdr.name} ${homeLdr.value}${cat.label}` : '—'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </HudCard>
          );
        })}
      </div>
    </div>
  );
}

function RosterTab({ gameData }) {
  const { gameInfo, awayRoster, homeRoster } = gameData;
  const [side, setSide] = React.useState('away');
  const roster = side === 'away' ? awayRoster : homeRoster;
  const statusColor = s => {
    if (!s || /^active$/i.test(s)) return '#00ff88';
    if (/out/i.test(s)) return '#ff6b35';
    if (/doubtful/i.test(s)) return '#ff6b35';
    if (/questionable/i.test(s)) return '#ffd060';
    if (/day.to.day/i.test(s)) return '#ffd060';
    return 'var(--muted)';
  };
  return (
    <div style={{ padding: '20px 0' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[['away', gameInfo.awayFull, gameInfo.awayAbbr], ['home', gameInfo.homeFull, gameInfo.homeAbbr]].map(([s, full, abbr]) => (
          <button key={s} onClick={() => setSide(s)}
            style={{ flex: 1, padding: '10px 16px', background: side===s ? 'rgba(0,212,255,0.08)' : 'transparent',
              border: `1px solid ${side===s ? 'rgba(0,212,255,0.3)' : 'rgba(255,255,255,0.06)'}`,
              color: side===s ? 'var(--cyan)' : 'var(--muted)', fontFamily: 'Space Mono, monospace',
              fontSize: 11, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.08em', transition: 'all 0.2s' }}>
            {abbr} · {full}
          </button>
        ))}
      </div>
      {!roster?.length ? <div style={emptyMsg}>Roster not available.</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {roster.map(p => (
            <HudCard key={p.id} style={{ padding: '14px 12px', textAlign: 'center' }} accent={statusColor(p.status)}>
              <PlayerCard player={{ ...p, headshot: p.headshot }} accent={statusColor(p.status)} size="md" />
              <div style={{ marginTop: 10, fontSize: 9, fontFamily: 'Space Mono, monospace', color: statusColor(p.status), letterSpacing: '0.1em' }}>
                {/^active$/i.test(p.status) ? '● ACTIVE' : p.status?.toUpperCase() || 'ACTIVE'}
              </div>
            </HudCard>
          ))}
        </div>
      )}
    </div>
  );
}

function FormTab({ gameData }) {
  const { gameInfo, awayForm, homeForm } = gameData;
  const [side, setSide] = React.useState('away');
  const form = side === 'away' ? awayForm : homeForm;
  const cats = form.find(g => g.cats)?.cats || (gameInfo.sportKey === 'mlb'
    ? [{ key:'hits',label:'H' }, { key:'rbi',label:'RBI' }, { key:'runs',label:'R' }]
    : [{ key:'pts',label:'PTS' }, { key:'reb',label:'REB' }, { key:'ast',label:'AST' }]);
  const [statKey, setStatKey] = React.useState(cats[0]?.key || 'pts');

  return (
    <div style={{ padding: '20px 0' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[['away', gameInfo.awayAbbr], ['home', gameInfo.homeAbbr]].map(([s, a]) => (
          <button key={s} onClick={() => setSide(s)}
            style={{ padding: '8px 16px', background: side===s ? 'rgba(0,212,255,0.08)' : 'transparent',
              border: `1px solid ${side===s ? 'rgba(0,212,255,0.3)' : 'rgba(255,255,255,0.06)'}`,
              color: side===s ? 'var(--cyan)' : 'var(--muted)', fontFamily: 'Space Mono, monospace',
              fontSize: 10, cursor: 'pointer', borderRadius: 2, transition: 'all 0.2s' }}>
            {a}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {cats.map(c => (
            <button key={c.key} onClick={() => setStatKey(c.key)}
              style={{ padding: '6px 12px', background: statKey===c.key ? 'rgba(0,212,255,0.1)' : 'transparent',
                border: `1px solid ${statKey===c.key ? 'rgba(0,212,255,0.3)' : 'rgba(255,255,255,0.06)'}`,
                color: statKey===c.key ? 'var(--cyan)' : 'var(--dim)', fontFamily: 'Space Mono, monospace',
                fontSize: 10, cursor: 'pointer', borderRadius: 2 }}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${form.length}, 1fr)`, gap: 8 }}>
        {form.map((g, i) => {
          const leader = g.player?.[statKey];
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <HudCard style={{ width: '100%', padding: '10px 8px', textAlign: 'center' }} accent={g.result==='W' ? '#00ff88' : '#ff6b35'}>
                {leader ? (
                  <>
                    <PlayerCard player={{ name: leader.name, headshot: leader.headshot }} size="sm" accent={g.result==='W' ? '#00ff88' : '#ff6b35'} />
                    <div style={{ fontSize: 18, fontFamily: 'Orbitron, monospace', fontWeight: 700, color: g.result==='W' ? '#00ff88' : '#ff6b35', marginTop: 6 }}>{leader.value}</div>
                    <div style={{ fontSize: 8, color: 'var(--dim)', fontFamily: 'Space Mono, monospace' }}>{statKey.toUpperCase()}</div>
                  </>
                ) : <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace' }}>—</div>}
              </HudCard>
              <div style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', textAlign: 'center', color: 'var(--muted)' }}>
                <div style={{ color: g.result==='W' ? '#00ff88' : '#ff6b35', fontWeight: 700, marginBottom: 2 }}>{g.result} {g.myScore}-{g.oppScore}</div>
                <div>{g.home ? 'vs' : '@'} {g.opponent}</div>
                <div style={{ color: 'var(--dim)', marginTop: 2 }}>{g.date}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const HOT_TIER_CFG = {
  elite:   { label: '▲▲ ELITE', color: 'var(--green)', bg: 'rgba(0,255,136,0.1)', border: 'rgba(0,255,136,0.3)' },
  hot:     { label: '▲ HOT', color: 'var(--gold)', bg: 'rgba(255,208,96,0.08)', border: 'rgba(255,208,96,0.25)' },
  cold:    { label: '▼ COLD', color: 'var(--muted)', bg: 'transparent', border: 'rgba(255,255,255,0.06)' },
  neutral: { label: null },
};

function HotBadge({ tier }) {
  const cfg = HOT_TIER_CFG[tier] || HOT_TIER_CFG.neutral;
  if (!cfg.label) return null;
  return (
    <span style={{
      fontSize: 9, fontFamily: 'Space Mono, monospace', fontWeight: 700,
      letterSpacing: '0.12em', padding: '3px 8px', borderRadius: 2,
      color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`,
    }}>{cfg.label}</span>
  );
}

function AIPlaysTab({ gameData }) {
  const [plays, setPlays] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [userPlay, setUserPlay] = React.useState('');
  const [discussion, setDiscussion] = React.useState(null);
  const [discussing, setDiscussing] = React.useState(false);
  const hasKey = !!getApiKey();

  const generate = async () => {
    setLoading(true);
    const result = await generateAIPlays(gameData);
    setLoading(false);
    setPlays(result);
  };

  const discuss = async () => {
    if (!userPlay.trim()) return;
    if (!hasKey) { setDiscussion('Add your Claude API key in the top bar to discuss plays.'); return; }
    setDiscussing(true);
    try {
      const { gameInfo } = gameData;
      const resp = await claudeComplete(
        `You are a sports betting analyst. A bettor wants to discuss this play: "${userPlay}"
Game: ${gameInfo.awayFull} @ ${gameInfo.homeFull} (${gameInfo.sportLabel})
Spread: ${gameInfo.spread || 'N/A'} | O/U: ${gameInfo.overUnder || 'N/A'}
Give a concise 3-4 sentence analysis of this bet.`,
        { maxTokens: 400 }
      );
      setDiscussion(resp);
    } catch (e) {
      setDiscussion(e.message === 'NO_API_KEY'
        ? 'Add your Claude API key in the top bar to discuss plays.'
        : 'Unable to analyze play at this time.');
    }
    setDiscussing(false);
  };

  const confColor = c => c === 'HIGH' ? '#00ff88' : c === 'MEDIUM' ? '#ffd060' : 'var(--muted)';
  const typeColor = t => ({ SPREAD: 'var(--cyan)', TOTAL: '#a855f7', PROP: '#ff6b35', ML: '#ffd060' }[t] || 'var(--dim)');

  return (
    <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <SectionHeader label="◆ AI RECOMMENDED PLAYS" sub="Powered by Claude · Based on form, H2H, injuries" />
        {!hasKey && (
          <div style={{ padding: '14px 16px', marginBottom: 12, background: 'rgba(255,107,53,0.06)',
            border: '1px solid rgba(255,107,53,0.2)', borderRadius: 3, fontSize: 11,
            color: '#ff6b35', fontFamily: 'Space Mono, monospace', letterSpacing: '0.08em' }}>
            ⚠ Add your Claude API key in the top bar to generate AI plays.
          </div>
        )}
        {!plays && !loading && (
          <button onClick={generate} style={{ padding: '12px 24px', background: 'rgba(0,212,255,0.1)',
            border: '1px solid rgba(0,212,255,0.3)', color: 'var(--cyan)', fontFamily: 'Space Mono, monospace',
            fontSize: 11, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.1em', transition: 'all 0.2s' }}>
            ◆ GENERATE AI PLAYS
          </button>
        )}
        {loading && <Loader text="ANALYZING..." />}
        {plays && plays.error === 'NO_API_KEY' && (
          <div style={{ padding: '14px 16px', background: 'rgba(255,107,53,0.06)',
            border: '1px solid rgba(255,107,53,0.2)', borderRadius: 3, fontSize: 11,
            color: '#ff6b35', fontFamily: 'Space Mono, monospace' }}>
            No API key set. Paste your Claude key (sk-ant-…) in the top bar.
          </div>
        )}
        {Array.isArray(plays) && plays.length === 0 && <div style={emptyMsg}>No plays returned. Try again.</div>}
        {Array.isArray(plays) && plays.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {plays.map((p, i) => (
              <HudCard key={i} style={{ padding: '16px 18px' }} accent={confColor(p.confidence)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 9, padding: '2px 8px', border: `1px solid ${typeColor(p.type)}44`,
                    color: typeColor(p.type), fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em', borderRadius: 2 }}>{p.type}</span>
                  <span style={{ fontSize: 9, padding: '2px 8px', border: `1px solid ${confColor(p.confidence)}44`,
                    color: confColor(p.confidence), fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em', borderRadius: 2 }}>{p.confidence}</span>
                </div>
                <div style={{ fontSize: 15, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700, marginBottom: 8 }}>{p.play}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', lineHeight: 1.5 }}>{p.reason}</div>
              </HudCard>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionHeader label="YOUR PLAY" sub="Discuss with Claude" />
        <textarea value={userPlay} onChange={e => setUserPlay(e.target.value)}
          placeholder="e.g. 'Braves -1.5' or 'Over 8.5 runs' or 'Acuña over 1.5 hits'"
          style={{ width: '100%', minHeight: 80, background: 'var(--card)', border: '1px solid rgba(0,212,255,0.15)',
            color: 'var(--text)', fontFamily: 'Space Mono, monospace', fontSize: 12, padding: '12px 14px',
            borderRadius: 3, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
        <button onClick={discuss} disabled={discussing}
          style={{ marginTop: 8, padding: '10px 20px', background: 'rgba(0,212,255,0.08)',
            border: '1px solid rgba(0,212,255,0.25)', color: 'var(--cyan)', fontFamily: 'Space Mono, monospace',
            fontSize: 10, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.1em' }}>
          {discussing ? 'ANALYZING...' : 'DISCUSS →'}
        </button>
        {discussion && (
          <HudCard style={{ padding: '14px 16px', marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'Space Mono, monospace', lineHeight: 1.6 }}>{discussion}</div>
          </HudCard>
        )}
      </div>
    </div>
  );
}

const emptyMsg = {
  padding: '40px 24px',
  textAlign: 'center',
  fontFamily: 'Space Mono, monospace',
  fontSize: 11,
  color: 'var(--dim)',
  letterSpacing: '0.1em',
};

Object.assign(window, {
  OverviewTab, H2HTab, RosterTab, FormTab, HotBadge, AIPlaysTab, emptyMsg,
});
