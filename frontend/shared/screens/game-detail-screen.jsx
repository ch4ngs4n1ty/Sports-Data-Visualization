/* ============================================================
   PLAYIQ — GAME DETAIL SCREEN
   Shared detail shell that plugs in sport-specific tabs
   ============================================================ */

const TABS_MLB = [
  // LIVE leads the list: once a game is in progress it is the only tab whose
  // numbers change by the minute. It renders an explanation (not an error) for
  // a game that has not started or is already final.
  { id: 'live', label: '◉ LIVE' },
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'h2h', label: 'HEAD-TO-HEAD' },
  { id: 'form', label: 'LAST 5' },
  // MLB's roster tab IS the player lookup: search + per-batter projection on
  // top, both 40-mans underneath. Lineup-independent, so it works before a
  // batting order posts — when the lineup-gated boards below are still empty.
  { id: 'roster', label: 'ROSTERS · 🔍 LOOKUP' },
  { id: 'lineup', label: '⬢ LINEUP' },
  { id: 'edges', label: 'EDGE FINDER' },
  { id: 'pitching', label: 'PITCHING' },
  { id: 'lowhr', label: 'LOW HR MODEL' },
  { id: 'highcontact', label: 'HIGH CONTACT' },
  { id: 'ai', label: '◆ AI PLAYS' },
];

const TABS_NBA = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'h2h', label: 'HEAD-TO-HEAD' },
  { id: 'form', label: 'LAST 5' },
  { id: 'roster', label: 'ROSTERS' },
  { id: 'lineups', label: 'LINEUPS' },
  { id: 'def-vs-pos', label: 'DEFENSE vs POSITION' },
  { id: 'edges', label: 'EDGE FINDER' },
  { id: 'ai', label: '◆ AI PLAYS' },
];

// WNBA: same basketball tabs as NBA minus the NBA-only backends (Rotowire
// lineups + defense-vs-position). The Edge Finder projection board still works
// because the threshold model is pure math over each player's game log.
const TABS_WNBA = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'h2h', label: 'HEAD-TO-HEAD' },
  { id: 'form', label: 'LAST 5' },
  { id: 'roster', label: 'ROSTERS' },
  { id: 'lineups', label: '⬢ LINEUPS' },
  { id: 'edges', label: 'EDGE FINDER' },
  { id: 'ai', label: '◆ AI PLAYS' },
];

// NFL: the five sport-agnostic tabs plus a season MATCHUP board. No edge /
// props tabs yet — those are a separate per-sport analytical build.
const TABS_NFL = [
  { id: 'live', label: '◉ LIVE' },
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'h2h', label: 'HEAD-TO-HEAD' },
  { id: 'form', label: 'LAST 5' },
  { id: 'roster', label: 'ROSTERS' },
  { id: 'matchup', label: '⬢ MATCHUP' },
  { id: 'ai', label: '◆ AI PLAYS' },
];

const TABS_OTHER = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'h2h', label: 'HEAD-TO-HEAD' },
  { id: 'form', label: 'LAST 5' },
  { id: 'roster', label: 'ROSTERS' },
  { id: 'ai', label: '◆ AI PLAYS' },
];

