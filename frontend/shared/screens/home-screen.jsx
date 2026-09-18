/* ============================================================
   PLAYIQ — HOME SCREEN
   Sport selection
   ============================================================ */

function HomeScreen({ onSelectSport }) {
  // Wake up the Render backend in the background while the user picks a sport.
  // No-op locally; ~1 ping while sleeping is enough to start the cold start.
  React.useEffect(() => { prewarmBackend(); }, []);

  /* Hovering a sport card previews that sport's theme across the whole page —
     the aurora, grid and chrome shift to its hue before you even click. The
     home screen normally runs unthemed, so this is also how the user learns
     each league has its own identity. Cleared on unmount so navigating away
     never leaves a stray preview applied. */
  const previewSport = key => {
    const el = document.documentElement;
    if (key) el.setAttribute('data-sport', key);
    else el.removeAttribute('data-sport');
  };
  React.useEffect(() => () => previewSport(null), []);

  // Per-sport accent so the grid is scannable by colour, not just by text.
  const sports = [
    { key: 'mlb',    label: 'MLB',   full: 'Major League Baseball',                     active: true,  season: 'Spring 2026',   accent: 'var(--cyan)',   depth: '9 analysis tabs' },
    { key: 'nba',    label: 'NBA',   full: 'National Basketball Association',           active: true,  season: 'Season 2025-26', accent: 'var(--orange)', depth: '7 analysis tabs' },
    { key: 'wnba',   label: 'WNBA',  full: "Women's National Basketball Association",   active: true,  season: 'Season 2026',    accent: 'var(--violet)', depth: '6 analysis tabs' },
    { key: 'nfl',    label: 'NFL',   full: 'National Football League',                  active: true,  season: 'Season 2026',    accent: 'var(--green)',  depth: '6 analysis tabs' },
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
      <div className="stagger piq-sport-grid" style={homeS.grid}>
        {/* Each card is wrapped so the hover handlers can preview the sport's
            theme. The wrapper is what the grid stretches, so it passes its
            full height down to the card — otherwise tiles with shorter
            footers (NFL) render visibly stubbier than their row neighbours. */}
        {sports.map(sp => (
          <div key={sp.key} style={{ display: 'flex', minWidth: 0 }}
            onMouseEnter={() => sp.active && previewSport(sp.key)}
            onMouseLeave={() => previewSport(null)}>
          <HudCard
            onClick={sp.active ? () => onSelectSport(sp.key) : undefined}
            accent={sp.accent}
            style={{
              padding: 'var(--s5)', minHeight: 200, width: '100%',
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
          </div>
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

  /* The wordmark is the single largest element on the page, so it carries the
     theme: a light-raked gradient that sweeps the accent through the letters,
     with the glow tied to the active hue rather than a fixed cyan. */
  title: {
    fontFamily: 'Orbitron, monospace', fontSize: 'clamp(46px, 8.5vw, 96px)', fontWeight: 900,
    lineHeight: 1, margin: '0 0 var(--s4)', letterSpacing: '0.06em',
    background: 'linear-gradient(112deg, var(--text) 0%, var(--text) 26%, var(--accent) 48%, var(--accent-2) 60%, var(--muted) 82%)',
    backgroundSize: '220% 100%',
    WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
    filter: 'drop-shadow(0 0 48px var(--accent-glow))',
    animation: 'borderRun 9s linear infinite, riseIn 620ms var(--ease-out)',
  },

  sub: {
    fontSize: 'var(--fs-md)', color: 'var(--muted)', fontFamily: 'Space Mono, monospace',
    lineHeight: 1.7, maxWidth: 620, margin: 0,
  },

  caps: { display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', marginTop: 'var(--s5)' },

  /* 3 columns → the six sports land as a clean 3×2 block. `auto-fit` used to
     fit 4 across on a wide viewport and orphan 2 on the second row.
     `alignItems: stretch` (grid's default, stated here deliberately) plus the
     cards' own flex column keeps every tile the same height despite the
     footers having different amounts of text. */
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', alignItems: 'stretch',
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
