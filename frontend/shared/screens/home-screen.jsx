/* ============================================================
   PLAYIQ — HOME SCREEN
   Sport selection
   ============================================================ */

function HomeScreen({ onSelectSport }) {
  // Wake up the Render backend in the background while the user picks a sport.
  // No-op locally; ~1 ping while sleeping is enough to start the cold start.
  React.useEffect(() => { prewarmBackend(); }, []);

  // Per-sport accent so the grid is scannable by colour, not just by text.
  const sports = [
    { key: 'mlb',    label: 'MLB',   full: 'Major League Baseball',                     active: true,  season: 'Spring 2026',   accent: 'var(--cyan)',   depth: '9 analysis tabs' },
    { key: 'nba',    label: 'NBA',   full: 'National Basketball Association',           active: true,  season: 'Season 2025-26', accent: 'var(--orange)', depth: '7 analysis tabs' },
    { key: 'wnba',   label: 'WNBA',  full: "Women's National Basketball Association",   active: true,  season: 'Season 2026',    accent: 'var(--violet)', depth: '6 analysis tabs' },
    { key: 'nhl',    label: 'NHL',   full: 'National Hockey League',                    active: true,  season: 'Season 2025-26', accent: 'var(--gold)',   depth: '5 analysis tabs' },
    { key: 'ncaamb', label: 'NCAAB', full: 'College Basketball',                        active: false, season: 'Off-season',     accent: 'var(--dim)',    depth: '—' },
  ];

  const capabilities = [
    'Statcast BvP', 'ESPN live data', 'Lineup intelligence', 'Weather signal', 'F5 ML model', 'AI plays',
  ];

  return (
    <div style={homeS.wrap}>
      {/* ── Hero ─────────────────────────────────────────── */}
      <header style={homeS.hero}>
        <Chip color="var(--cyan)" strong style={{ marginBottom: 'var(--s4)' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)',
            boxShadow: '0 0 7px var(--green)', animation: 'livePulse 2.2s ease-in-out infinite' }} />
          DEEP GAME ANALYSIS
        </Chip>

        <h1 style={homeS.title}>PLAYIQ</h1>
        <p style={homeS.sub}>
          Pick a sport, browse today's slate, then drill into any game for
          matchup-level edges across pitching, lineups, projections and AI plays.
        </p>

        <div style={homeS.caps}>
          {capabilities.map(c => <Chip key={c} color="var(--muted)">{c}</Chip>)}
        </div>
      </header>

      {/* ── Sport grid ───────────────────────────────────── */}
      <h2 className="piq-label" style={{ marginBottom: 'var(--s3)' }}>Select sport</h2>
      <div style={homeS.grid}>
        {sports.map(sp => (
          <HudCard key={sp.key}
            onClick={sp.active ? () => onSelectSport(sp.key) : undefined}
            accent={sp.accent}
            style={{
              padding: 'var(--s5)', minHeight: 190,
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
              opacity: sp.active ? 1 : 0.45,
              cursor: sp.active ? 'pointer' : 'not-allowed',
            }}>
            <div>
              <Chip color={sp.active ? sp.accent : 'var(--dim)'} strong={sp.active}>
                {sp.active ? '● LIVE DATA' : '○ COMING SOON'}
              </Chip>

              <div className="piq-num" style={{
                fontSize: sp.key === 'mlb' ? 'clamp(38px, 6vw, 54px)' : 'clamp(30px, 5vw, 42px)',
                fontWeight: 900, color: sp.active ? 'var(--text)' : 'var(--dim)',
                lineHeight: 1, letterSpacing: '0.04em', margin: 'var(--s3) 0 var(--s2)',
                textShadow: sp.active ? `0 0 32px ${sp.accent}33` : 'none',
              }}>{sp.label}</div>

              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', fontFamily: 'Space Mono, monospace', lineHeight: 1.5 }}>
                {sp.full}
              </div>
            </div>

            {sp.active && (
              <div style={homeS.cardFoot}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--fs-xs)', color: sp.accent, fontFamily: 'Space Mono, monospace', fontWeight: 700 }}>{sp.season}</div>
                  <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--dim)', fontFamily: 'Space Mono, monospace', marginTop: 3 }}>{sp.depth}</div>
                </div>
                <span aria-hidden="true" style={{ ...homeS.arrow, color: sp.accent, borderColor: `color-mix(in srgb, ${sp.accent} 40%, transparent)` }}>→</span>
              </div>
            )}
          </HudCard>
        ))}
      </div>

      {/* ── Footer ───────────────────────────────────────── */}
      <footer style={homeS.footer}>
        <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
          {['ESPN LIVE', 'BASEBALL SAVANT', 'MLB STATS API', 'CLAUDE AI'].map(s => (
            <Chip key={s} color="var(--dim)">{s}</Chip>
          ))}
        </div>
        <Chip color="var(--green)" strong>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)',
            boxShadow: '0 0 7px var(--green)', animation: 'livePulse 2.2s ease-in-out infinite' }} />
          SYSTEM ONLINE
        </Chip>
      </footer>
    </div>
  );
}

const homeS = {
  wrap: { maxWidth: 'var(--maxw)', margin: '0 auto', padding: 'var(--s7) var(--s5) var(--s6)' },

  hero: { marginBottom: 'var(--s7)', maxWidth: 720 },

  title: {
    fontFamily: 'Orbitron, monospace', fontSize: 'clamp(44px, 8vw, 88px)', fontWeight: 900,
    lineHeight: 1, margin: '0 0 var(--s4)', letterSpacing: '0.06em',
    background: 'linear-gradient(180deg, var(--text) 0%, var(--muted) 100%)',
    WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
    filter: 'drop-shadow(0 0 44px rgba(0,212,255,0.28))',
  },

  sub: {
    fontSize: 'var(--fs-md)', color: 'var(--muted)', fontFamily: 'Space Mono, monospace',
    lineHeight: 1.7, maxWidth: 620, margin: 0,
  },

  caps: { display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', marginTop: 'var(--s5)' },

  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
    gap: 'var(--s3)', marginBottom: 'var(--s7)',
  },

  cardFoot: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--s3)',
    marginTop: 'var(--s4)', paddingTop: 'var(--s4)', borderTop: '1px solid var(--line)',
  },

  arrow: {
    display: 'grid', placeItems: 'center', width: 30, height: 30, flexShrink: 0,
    border: '1px solid', borderRadius: '50%', fontSize: 'var(--fs-sm)',
  },

  footer: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--s4)',
    flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 'var(--s4)',
  },
};

Object.assign(window, { HomeScreen });
