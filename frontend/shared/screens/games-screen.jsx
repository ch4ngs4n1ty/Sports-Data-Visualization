/* ============================================================
   PLAYIQ — GAMES SCREEN
   Multi-sport schedule view
   ============================================================ */

// Research-readiness strip for pre-game MLB cards: are the starters and batting
// lineups set? Lets the user skip games that aren't ready to analyze yet.
function MlbReadyRow({ r }) {
  if (!r) return null;
  const pill = (label, full, partial) => {
    const state = full ? 'full' : partial ? 'partial' : 'none';
    const c = state === 'full' ? 'var(--green)' : state === 'partial' ? 'var(--gold)' : 'var(--dim)';
    const glyph = state === 'full' ? '✓' : state === 'partial' ? '◐' : '○';
    const title = `${label}: ${state === 'full' ? 'both set' : state === 'partial' ? 'one side set' : 'not set yet'}`;
    return <Chip color={c} strong={state !== 'none'} title={title}>{glyph} {label}</Chip>;
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginTop: 'var(--s3)', flexWrap: 'wrap' }}>
      {pill('SP', r.pitchers, r.awayPitcher || r.homePitcher)}
      {pill('LINEUP', r.lineups, r.awayLineup || r.homeLineup)}
      {r.researchReady && (
        <Chip color="var(--green)" strong style={{ marginLeft: 'auto', boxShadow: '0 0 14px rgba(0,255,136,0.28)' }}>
          ● READY
        </Chip>
      )}
    </div>
  );
}

/* ── One game card ──────────────────────────────────────── */
function GameCard({ g, onSelect, readiness, formatTime }) {
  const isLive  = g.statusState === 'in';
  const isFinal = g.statusState === 'post';
  const showScore = isLive || isFinal;
  const accent = isLive ? 'var(--green)' : isFinal ? 'var(--dim)' : 'var(--cyan)';

  // Winner gets full-strength type; loser is dimmed. Reads instantly at a glance.
  const awayWon = showScore && g.awayScore > g.homeScore;
  const homeWon = showScore && g.homeScore > g.awayScore;

  const Side = ({ abbr, logo, score, won, align }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', minWidth: 0,
      flexDirection: align === 'right' ? 'row-reverse' : 'row' }}>
      <img src={logo} alt="" loading="lazy"
        style={{ width: 34, height: 34, objectFit: 'contain', flexShrink: 0,
          filter: showScore && !won ? 'grayscale(0.5) opacity(0.65)' : 'none' }}
        onError={e => { e.target.style.visibility = 'hidden'; }} />
      <div style={{ minWidth: 0, textAlign: align === 'right' ? 'right' : 'left' }}>
        <div className="piq-num" style={{ fontSize: 'var(--fs-md)',
          color: showScore && !won ? 'var(--muted)' : 'var(--text)', letterSpacing: '0.03em' }}>{abbr}</div>
        {showScore && (
          <div className="piq-num" style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.1,
            color: won ? 'var(--green)' : 'var(--muted)' }}>{score}</div>
        )}
      </div>
    </div>
  );

  return (
    <HudCard onClick={() => onSelect(g)} accent={accent} style={{ padding: 'var(--s4)' }}>
      {/* header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 'var(--s2)', marginBottom: 'var(--s4)' }}>
        <StatusBadge status={isFinal ? 'Final' : isLive ? 'In Progress' : 'Scheduled'} />
        <span style={{ fontSize: 'var(--fs-xs)', fontFamily: 'Space Mono, monospace',
          color: isLive ? 'var(--green)' : 'var(--muted)', fontWeight: isLive ? 700 : 400,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {isFinal ? 'FINAL' : isLive ? g.statusDetail : formatTime(g.date)}
        </span>
      </div>

      {/* matchup */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 'var(--s2)',
        alignItems: 'center', marginBottom: 'var(--s3)' }}>
        <Side abbr={g.awayAbbr} logo={g.awayLogo} score={g.awayScore} won={awayWon} align="left" />
        <span className="piq-label" style={{ fontSize: 'var(--fs-micro)', letterSpacing: '0.1em' }}>
          {showScore ? '·' : 'AT'}
        </span>
        <Side abbr={g.homeAbbr} logo={g.homeLogo} score={g.homeScore} won={homeWon} align="right" />
      </div>

      {g.sportKey === 'mlb' && !isLive && !isFinal && <MlbReadyRow r={readiness} />}

      {/* footer: odds + CTA */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--s2)',
        marginTop: 'var(--s3)', paddingTop: 'var(--s3)', borderTop: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', minWidth: 0 }}>
          {g.spread    && <Chip color="var(--muted)">{g.spread}</Chip>}
          {g.overUnder && <Chip color="var(--muted)">O/U {g.overUnder}</Chip>}
          {!g.spread && !g.overUnder && <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--faint)', fontFamily: 'Space Mono, monospace' }}>NO LINE</span>}
        </div>
        <span style={{ fontSize: 'var(--fs-micro)', fontFamily: 'Space Mono, monospace', fontWeight: 700,
          color: 'var(--cyan)', letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>ANALYZE →</span>
      </div>
    </HudCard>
  );
}

