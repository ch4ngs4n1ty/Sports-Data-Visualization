/* ============================================================
   PLAYIQ — GAMES SCREEN
   Multi-sport schedule view
   ============================================================ */

/* ── Loading placeholders ────────────────────────────────
   MLB cards carry two backend-fed strips (readiness + hot-play signal) that
   arrive seconds AFTER the ESPN slate paints. Rendering nothing while they
   load made the card look finished, then jump as each strip popped in — the
   user read that as the app being broken/empty on open.

   So: while a source is in flight we render a placeholder of the SAME height
   as the real thing. The card's final layout is claimed on first paint and
   nothing reflows when the data lands. Placeholders are `aria-hidden` and
   inherit the reduced-motion guard in index.html. */
function SkelBar({ w, h = 18, r = 99, delay = 0, style }) {
  return (
    <span aria-hidden="true" style={{
      display: 'inline-block', width: w, height: h, borderRadius: r,
      background: 'var(--surface)', border: '1px solid var(--line)',
      position: 'relative', overflow: 'hidden', flexShrink: 0,
      animation: `skeletonPulse 1.6s ease-in-out ${delay}s infinite`,
      ...style,
    }}>
      <span style={{ position: 'absolute', top: 0, left: '-100%', width: '55%', height: '100%',
        background: 'linear-gradient(90deg, transparent, var(--accent-soft), transparent)',
        animation: `shimmer 1.9s ease-in-out ${delay + 0.2}s infinite` }} />
    </span>
  );
}

// Matches MlbReadyRow's height: one row of chips under the matchup.
function MlbReadyRowSkeleton() {
  // 22px === a Chip's rendered height (3px padding top/bottom around an
  // 11px/--fs-micro line). Keep these in sync with Chip or the strip shifts
  // by the difference when the real pills replace it.
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
      <SkelBar w={54} h={22} delay={0} />
      <SkelBar w={78} h={22} delay={0.12} />
    </div>
  );
}

// Matches SignalBadge's two-line box so a badge landing doesn't push the
// footer down. Height is the badge's: ~2 lines + padding.
function SignalBadgeSkeleton() {
  return (
    <div aria-hidden="true" style={{
      marginTop: 'var(--s3)', padding: '7px 9px', borderRadius: 'var(--r-sm)',
      background: 'var(--surface)', border: '1px solid var(--line)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
        <SkelBar w={12} h={12} r={3} delay={0} />
        {/* Line heights mirror the real badge: a --fs-micro tier label (~14px
            line box) over a --fs-xs player line (~16px), so the two-line block
            measures the same before and after the data lands. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <SkelBar w="42%" h={14} delay={0.1} style={{ display: 'block' }} />
          <SkelBar w="68%" h={16} delay={0.2} style={{ display: 'block', marginTop: 2 }} />
        </div>
      </div>
      {/* Matches the AngleChip row: 2px+2px padding around a --fs-micro line. */}
      <div style={{ display: 'flex', gap: 4, marginTop: 5, paddingLeft: 20 }}>
        <SkelBar w={84} h={18} r={6} delay={0.3} />
        <SkelBar w={64} h={18} r={6} delay={0.38} />
      </div>
    </div>
  );
}

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

/* ── Hot-play signal ─────────────────────────────────────
   The "go here first" indicator. Answers, without opening the game:
   is there a specific player in a real streak here, and WHICH point do I
   look at — the pitcher he's facing, his history vs this team, or where
   he hits in the order?

   Backed by /api/mlb/slate-signals, which requires a consecutive-game
   streak plus at least one matchup angle before it badges anything. The
   badge therefore shows three things, in order of what the user acts on:
     1. the streak (the headline — "12-game hit streak")
     2. the market it points at (HITS 0.5+, RBI, K, … — never HR-only)
     3. the angle chips (BvP / vs-team / lineup spot), each labeled with
        its source so it can be checked in the tabs rather than trusted
   Triage only — the per-game models remain the truth. */
const SIGNAL_TIERS = {
  hot:  { color: 'var(--green)',  glyph: '🔥', label: 'HOT PLAY' },
  warm: { color: 'var(--gold)',   glyph: '▲',  label: 'LEAN'     },
  note: { color: 'var(--cyan)',   glyph: '•',  label: 'LOOK'     },
};

// What each angle kind means and where to verify it. The prefix is the
// whole point: "VS SP" tells the user to open PITCHING/EDGE, "ORDER"
// tells them the lineup is already posted and this bat is hitting high.
const ANGLE_KINDS = {
  bvp:    { tag: 'VS SP',   tab: 'Edge Finder / Player Lookup' },
  vsteam: { tag: 'VS TEAM', tab: 'H2H' },
  order:  { tag: 'ORDER',   tab: 'Lineup' },
  form:   { tag: 'FORM',    tab: 'Last 5' },
  streak: { tag: 'STREAK',  tab: 'Last 5' },
};

function AngleChip({ a }) {
  const meta = ANGLE_KINDS[a.kind] || { tag: a.kind.toUpperCase(), tab: '' };
  // Direction drives the color: an angle that argues AGAINST the streak is
  // still worth showing (it's a point to look at), just not in green.
  const color = a.direction === 'fade' ? 'var(--orange)'
    : a.direction === 'back' ? 'var(--green)' : 'var(--muted)';
  return (
    <span title={meta.tab ? `${a.text} — check the ${meta.tab} tab` : a.text}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
        maxWidth: '100%', minWidth: 0,
        padding: '2px 6px', borderRadius: 'var(--r-sm)',
        background: color + '12', border: `1px solid ${color}33` }}>
      <span className="piq-num" style={{ fontSize: 'var(--fs-micro)', color,
        letterSpacing: '0.1em', fontWeight: 700, flexShrink: 0 }}>{meta.tag}</span>
      <span style={{ fontSize: 'var(--fs-micro)', fontFamily: 'Space Mono, monospace',
        color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden',
        textOverflow: 'ellipsis' }}>{a.text}</span>
    </span>
  );
}