function GameDetailScreen({ game: initialGame, onBack }) {
  const [liveUpdate, setLiveUpdate] = React.useState(null);
  const game = liveUpdate?.eventId === initialGame.eventId
    ? window.applyMlbSnapshot(initialGame, liveUpdate.snapshot) : initialGame;
  React.useEffect(() => {
    let dead = false, unsubscribe;
    setLiveUpdate(null);
    if (initialGame.sportKey === 'mlb') window.resolveMlbGamePk(initialGame).then(pk => {
      if (!dead && pk) unsubscribe = window.subscribeMlbLive({ gamePk: pk }, update =>
        setLiveUpdate({ ...update, eventId: initialGame.eventId }));
    });
    return () => { dead = true; unsubscribe?.(); };
  }, [initialGame.eventId]);
  const [tab, setTab] = React.useState(() => {
    const saved = sessionStorage.getItem('piq_tab');
    if (saved === 'live' && !['mlb','nfl'].includes(game.sportKey)) return 'overview';
    // 'lookup' was folded into 'roster'; a session persisted before that
    // change would otherwise restore onto a tab that no longer renders.
    return saved === 'lookup' ? 'roster' : (saved || (['mlb','nfl'].includes(game.sportKey) ? 'live' : 'overview'));
  });
  const [gameData, setGameData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [stepIdx, setStepIdx] = React.useState(0);
  const tabs = game.sportKey === 'mlb' ? TABS_MLB
    : game.sportKey === 'nba' ? TABS_NBA
    : game.sportKey === 'wnba' ? TABS_WNBA
    : game.sportKey === 'nfl' ? TABS_NFL
    : TABS_OTHER;

  React.useEffect(() => { sessionStorage.setItem('piq_tab', tab); }, [tab]);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setStepIdx(0);

      // ── Phase 1 (core data) ─────────────────────────────────────────────
      // Block on the small fetches that the Overview / H2H / Last 5 / Rosters
      // tabs need. As soon as these resolve, render the page so the user can
      // start exploring while heavier extras load in the background.
      try {
        setStepIdx(1);
        const [awayFormRaw, homeFormRaw, injuries, awayRoster, homeRoster] = await Promise.all([
          fetchTeamForm(game.sportKey, game.awayTeamId),
          fetchTeamForm(game.sportKey, game.homeTeamId),
          fetchInjuries(game),
          fetchRoster(game.sportKey, game.awayTeamId),
          fetchRoster(game.sportKey, game.homeTeamId),
        ]);
        setStepIdx(2);
        // Football box scores are split into stat groups (passing/rushing/
        // receiving), so the shared enricher — which reads statistics[0] —
        // would only ever see passing. NFL gets its own parser.
        const enrichForm = game.sportKey === 'nfl'
          ? (sk, teamId, games) => enrichNflFormWithPlayerStats(teamId, games)
          : enrichFormWithPlayerStats;
        const [awayForm, homeForm] = await Promise.all([
          enrichForm(game.sportKey, game.awayTeamId, awayFormRaw),
          enrichForm(game.sportKey, game.homeTeamId, homeFormRaw),
        ]);
        setStepIdx(3);
        const h2h = await fetchH2H(game);

        if (cancelled) return;

        // Render the page now — user can read Overview while extras load
        const initLoading = game.sportKey === 'mlb'
          ? { mlbEdgeData: true, pitchingData: true, highContactData: true, lowHrData: true, mlbPropModel: true, mlbPitcherProps: true, mlbLineups: true }
          : game.sportKey === 'nba'
          ? { nbaEdgeData: true, nbaLineupData: true, nbaDefenseEdge: true, nbaDefenseTable: true }
          : game.sportKey === 'wnba'
          ? { nbaEdgeData: true, nbaLineupData: true }
          : game.sportKey === 'nfl'
          ? { nflProfiles: true }
          : {};
        const baseData = { gameInfo: game, awayForm, homeForm, injuries, awayRoster, homeRoster, h2h, _loading: initLoading };
        setGameData(baseData);
        setLoading(false);
        setStepIdx(4);

        // ── Phase 2 (heavy extras, runs in background) ────────────────────
        // _loading flags let tabs show animated skeletons instead of static
        // "unavailable" text while their slice of data is still in-flight.
        if (game.sportKey === 'mlb') {
          (async () => {
            try {
              const starterData = await fetchMlbStarters(game);
              // BvP, high-contact, low-HR, and the prop model share lineup/pitcher inputs.
              const [bvpData, highContactData, lowHrData, mlbPropModel, mlbPitcherProps, mlbLineups] = await Promise.all([
                fetchGameBvp(game, starterData.lineups, starterData.pitchers),
                fetchHighContactReport(game, starterData.lineups, starterData.pitchers),
                fetchLowHrReport(game, starterData.lineups, starterData.pitchers),
                fetchMlbPropModel(game, starterData.lineups, starterData.pitchers),
                fetchMlbPitcherProps(game, starterData.pitchers),
                fetchMlbLineups(game, starterData.pitchers),
              ]);
              const mlbEdgeData = await buildMlbEdgeData(game, bvpData);
              if (cancelled) return;
              setGameData(prev => prev && { ...prev,
                mlbEdgeData,
                pitchingData: { pitchers: starterData.pitchers },
                highContactData,
                lowHrData,
                mlbPropModel,
                mlbPitcherProps,
                mlbLineups,
                _loading: { ...prev._loading, mlbEdgeData: false, pitchingData: false, highContactData: false, lowHrData: false, mlbPropModel: false, mlbPitcherProps: false, mlbLineups: false },
              });
            } catch (e) {
              console.error('MLB extras failed', e);
              if (!cancelled) setGameData(prev => prev && { ...prev, _loading: { ...prev._loading, mlbEdgeData: false, pitchingData: false, highContactData: false, lowHrData: false, mlbPropModel: false, mlbPitcherProps: false, mlbLineups: false } });
            }
          })();
        } else if (game.sportKey === 'nba') {
          // Three independent extras — fire them in parallel, but commit each
          // to gameData as it lands so individual tabs unlock independently.
          buildNbaEdgeData(game).then(nbaEdgeData => {
            if (!cancelled) setGameData(prev => prev && { ...prev, nbaEdgeData, _loading: { ...prev._loading, nbaEdgeData: false } });
          }).catch(() => {
            if (!cancelled) setGameData(prev => prev && { ...prev, _loading: { ...prev._loading, nbaEdgeData: false } });
          });
          buildNbaLineupData(game, awayRoster, homeRoster).then(nbaLineupData => {
            if (!cancelled) setGameData(prev => prev && { ...prev, nbaLineupData, _loading: { ...prev._loading, nbaLineupData: false } });
          }).catch(() => {
            if (!cancelled) setGameData(prev => prev && { ...prev, _loading: { ...prev._loading, nbaLineupData: false } });
          });
          fetchNbaPositionalDefenseEdge(game).then(nbaDefenseEdge => {
            if (!cancelled) setGameData(prev => prev && { ...prev, nbaDefenseEdge, _loading: { ...prev._loading, nbaDefenseEdge: false } });
          }).catch(() => {
            if (!cancelled) setGameData(prev => prev && { ...prev, _loading: { ...prev._loading, nbaDefenseEdge: false } });
          });
          fetchNbaDefenseVsPositionTable().then(nbaDefenseTable => {
            if (!cancelled) setGameData(prev => prev && { ...prev, nbaDefenseTable, _loading: { ...prev._loading, nbaDefenseTable: false } });
          }).catch(() => {
            if (!cancelled) setGameData(prev => prev && { ...prev, _loading: { ...prev._loading, nbaDefenseTable: false } });
          });
        } else if (game.sportKey === 'wnba') {
          // Feeds the same NbaEdgeFinderTab / NbaLineupTab; no defense-vs-position
          // table for WNBA, so those run without a matchup adjustment.
          buildWnbaEdgeData(game).then(nbaEdgeData => {
            if (!cancelled) setGameData(prev => prev && { ...prev, nbaEdgeData, _loading: { ...prev._loading, nbaEdgeData: false } });
          }).catch(() => {
            if (!cancelled) setGameData(prev => prev && { ...prev, _loading: { ...prev._loading, nbaEdgeData: false } });
          });
          buildWnbaLineupData(game, awayRoster, homeRoster).then(nbaLineupData => {
            if (!cancelled) setGameData(prev => prev && { ...prev, nbaLineupData, _loading: { ...prev._loading, nbaLineupData: false } });
          }).catch(() => {
            if (!cancelled) setGameData(prev => prev && { ...prev, _loading: { ...prev._loading, nbaLineupData: false } });
          });
        } else if (game.sportKey === 'nfl') {
          Promise.all([
            fetchNflTeamProfile(game.awayTeamId),
            fetchNflTeamProfile(game.homeTeamId),
          ]).then(([away, home]) => {
            if (!cancelled) setGameData(prev => prev && { ...prev, nflProfiles: { away, home }, _loading: { ...prev._loading, nflProfiles: false } });
          }).catch(() => {
            if (!cancelled) setGameData(prev => prev && { ...prev, _loading: { ...prev._loading, nflProfiles: false } });
          });
        }
        // Phase 2 step indicator hides when load() returns; any tab waiting
        // on extras still shows its own subtle "loading" message.
        setStepIdx(5);
      } catch (e) {
        console.error(e);
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [game.eventId]);

  // Phase 1 (blocking) → Phase 2 (background extras). The loader hides after
  // step 3 once core data is ready; extras unlock individual tabs as they land.
  const steps = ['LOADING GAME', 'TEAM STATS', 'FORM + PLAYERS', 'HEAD-TO-HEAD'];

  // Roving arrow-key navigation across the tab bar (WAI-ARIA tabs pattern).
  const tabRefs = React.useRef({});
  const onTabKeyDown = e => {
    const idx = tabs.findIndex(t => t.id === tab);
    let next = null;
    if (e.key === 'ArrowRight') next = tabs[(idx + 1) % tabs.length];
    if (e.key === 'ArrowLeft')  next = tabs[(idx - 1 + tabs.length) % tabs.length];
    if (e.key === 'Home')       next = tabs[0];
    if (e.key === 'End')        next = tabs[tabs.length - 1];
    if (!next) return;
    e.preventDefault();
    setTab(next.id);
    tabRefs.current[next.id]?.focus();
    tabRefs.current[next.id]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const isLive = game.statusState === 'in';
  const statusLabel = isLive ? 'In Progress' : game.statusState === 'post' ? 'Final' : 'Scheduled';

  const hasScore = game.statusState === 'in' || game.statusState === 'post';
  const awayWon = hasScore && Number(game.awayScore) > Number(game.homeScore);
  const homeWon = hasScore && Number(game.homeScore) > Number(game.awayScore);

  /* One side of the scoreboard. The logo gets a soft accent halo behind it so
     the marks read as lit objects rather than pasted PNGs, and the losing
     side dims — the result is legible before you read a single number. */
  const TeamSide = ({ logo, abbr, full, score, won, align }) => (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--s2)',
      flex: 1, minWidth: 0, textAlign: 'center',
      opacity: hasScore && !won ? 0.62 : 1,
      transition: 'opacity var(--dur-3) ease',
    }}>
      {/* Team logos are dark-on-transparent for several clubs (NYY navy, BOS
          deep red), which disappears on this background. A light plate behind
          the mark plus a brightness lift keeps every club legible without
          recoloring anyone's brand. */}
      <div style={{ position: 'relative', width: 66, height: 66, display: 'grid', placeItems: 'center' }}>
        <span aria-hidden="true" style={{ position: 'absolute', inset: 0, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,255,255,0.13), rgba(255,255,255,0.05) 58%, transparent 72%)' }} />
        <img src={logo} alt="" loading="lazy"
          style={{ width: 54, height: 54, objectFit: 'contain', position: 'relative',
            filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.55)) brightness(1.22) contrast(1.06)' }}
          onError={e => { e.target.style.visibility = 'hidden'; }} />
      </div>
      <div className="piq-num" style={{ fontSize: 'clamp(20px, 3vw, 30px)', color: 'var(--text)',
        letterSpacing: '0.04em', lineHeight: 1 }}>{abbr}</div>
      <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--dim)', fontFamily: 'Space Mono, monospace',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{full}</div>
      {hasScore && (
        <div className="piq-num tabular" style={{ fontSize: 'clamp(34px, 6vw, 56px)', lineHeight: 1,
          color: won ? 'var(--green)' : 'var(--text)', marginTop: 2,
          textShadow: won ? '0 0 30px rgba(0,255,136,0.45)' : 'none' }}>{score ?? '—'}</div>
      )}
    </div>
  );

  return (
    <div style={{ maxWidth: 'var(--maxw)', margin: '0 auto', padding: '0 var(--s5) var(--s7)' }}>
      {/* ── Game header ──────────────────────────────────────
          A broadcast-style scoreboard rather than a text line: both marks at
          equal weight either side of the status, scores when the game is
          under way, and the betting lines directly beneath. */}
      {tab === 'live' && ['mlb','nfl'].includes(game.sportKey) && <button onClick={onBack} className="piq-btn piq-btn-ghost" style={{ margin: '16px 0' }}>← GAMES</button>}
      {!(tab === 'live' && ['mlb','nfl'].includes(game.sportKey)) && <header style={{ padding: 'var(--s5) 0 var(--s4)' }}>
        <button onClick={onBack} className="piq-btn piq-btn-ghost" style={{ marginBottom: 'var(--s4)' }}>← GAMES</button>

        <HudCard glow={false} style={{ padding: 'var(--s5)', overflow: 'hidden' }}>
          {/* Live games get a running accent line along the top edge */}
          {/* Inset past the card's 8px corner radius so the line reads as a
              full-width bar rather than one clipped at both ends. */}
          {isLive && (
            <div className="runline" aria-hidden="true"
              style={{ position: 'absolute', top: 0, left: 10, right: 10, height: 2,
                borderRadius: '0 0 2px 2px' }} />
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)' }}>
            <TeamSide logo={game.awayLogo} abbr={game.awayAbbr} full={game.awayFull}
              score={game.awayScore} won={awayWon} />

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 'var(--s2)', flexShrink: 0, padding: '0 var(--s2)' }}>
              <StatusBadge status={statusLabel} />
              {game.sportKey === 'mlb' && <span role="status" style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>
                Updates: {liveUpdate?.status || 'connecting'}
              </span>}
              <div className="piq-label" style={{ fontSize: 'var(--fs-lg)', color: 'var(--faint)', letterSpacing: 0 }}>
                {hasScore ? '·' : '@'}
              </div>
              {game.statusDetail && (
                <div style={{ fontSize: 'var(--fs-micro)', color: isLive ? 'var(--green)' : 'var(--muted)',
                  fontFamily: 'Space Mono, monospace', whiteSpace: 'nowrap', fontWeight: 700 }}>
                  {game.statusDetail}
                </div>
              )}
            </div>

            <TeamSide logo={game.homeLogo} abbr={game.homeAbbr} full={game.homeFull}
              score={game.homeScore} won={homeWon} />
          </div>

          {game.venue && (
            <div style={{ textAlign: 'center', marginTop: 'var(--s4)', paddingTop: 'var(--s3)',
              borderTop: '1px solid var(--line)', fontSize: 'var(--fs-micro)',
              color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em' }}>
              ⌖ {game.venue}
            </div>
          )}
        </HudCard>

        <div style={{ marginTop: 'var(--s3)', display: 'flex', justifyContent: 'center' }}>
          <OddsStrip game={game} />
        </div>
      </header>}

      {loading && !(['mlb','nfl'].includes(game.sportKey) && tab === 'live') ? (
        <div style={{ padding: 'var(--s6) 0' }}>
          <Loader text={steps[stepIdx] || 'LOADING'} />
          <ol style={{ display: 'flex', justifyContent: 'center', gap: 'var(--s2)', marginTop: 'var(--s4)',
            flexWrap: 'wrap', listStyle: 'none', padding: 0 }}>
            {steps.map((s, i) => (
              <li key={i}>
                <Chip color={i < stepIdx ? 'var(--green)' : i === stepIdx ? 'var(--cyan)' : 'var(--dim)'}
                  strong={i <= stepIdx}>
                  {i < stepIdx ? '✓' : i === stepIdx ? '●' : '○'} {s}
                </Chip>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <>
          {/* Sticky so the user keeps their bearings inside long tabs like
              Edge Finder / High Contact. Offset by the 56px top nav. */}
          <div className="piq-tabs" role="tablist" aria-label="Game analysis sections"
            onKeyDown={onTabKeyDown}
            style={{ position: 'sticky', top: 'var(--nav-h)', zIndex: 100,
              background: 'rgba(5,8,15,0.9)', backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)', marginBottom: 'var(--s2)' }}>
            {tabs.map(t => (
              <button key={t.id}
                ref={el => { tabRefs.current[t.id] = el; }}
                className="piq-tab"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="tabpanel"
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          <div id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1} style={{ minHeight: 400 }}>
            {tab === 'live' && game.sportKey === 'mlb' && <MlbLiveTab key={game.eventId} gameData={gameData} gameInfo={game} />}
            {tab === 'live' && game.sportKey === 'nfl' && <NflLiveTab key={game.eventId} gameInfo={game} />}
            {tab === 'overview' && <OverviewTab gameData={gameData} />}
            {tab === 'h2h' && <H2HTab gameData={gameData} />}
            {tab === 'form' && <FormTab gameData={gameData} />}
            {/* MLB folds the player lookup into the roster tab (search +
                projection above, the 40-mans below). Other sports get the
                plain, non-clickable roster. */}
            {tab === 'roster' && (game.sportKey === 'mlb'
              ? <MlbPlayerLookupTab gameData={gameData} />
              : <RosterTab gameData={gameData} />)}
            {tab === 'lineup' && <MlbLineupFieldTab gameData={gameData} />}
            {tab === 'lineups' && (game.sportKey === 'wnba'
              ? <WnbaCourtLineupTab gameData={gameData} />
              : <NbaLineupTab gameData={gameData} />)}
            {tab === 'def-vs-pos' && <NbaDefenseVsPositionTab gameData={gameData} />}
            {tab === 'matchup' && <NflMatchupTab gameData={gameData} />}
            {tab === 'edges' && ((game.sportKey === 'nba' || game.sportKey === 'wnba')
              ? <NbaEdgeFinderTab gameData={gameData} />
              : <EdgeFinderTab gameData={gameData} />)}
            {tab === 'pitching' && <PitchingEdgeTab gameData={gameData} />}
            {tab === 'lowhr' && <LowHrModelTab gameData={gameData} />}
            {tab === 'highcontact' && <HighContactTab gameData={gameData} />}
            {tab === 'ai' && <AIPlaysTab gameData={gameData} />}
          </div>
        </>
      )}
    </div>
  );
}

Object.assign(window, { GameDetailScreen });
