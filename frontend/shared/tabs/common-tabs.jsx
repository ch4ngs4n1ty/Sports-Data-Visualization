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
  const avgScore   = form => form.length ? (form.reduce((s, g) => s + g.myScore, 0) / form.length).toFixed(1) : '—';
  const avgAllowed = form => form.length ? (form.reduce((s, g) => s + g.oppScore, 0) / form.length).toFixed(1) : '—';

  const TeamSide = ({ team, abbr, logo, form, wins, color, side }) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
        {logo && <img src={logo} alt="" loading="lazy"
          style={{ width: 52, height: 52, objectFit: 'contain', flexShrink: 0, filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.6))' }}
          onError={e => { e.target.style.visibility = 'hidden'; }} />}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', flexWrap: 'wrap' }}>
            <span className="piq-num" style={{ fontSize: 'var(--fs-xl)', color, letterSpacing: '0.03em' }}>{abbr}</span>
            <Chip color="var(--dim)">{side}</Chip>
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', fontFamily: 'Space Mono, monospace', marginTop: 3 }}>{team}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 'var(--s2)', marginBottom: 'var(--s4)' }}>
        <StatTile label={`Last ${form.length}`} value={`${wins}-${form.length - wins}`} color={color} />
        <StatTile label="Streak"  value={getStreak(form)} color={color} />
        <StatTile label="Avg PF"  value={avgScore(form)}   color={color} />
        <StatTile label="Avg PA"  value={avgAllowed(form)} color={color} />
      </div>

      <div>
        <div className="piq-label" style={{ marginBottom: 'var(--s2)' }}>Form (oldest → newest)</div>
        <FormDots form={form} />
      </div>
    </div>
  );

  const injBlock = (side, abbr) => {
    const list = (injuries?.[side] || []).filter(i => /out|doubtful|questionable/i.test(i.status));
    if (!list.length) return null;
    return (
      <HudCard accent="var(--orange)" style={{ padding: 'var(--s4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginBottom: 'var(--s3)' }}>
          <span className="piq-label" style={{ color: 'var(--orange)' }}>Injury report</span>
          <Chip color="var(--orange)" strong>{abbr}</Chip>
          <span className="piq-label" style={{ marginLeft: 'auto' }}>{list.length}</span>
        </div>
        {list.slice(0, 5).map((inj, i) => {
          const out = /out/i.test(inj.status);
          const c = out ? 'var(--orange)' : 'var(--gold)';
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', padding: '7px 0',
              borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: c, boxShadow: `0 0 6px ${c}` }} />
              <span style={{ fontSize: 'var(--fs-sm)', fontFamily: 'Space Mono, monospace', color: 'var(--text)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inj.name}</span>
              <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--dim)', fontFamily: 'Space Mono, monospace', flexShrink: 0 }}>{inj.pos}</span>
              <span style={{ marginLeft: 'auto', flexShrink: 0 }}><Chip color={c} strong>{inj.status}</Chip></span>
            </div>
          );
        })}
      </HudCard>
    );
  };

  const away = injBlock('away', gameInfo.awayAbbr);
  const home = injBlock('home', gameInfo.homeAbbr);

  return (
    <div style={{ padding: 'var(--s5) 0', display: 'flex', flexDirection: 'column', gap: 'var(--s5)' }}>
      <HudCard style={{ padding: 'var(--s5)' }} interactive={false}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--s5)' }}>
          <TeamSide team={gameInfo.awayFull} abbr={gameInfo.awayAbbr} logo={gameInfo.awayLogo}
            form={awayForm} wins={awayW} color="var(--cyan)" side="AWAY" />
          <TeamSide team={gameInfo.homeFull} abbr={gameInfo.homeAbbr} logo={gameInfo.homeLogo}
            form={homeForm} wins={homeW} color="var(--gold)" side="HOME" />
        </div>

        {/* The betting lines used to repeat here. GameDetailScreen's header
            now carries an OddsStrip that stays visible on EVERY tab, so a
            second copy on Overview was the same numbers twice on one screen. */}
      </HudCard>

      {(away || home) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--s3)' }}>
          {away}{home}
        </div>
      )}
    </div>
  );
}