function SignalBadge({ sig }) {
  const t = SIGNAL_TIERS[sig?.tier];
  if (!t || !sig.top) return null;
  const top = sig.top;
  // A vulnerable starter is an opportunity too, but it points the other way —
  // label it so the user doesn't read it as "back this arm". `caution` is the
  // batter equivalent: the streak is real, the matchup argues against it.
  const fade = top.direction === 'fade';
  const caution = top.direction === 'caution';
  const color = fade ? 'var(--orange)' : caution ? 'var(--gold)' : t.color;
  const extra = sig.count - 1;

  // Matchup angles are what make this actionable, so they lead; form is the
  // supporting detail and only fills a remaining slot.
  const angles = top.angles || [];
  const matchup = angles.filter(a => a.kind === 'bvp' || a.kind === 'vsteam' || a.kind === 'order');
  const shown = (matchup.length ? matchup : angles.filter(a => a.kind !== 'streak')).slice(0, 2);

  const label = fade ? 'FADE SP' : caution ? 'CHECK MATCHUP' : t.label;
  const tip = [
    `${top.name} (${top.team})`,
    top.stat,
    ...angles.map(a => `• ${a.text}`),
    top.confirmed ? '' : '(lineup not posted; projected)',
  ].filter(Boolean).join('\n');

  return (
    <div title={tip}
      style={{
        marginTop: 'var(--s3)', padding: '7px 9px',
        borderRadius: 'var(--r-sm)',
        background: color + '14',
        border: `1px solid ${color}44`,
      }}>
      {/* line 1: tier + the player and the streak that earned the badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
        <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1, flexShrink: 0 }}>
          {fade ? '⚠' : caution ? '◐' : t.glyph}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span className="piq-num" style={{ fontSize: 'var(--fs-micro)', color,
              letterSpacing: '0.12em', fontWeight: 700 }}>
              {label}
            </span>
            {top.market && (
              <span className="piq-num" style={{ fontSize: 'var(--fs-micro)',
                color: 'var(--muted)', letterSpacing: '0.08em' }}>{top.market}</span>
            )}
            {!top.confirmed && (
              <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--faint)',
                fontFamily: 'Space Mono, monospace' }} title="Lineup not posted yet — projected">PROJ</span>
            )}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', fontFamily: 'Space Mono, monospace',
            color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: 'ellipsis' }}>
            {top.name} <span style={{ color: 'var(--muted)' }}>· {top.stat}</span>
          </div>
        </div>
        {extra > 0 && (
          <span title={`${extra} more signal${extra === 1 ? '' : 's'} in this game`}
            style={{ fontSize: 'var(--fs-micro)', fontFamily: 'Space Mono, monospace',
              color: 'var(--muted)', flexShrink: 0 }}>+{extra}</span>
        )}
      </div>
      {/* line 2: the angles — WHICH points to look at */}
      {shown.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4,
          marginTop: 5, paddingLeft: 20 }}>
          {shown.map((a, i) => <AngleChip key={i} a={a} />)}
        </div>
      )}
    </div>
  );
}