function GamesScreen({ onSelectGame, onBack }) {
  const [games, setGames] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [date, setDate] = React.useState(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
  const [filter, setFilter] = React.useState('all');
  const [mlbReadiness, setMlbReadiness] = React.useState([]);

  React.useEffect(() => {
    // Mirror prewarm here in case the user lands on Games via deep link.
    prewarmBackend();
    setLoading(true);
    setMlbReadiness([]);
    fetchAllGames(date).then(g => { setGames(g); setLoading(false); });

    // Slate readiness (SP + lineups) for MLB cards. fetchMlbSlateReadiness
    // retries through a Render cold start; poll every 2 min so the strip also
    // updates live as lineups post through the evening. Guard against stale
    // writes when the date changes / the screen unmounts.
    let cancelled = false;
    const loadReadiness = () => fetchMlbSlateReadiness(date)
      .then(r => { if (!cancelled) setMlbReadiness(r); })
      .catch(() => {});
    loadReadiness();
    const pollId = setInterval(loadReadiness, 120000);
    return () => { cancelled = true; clearInterval(pollId); };
  }, [date]);

  const sports = ['all', ...new Set(games.map(g => g.sportKey))];
  const displayed = filter === 'all' ? games : games.filter(g => g.sportKey === filter);
  const bySport = {};
  displayed.forEach(g => { (bySport[g.sportKey] = bySport[g.sportKey] || []).push(g); });
  const formatTime = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  const liveCount = displayed.filter(g => g.statusState === 'in').length;

  // Friendly date label — "TODAY" beats reading an ISO string.
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const dateLabel = date === todayStr
    ? 'TODAY'
    : new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();

  return (
    <div style={{ maxWidth: 'var(--maxw)', margin: '0 auto', padding: 'var(--s5)' }}>
      {/* ── Toolbar ──────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginBottom: 'var(--s5)', flexWrap: 'wrap' }}>
        <button onClick={onBack} className="piq-btn piq-btn-ghost">← SPORTS</button>

        <div style={{ flex: 1, minWidth: 140 }}>
          <h1 className="piq-num" style={{ fontSize: 'var(--fs-xl)', color: 'var(--text)', letterSpacing: '0.04em', margin: 0, lineHeight: 1.1 }}>
            {dateLabel}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginTop: 5, flexWrap: 'wrap' }}>
            <span className="piq-label">{displayed.length} game{displayed.length === 1 ? '' : 's'}</span>
            {liveCount > 0 && (
              <Chip color="var(--green)" strong>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)',
                  boxShadow: '0 0 7px var(--green)', animation: 'livePulse 1.4s ease-in-out infinite' }} />
                {liveCount} LIVE
              </Chip>
            )}
          </div>
        </div>

        <label className="sr-only" htmlFor="piq-date">Schedule date</label>
        <input id="piq-date" type="date" className="piq-input" value={date}
          onChange={e => setDate(e.target.value)}
          style={{ width: 'auto', color: 'var(--cyan)', fontWeight: 700 }} />
      </div>

      {/* ── Sport filter ─────────────────────────────────── */}
      {!loading && sports.length > 1 && (
        <div className="piq-seg" role="group" aria-label="Filter by sport"
          style={{ marginBottom: 'var(--s5)', maxWidth: '100%', overflowX: 'auto' }}>
          {sports.map(s => (
            <button key={s} onClick={() => setFilter(s)} aria-pressed={filter === s}>
              {s === 'all' ? `ALL · ${games.length}` : `${s.toUpperCase()} · ${games.filter(g => g.sportKey === s).length}`}
            </button>
          ))}
        </div>
      )}

      {/* ── Slate ────────────────────────────────────────── */}
      {loading ? <Loader text="FETCHING SCHEDULE" /> : (
        Object.keys(bySport).length === 0
          ? <EmptyState title={`NO GAMES ON ${dateLabel}`}
              hint="Try another date. NCAAB is off-season in spring, and some leagues have dark days mid-week." />
          : Object.entries(bySport).map(([sportKey, sportGames]) => (
            <section key={sportKey} style={{ marginBottom: 'var(--s6)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginBottom: 'var(--s3)' }}>
                <h2 className="piq-num" style={{ fontSize: 'var(--fs-sm)', color: 'var(--cyan)', letterSpacing: '0.16em', margin: 0 }}>
                  {sportKey.toUpperCase()}
                </h2>
                <div aria-hidden="true" style={{ flex: 1, height: 1,
                  background: 'linear-gradient(90deg, var(--line-accent), transparent)' }} />
                <span className="piq-label">{sportGames.length} games</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--s3)' }}>
                {sportGames.map((g, i) => (
                  <GameCard key={g.eventId || i} g={g} onSelect={onSelectGame} formatTime={formatTime}
                    readiness={findMlbReadiness(mlbReadiness, g.awayFull, g.homeFull)} />
                ))}
              </div>
            </section>
          ))
      )}
    </div>
  );
}

/* Kept for backwards compatibility — GameDetailScreen imports this style
   for its own back button. New code should use the .piq-btn class instead. */
const backBtnStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--line-strong)',
  color: 'var(--cyan)',
  fontFamily: 'Space Mono, monospace',
  fontSize: 'var(--fs-xs)',
  fontWeight: 700,
  letterSpacing: '0.12em',
  padding: '8px 16px',
  cursor: 'pointer',
  borderRadius: 'var(--r-sm)',
  flexShrink: 0,
};

Object.assign(window, { GamesScreen, backBtnStyle });
