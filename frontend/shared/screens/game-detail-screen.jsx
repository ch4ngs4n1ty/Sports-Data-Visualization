/* ============================================================
   PLAYIQ — GAME DETAIL SCREEN
   Shared detail shell that plugs in sport-specific tabs
   ============================================================ */

const TABS_MLB = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'h2h', label: 'HEAD-TO-HEAD' },
  { id: 'form', label: 'LAST 5' },
  { id: 'roster', label: 'ROSTERS' },
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

const TABS_OTHER = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'h2h', label: 'HEAD-TO-HEAD' },
  { id: 'form', label: 'LAST 5' },
  { id: 'roster', label: 'ROSTERS' },
  { id: 'ai', label: '◆ AI PLAYS' },
];

function GameDetailScreen({ game, onBack }) {
  const [tab, setTab] = React.useState(() => sessionStorage.getItem('piq_tab') || 'overview');
  const [gameData, setGameData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [stepIdx, setStepIdx] = React.useState(0);
  const tabs = game.sportKey === 'mlb' ? TABS_MLB
    : game.sportKey === 'nba' ? TABS_NBA
    : game.sportKey === 'wnba' ? TABS_WNBA
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
        const [awayForm, homeForm] = await Promise.all([
          enrichFormWithPlayerStats(game.sportKey, game.awayTeamId, awayFormRaw),
          enrichFormWithPlayerStats(game.sportKey, game.homeTeamId, homeFormRaw),
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

  const TeamMark = ({ logo, abbr }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--s2)', minWidth: 0 }}>
      <img src={logo} alt="" loading="lazy" style={{ width: 34, height: 34, objectFit: 'contain', flexShrink: 0 }}
        onError={e => { e.target.style.visibility = 'hidden'; }} />
      <span className="piq-num" style={{ fontSize: 'clamp(18px, 2.6vw, 28px)', color: 'var(--text)', letterSpacing: '0.03em' }}>{abbr}</span>
    </span>
  );

  return (
    <div style={{ maxWidth: 'var(--maxw)', margin: '0 auto', padding: '0 var(--s5) var(--s7)' }}>
      {/* ── Game header ──────────────────────────────────── */}
      <header style={{ padding: 'var(--s5) 0 var(--s4)' }}>
        <button onClick={onBack} className="piq-btn piq-btn-ghost" style={{ marginBottom: 'var(--s4)' }}>← GAMES</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s5)', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', flexWrap: 'wrap', marginBottom: 'var(--s2)' }}>
              <TeamMark logo={game.awayLogo} abbr={game.awayAbbr} />
              <span className="piq-label" style={{ fontSize: 'var(--fs-xs)' }}>AT</span>
              <TeamMark logo={game.homeLogo} abbr={game.homeAbbr} />
              <StatusBadge status={statusLabel} />
            </div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', fontFamily: 'Space Mono, monospace', lineHeight: 1.6 }}>
              {game.awayFull} · {game.homeFull}{game.venue ? ` · ${game.venue}` : ''}
            </div>
          </div>
          <OddsStrip game={game} />
        </div>
      </header>

      {loading ? (
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
            {tab === 'overview' && <OverviewTab gameData={gameData} />}
            {tab === 'h2h' && <H2HTab gameData={gameData} />}
            {tab === 'form' && <FormTab gameData={gameData} />}
            {tab === 'roster' && <RosterTab gameData={gameData} />}
            {tab === 'lineup' && <MlbLineupFieldTab gameData={gameData} />}
            {tab === 'lineups' && (game.sportKey === 'wnba'
              ? <WnbaCourtLineupTab gameData={gameData} />
              : <NbaLineupTab gameData={gameData} />)}
            {tab === 'def-vs-pos' && <NbaDefenseVsPositionTab gameData={gameData} />}
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