/* ── One game card ──────────────────────────────────────── */
const weekdayOf = iso => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

function GameCard({ g, onSelect, readiness, signals, formatTime, readinessPending, signalsPending }) {
  const isLive  = g.statusState === 'in';
  const isFinal = g.statusState === 'post';
  const showScore = isLive || isFinal;
  // A hot signal claims the card accent on pre-game cards — that glow is the
  // whole point of the feature: spot the game to research from across the grid.
  const hasHot = !isLive && !isFinal && signals?.tier === 'hot';
  const accent = isLive ? 'var(--green)' : isFinal ? 'var(--dim)'
    : hasHot ? (signals.top?.direction === 'fade' ? 'var(--orange)'
      : signals.top?.direction === 'caution' ? 'var(--gold)' : 'var(--green)')
    : 'var(--cyan)';

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
          {isFinal ? 'FINAL' : isLive ? g.statusDetail
            /* A weekFallback game is NOT today (NFL plays ~3 days a week, so
               the slate shows the rest of the week). Showing a bare time would
               read as "today at 1:00 PM" — prefix the weekday. */
            : g.weekFallback ? `${weekdayOf(g.date)} · ${formatTime(g.date)}`
            : formatTime(g.date)}
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

      {/* Pre-game MLB only. While the slate endpoints are in flight we hold the
          space with a skeleton instead of rendering nothing, so the card doesn't
          reflow when SP/LINEUP and the hot-play badge land a few seconds later. */}
      {g.sportKey === 'mlb' && !isLive && !isFinal && (
        readinessPending ? <MlbReadyRowSkeleton /> : <MlbReadyRow r={readiness} />
      )}
      {g.sportKey === 'mlb' && !isLive && !isFinal && (
        signalsPending ? <SignalBadgeSkeleton /> : <SignalBadge sig={signals} />
      )}

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
  const [mlbSignals, setMlbSignals] = React.useState([]);
  // `[]` can't tell "still fetching" apart from "backend returned nothing", and
  // the two must look different: the first shows a skeleton, the second shows
  // the bare card. Tracked separately per source because readiness (~1s) and
  // signals (~4s, or a Render cold start) resolve far apart — the readiness
  // strip should settle as soon as it can rather than wait on signals.
  const [readinessPending, setReadinessPending] = React.useState(true);
  const [signalsPending, setSignalsPending] = React.useState(true);
  const [hotOnly, setHotOnly] = React.useState(false);
  const [liveStatus, setLiveStatus] = React.useState('connecting');
  const liveSlate = React.useRef(null);
  React.useEffect(() => {
    liveSlate.current = null;
    return window.subscribeMlbLive({ date }, update => {
      setLiveStatus(update.status);
      if (update.snapshot) {
        liveSlate.current = update.snapshot;
        setGames(g => window.mergeMlbSlate(g, update.snapshot));
      }
    });
  }, [date]);

  React.useEffect(() => {
    // Mirror prewarm here in case the user lands on Games via deep link.
    prewarmBackend();
    setLoading(true);
    setMlbReadiness([]);
    setMlbSignals([]);
    setReadinessPending(true);
    setSignalsPending(true);
    let cancelled = false;
    let gamesTimer;
    const loadGames = async () => {
      if (document.hidden) { gamesTimer = setTimeout(loadGames, 60000); return; }
      try {
        const g = await fetchAllGames(date);
        if (!cancelled) { setGames(prev => window.mergeMlbSlate(g.length ? g : prev, liveSlate.current)); setLoading(false); }
      } catch { if (!cancelled) setLoading(false); }
      finally { if (!cancelled) gamesTimer = setTimeout(loadGames, 60000); }
    };
    setGames([]);
    loadGames();

    // Slate readiness (SP + lineups) for MLB cards. fetchMlbSlateReadiness
    // retries through a Render cold start; poll every 2 min so the strip also
    // updates live as lineups post through the evening. Guard against stale
    // writes when the date changes / the screen unmounts.
    // `.finally` clears the skeleton on BOTH paths: fetchMlbSlateReadiness
    // already swallows failures into [], but if it ever rejects the cards must
    // still settle rather than shimmer forever. Polls re-enter this function
    // with pending already false, so a refresh never re-skeletons a live card.
    const loadReadiness = () => fetchMlbSlateReadiness(date)
      .then(r => { if (!cancelled) setMlbReadiness(r); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setReadinessPending(false); });
    loadReadiness();
    const pollId = setInterval(loadReadiness, 120000);

    // Hot-play signals. Recent-form driven, so they move far slower than
    // lineups — the backend caches for 10 min and we refresh on that cadence
    // rather than every 2 min with readiness.
    const loadSignals = () => fetchMlbSlateSignals(date)
      .then(s => { if (!cancelled) setMlbSignals(s); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSignalsPending(false); });
    loadSignals();
    const sigPollId = setInterval(loadSignals, 600000);

    return () => { cancelled = true; clearTimeout(gamesTimer); clearInterval(pollId); clearInterval(sigPollId); };
  }, [date]);

  const sports = ['all', ...new Set(games.map(g => g.sportKey))];

  // Signals only exist for MLB, and only pre-game. Resolved once here so both
  // the filter and the cards read the same value.
  const signalFor = g => (g.sportKey === 'mlb' && g.statusState === 'pre')
    ? findMlbSignals(mlbSignals, g.awayFull, g.homeFull)
    : null;
  const hotCount = games.filter(g => {
    const s = signalFor(g);
    return s && (s.tier === 'hot' || s.tier === 'warm');
  }).length;

  const bySport0 = filter === 'all' ? games : games.filter(g => g.sportKey === filter);
  // "Signals only" is the real research-time saver: collapse a 15-game slate
  // down to the handful that actually have something to shop.
  const displayed = hotOnly
    ? bySport0.filter(g => { const s = signalFor(g); return s && (s.tier === 'hot' || s.tier === 'warm'); })
    : bySport0;
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
      <div role="status" style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginBottom: 'var(--s3)' }}>
        MLB updates · {liveStatus === 'live' ? 'connected' : liveStatus === 'polling' ? 'polling' : liveStatus} · free public feed
      </div>
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
            {/* The signals call is the slow one, so this toggle would otherwise
                appear several seconds after the toolbar. Reserve its width with
                a placeholder while the slate has MLB games still to be scored. */}
            {signalsPending && games.some(g => g.sportKey === 'mlb' && g.statusState === 'pre') && (
              <SkelBar w={116} h={22} />
            )}
            {!signalsPending && hotCount > 0 && (
              <button
                onClick={() => setHotOnly(v => !v)}
                aria-pressed={hotOnly}
                title="Show only games with a hot batter or notable starter"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 'var(--fs-micro)', fontFamily: 'Space Mono, monospace',
                  fontWeight: 700, letterSpacing: '0.12em',
                  color: hotOnly ? 'var(--bg)' : 'var(--green)',
                  background: hotOnly ? 'var(--green)' : 'rgba(0,255,136,0.11)',
                  border: '1px solid var(--green)',
                  padding: '3px 9px', borderRadius: 99, cursor: 'pointer',
                }}>
                🔥 {hotCount} WITH PLAYS
              </button>
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
          ? (hotOnly
              ? <EmptyState title="NO SIGNALS IN THIS FILTER"
                  hint="No game here has a hot batter or notable starter right now. Turn off “WITH PLAYS” to see the full slate." />
              : <EmptyState title={`NO GAMES ON ${dateLabel}`}
                  hint="Try another date. NCAAB is off-season in spring, and some leagues have dark days mid-week." />)
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
                    readiness={findMlbReadiness(mlbReadiness, g.awayFull, g.homeFull)}
                    signals={signalFor(g)}
                    readinessPending={readinessPending}
                    signalsPending={signalsPending} />
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