function H2HTab({ gameData }) {
  const { gameInfo, h2h } = gameData;
  const games = h2h?.games || [];
  if (!games.length) return (
    <div style={{ padding: 'var(--s5) 0' }}>
      <EmptyState title="NO HEAD-TO-HEAD DATA" hint="These teams haven't met in the last 3 seasons." />
    </div>
  );

  const awayWins = games.filter(g => g.winner === 'away' && g.awayAbbr === gameInfo.awayAbbr || g.winner === 'home' && g.homeAbbr === gameInfo.awayAbbr).length;
  const homeWins = games.length - awayWins;
  const catLabels = gameInfo.sportKey === 'mlb'
    ? [{ key: 'hits', label: 'H' }, { key: 'rbi', label: 'RBI' }, { key: 'runs', label: 'R' }]
    : [{ key: 'pts', label: 'PTS' }, { key: 'reb', label: 'REB' }, { key: 'ast', label: 'AST' }];

  const awayPct = games.length ? (awayWins / games.length) * 100 : 50;

  return (
    <div style={{ padding: 'var(--s5) 0' }}>
      {/* Series summary with a share-of-wins bar */}
      <HudCard style={{ padding: 'var(--s5)', marginBottom: 'var(--s5)' }} interactive={false}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 'var(--s3)' }}>
          {[[gameInfo.awayAbbr, awayWins, 'var(--cyan)', 'left'], [gameInfo.homeAbbr, homeWins, 'var(--gold)', 'right']].map(([abbr, wins, color, align]) => (
            <div key={abbr} style={{ textAlign: align }}>
              <div className="piq-label" style={{ marginBottom: 4 }}>{abbr} wins</div>
              <div className="piq-num" style={{ fontSize: 44, fontWeight: 900, color, lineHeight: 1 }}>{wins}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', height: 8, borderRadius: 99, overflow: 'hidden', background: 'rgba(255,255,255,0.05)' }}
          role="img" aria-label={`${gameInfo.awayAbbr} ${awayWins}, ${gameInfo.homeAbbr} ${homeWins}`}>
          <div style={{ width: `${awayPct}%`, background: 'var(--cyan)', boxShadow: '0 0 10px rgba(0,212,255,0.5)', transition: 'width var(--dur-1) var(--ease)' }} />
          <div style={{ width: `${100 - awayPct}%`, background: 'var(--gold)', boxShadow: '0 0 10px rgba(255,208,96,0.4)' }} />
        </div>
        <div className="piq-label" style={{ textAlign: 'center', marginTop: 'var(--s2)' }}>Last {games.length} meetings</div>
      </HudCard>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
        {games.map((g, i) => {
          const awayWon = (g.awayAbbr === gameInfo.awayAbbr && g.winner === 'away') || (g.homeAbbr === gameInfo.awayAbbr && g.winner === 'home');
          return (
            <HudCard key={i} style={{ padding: 'var(--s4)' }} accent={awayWon ? 'var(--cyan)' : 'var(--gold)'} interactive={false}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)', flexWrap: 'wrap' }}>
                <span className="piq-label" style={{ width: 84, flexShrink: 0 }}>{g.date}</span>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', flex: 1, minWidth: 180 }}>
                  <span style={{ fontFamily: 'Space Mono, monospace', fontSize: 'var(--fs-sm)', fontWeight: 700,
                    color: g.awayAbbr === gameInfo.awayAbbr ? 'var(--cyan)' : 'var(--gold)' }}>{g.awayAbbr}</span>
                  <span className="piq-num" style={{ fontSize: 'var(--fs-lg)', fontWeight: 900,
                    color: g.awayScore > g.homeScore ? 'var(--green)' : 'var(--muted)' }}>{g.awayScore}</span>
                  <span style={{ color: 'var(--faint)', fontFamily: 'Space Mono, monospace' }}>–</span>
                  <span className="piq-num" style={{ fontSize: 'var(--fs-lg)', fontWeight: 900,
                    color: g.homeScore > g.awayScore ? 'var(--green)' : 'var(--muted)' }}>{g.homeScore}</span>
                  <span style={{ fontFamily: 'Space Mono, monospace', fontSize: 'var(--fs-sm)', fontWeight: 700,
                    color: g.homeAbbr === gameInfo.homeAbbr ? 'var(--gold)' : 'var(--cyan)' }}>{g.homeAbbr}</span>
                </div>

                <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap' }}>
                  {catLabels.map(cat => {
                    const awayLdr = g.awayLeaders?.[cat.key];
                    const homeLdr = g.homeLeaders?.[cat.key];
                    if (!awayLdr && !homeLdr) return null;
                    return (
                      <div key={cat.key} style={{ display: 'flex', gap: 6, fontSize: 'var(--fs-micro)', fontFamily: 'Space Mono, monospace', alignItems: 'center' }}>
                        <span style={{ color: 'var(--cyan)' }}>{awayLdr ? `${awayLdr.name} ${awayLdr.value}${cat.label}` : '—'}</span>
                        <span style={{ color: 'var(--faint)' }}>vs</span>
                        <span style={{ color: 'var(--gold)' }}>{homeLdr ? `${homeLdr.name} ${homeLdr.value}${cat.label}` : '—'}</span>
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

// `onPlayerSelect` is optional and currently MLB-only: `MlbPlayerLookupTab`
// embeds this grid beneath its search panel and passes a handler, so a card
// click runs the batter-vs-starter lookup in place. Without it the cards stay
// non-interactive, exactly as before.
function RosterTab({ gameData, onPlayerSelect }) {
  const { gameInfo, awayRoster, homeRoster } = gameData;
  const [side, setSide] = React.useState('away');
  const roster = side === 'away' ? awayRoster : homeRoster;
  const statusColor = s => {
    if (!s || /^active$/i.test(s)) return 'var(--green)';
    if (/out|doubtful/i.test(s)) return 'var(--orange)';
    if (/questionable|day.to.day/i.test(s)) return 'var(--gold)';
    return 'var(--muted)';
  };

  return (
    <div style={{ padding: 'var(--s5) 0' }}>
      <div className="piq-seg" role="group" aria-label="Select team"
        style={{ marginBottom: 'var(--s5)', display: 'flex', width: '100%' }}>
        {[['away', gameInfo.awayFull, gameInfo.awayAbbr], ['home', gameInfo.homeFull, gameInfo.homeAbbr]].map(([s, full, abbr]) => (
          <button key={s} onClick={() => setSide(s)} aria-pressed={side === s}
            style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {abbr} · {full}
          </button>
        ))}
      </div>

      {!roster?.length ? <EmptyState title="ROSTER NOT AVAILABLE" hint="ESPN's roster shape varies by sport — this league may not expose one." /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--s2)' }}>
          {roster.map(p => {
            // The lookup is a BATTER model, so pitchers aren't clickable —
            // the PITCHING tab already covers them.
            const isPitcher = /^(P|SP|RP|LHP|RHP)$/i.test(String(p.position || '').trim());
            const clickable = !!onPlayerSelect && !isPitcher && !!p.name;
            return (
              <HudCard key={p.id} style={{ padding: 'var(--s4) var(--s3)', textAlign: 'center' }}
                accent={statusColor(p.status)}
                interactive={clickable}
                onClick={clickable ? () => onPlayerSelect(p.name) : undefined}
                title={clickable ? `Analyze ${p.name} vs today's starter` : undefined}>
                <PlayerCard player={{ ...p, headshot: p.headshot }} accent={statusColor(p.status)} size="md" />
                <div style={{ marginTop: 'var(--s3)' }}>
                  <Chip color={statusColor(p.status)} strong={!/^active$/i.test(p.status || 'active')}>
                    {/^active$/i.test(p.status) || !p.status ? '● ACTIVE' : p.status.toUpperCase()}
                  </Chip>
                </div>
                {clickable && (
                  <div style={{ marginTop: 'var(--s2)', fontSize: 9.5, fontFamily: 'Space Mono, monospace',
                    color: 'var(--cyan)', letterSpacing: '0.08em' }}>
                    🔍 ANALYZE
                  </div>
                )}
              </HudCard>
            );
          })}
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
    <div style={{ padding: 'var(--s5) 0' }}>
      <div style={{ display: 'flex', gap: 'var(--s3)', marginBottom: 'var(--s5)', flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="piq-seg" role="group" aria-label="Select team">
          {[['away', gameInfo.awayAbbr], ['home', gameInfo.homeAbbr]].map(([s, a]) => (
            <button key={s} onClick={() => setSide(s)} aria-pressed={side === s}>{a}</button>
          ))}
        </div>
        <div className="piq-seg" role="group" aria-label="Select stat" style={{ marginLeft: 'auto' }}>
          {cats.map(c => (
            <button key={c.key} onClick={() => setStatKey(c.key)} aria-pressed={statKey === c.key}>{c.label}</button>
          ))}
        </div>
      </div>

      {/* auto-fit instead of repeat(form.length, 1fr) — the old fixed column
          count squeezed 5 cards into ~60px each on a phone. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 'var(--s3)' }}>
        {form.map((g, i) => {
          const leader = g.player?.[statKey];
          const win = g.result === 'W';
          const c = win ? 'var(--green)' : 'var(--orange)';
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--s2)' }}>
              <HudCard style={{ width: '100%', padding: 'var(--s3) var(--s2)', textAlign: 'center' }} accent={c} interactive={false}>
                {leader ? (
                  <>
                    <PlayerCard player={{ name: leader.name, headshot: leader.headshot }} size="sm" accent={c} />
                    <div className="piq-num" style={{ fontSize: 'var(--fs-xl)', color: c, marginTop: 'var(--s2)' }}>{leader.value}</div>
                    <div className="piq-label">{statKey.toUpperCase()}</div>
                  </>
                ) : (
                  <div style={{ height: 74, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 'var(--fs-xs)', color: 'var(--faint)', fontFamily: 'Space Mono, monospace' }}>NO DATA</div>
                )}
              </HudCard>
              <div style={{ fontSize: 'var(--fs-xs)', fontFamily: 'Space Mono, monospace', textAlign: 'center', color: 'var(--muted)' }}>
                <div style={{ color: c, fontWeight: 700, marginBottom: 2 }}>{g.result} {g.myScore}–{g.oppScore}</div>
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
  elite:   { label: '▲▲ ELITE', color: 'var(--green)' },
  hot:     { label: '▲ HOT',    color: 'var(--gold)' },
  cold:    { label: '▼ COLD',   color: 'var(--muted)' },
  neutral: { label: null },
};

function HotBadge({ tier }) {
  const cfg = HOT_TIER_CFG[tier] || HOT_TIER_CFG.neutral;
  if (!cfg.label) return null;
  return <Chip color={cfg.color} strong={tier !== 'cold'}>{cfg.label}</Chip>;
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

  const confColor = c => c === 'HIGH' ? 'var(--green)' : c === 'MEDIUM' ? 'var(--gold)' : 'var(--muted)';
  const typeColor = t => ({ SPREAD: 'var(--cyan)', TOTAL: 'var(--violet)', PROP: 'var(--orange)', ML: 'var(--gold)' }[t] || 'var(--dim)');

  const KeyWarning = ({ text }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', padding: 'var(--s3) var(--s4)',
      marginBottom: 'var(--s3)', background: 'var(--tint-orange)', border: '1px solid rgba(255,107,53,0.28)',
      borderRadius: 'var(--r-md)', fontSize: 'var(--fs-xs)', color: 'var(--orange)',
      fontFamily: 'Space Mono, monospace', lineHeight: 1.6 }}>
      <span style={{ fontSize: 'var(--fs-md)', flexShrink: 0 }} aria-hidden="true">⚠</span>
      <span>{text}</span>
    </div>
  );

  return (
    <div style={{ padding: 'var(--s5) 0', display: 'flex', flexDirection: 'column', gap: 'var(--s6)' }}>
      <section>
        <SectionHeader label="◆ AI RECOMMENDED PLAYS" sub="Powered by Claude · Based on form, H2H and injuries" />

        {!hasKey && <KeyWarning text="Add your Claude API key in the top bar to generate AI plays." />}

        {!plays && !loading && (
          <button onClick={generate} className="piq-btn piq-btn-primary" style={{ padding: 'var(--s3) var(--s5)' }}>
            ◆ GENERATE AI PLAYS
          </button>
        )}

        {loading && <Loader text="ANALYZING MATCHUP" />}

        {plays && plays.error === 'NO_API_KEY' && <KeyWarning text="No API key set. Paste your Claude key (sk-ant-…) in the top bar." />}

        {Array.isArray(plays) && plays.length === 0 && <EmptyState title="NO PLAYS RETURNED" hint="Claude returned an empty set — try generating again." />}

        {Array.isArray(plays) && plays.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
            {plays.map((p, i) => (
              <HudCard key={i} style={{ padding: 'var(--s4) var(--s5)' }} accent={confColor(p.confidence)} interactive={false}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginBottom: 'var(--s3)', flexWrap: 'wrap' }}>
                  <Chip color={typeColor(p.type)} strong>{p.type}</Chip>
                  <Chip color={confColor(p.confidence)} strong>{p.confidence} CONFIDENCE</Chip>
                </div>
                <div style={{ fontSize: 'var(--fs-md)', fontFamily: 'Space Mono, monospace', color: 'var(--text)',
                  fontWeight: 700, marginBottom: 'var(--s2)', lineHeight: 1.4 }}>{p.play}</div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', fontFamily: 'Space Mono, monospace', lineHeight: 1.7 }}>{p.reason}</div>
              </HudCard>
            ))}
            <button onClick={generate} className="piq-btn" style={{ alignSelf: 'flex-start' }}>↻ REGENERATE</button>
          </div>
        )}
      </section>

      <section>
        <SectionHeader label="YOUR PLAY" sub="Describe a bet and Claude will pressure-test it" />
        <label className="sr-only" htmlFor="piq-userplay">Your play</label>
        <textarea id="piq-userplay" className="piq-textarea" value={userPlay}
          onChange={e => setUserPlay(e.target.value)}
          placeholder="e.g. 'Braves -1.5' or 'Over 8.5 runs' or 'Acuña over 1.5 hits'" />
        <button onClick={discuss} disabled={discussing || !userPlay.trim()}
          className="piq-btn piq-btn-primary" style={{ marginTop: 'var(--s3)' }}>
          {discussing ? 'ANALYZING…' : 'DISCUSS →'}
        </button>
        {discussion && (
          <HudCard style={{ padding: 'var(--s4) var(--s5)', marginTop: 'var(--s3)' }} interactive={false}>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', fontFamily: 'Space Mono, monospace', lineHeight: 1.8 }}>{discussion}</div>
          </HudCard>
        )}
      </section>
    </div>
  );
}

/* Legacy shared style — still consumed by the MLB/NBA sport tabs. */
const emptyMsg = {
  padding: 'var(--s7) var(--s5)',
  textAlign: 'center',
  fontFamily: 'Space Mono, monospace',
  fontSize: 'var(--fs-xs)',
  color: 'var(--dim)',
  letterSpacing: '0.1em',
  border: '1px dashed var(--line-strong)',
  borderRadius: 'var(--r-md)',
  background: 'var(--surface)',
  lineHeight: 1.7,
};

Object.assign(window, {
  OverviewTab, H2HTab, RosterTab, FormTab, HotBadge, AIPlaysTab, emptyMsg,
});
