/* ============================================================
   PLAYIQ — NBA TABS
   NBA-only game-detail tabs and chart helpers
   ============================================================ */

const NBA_STATS = [
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
];

const nbaStatColorFor = (v, sk) => {
  if (sk === 'pts') return v >= 30 ? 'var(--green)' : v >= 20 ? 'var(--gold)' : v >= 10 ? 'var(--cyan)' : 'var(--orange)';
  if (sk === 'reb') return v >= 12 ? 'var(--green)' : v >= 8 ? 'var(--gold)' : v >= 4 ? 'var(--cyan)' : 'var(--dim)';
  if (sk === 'ast') return v >= 10 ? 'var(--green)' : v >= 6 ? 'var(--gold)' : v >= 3 ? 'var(--cyan)' : 'var(--dim)';
  return 'var(--muted)';
};

function NbaEdgeFinderTab({ gameData }) {
  const { gameInfo, nbaEdgeData } = gameData;
  const [filter, setFilter] = React.useState('all');

  if (!nbaEdgeData) return <div style={emptyMsg}>NBA edge data loading or unavailable.</div>;
  const { players } = nbaEdgeData;
  if (!players?.length) return <div style={emptyMsg}>No players found.</div>;

  const displayed = filter === 'all' ? players : players.filter(p => p.side === filter);

  const NbaPlayerCard = ({ p }) => {
    const [open, setOpen] = React.useState(false);
    const hasH2H = (p.h2h || []).length > 0;
    const hasL5 = (p.l5 || []).length > 0;

    return (
      <HudCard style={{ padding: '18px 20px' }} accent={p.teamColor}>
        <div onClick={() => setOpen(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', cursor: 'pointer', userSelect: 'none' }}>
          <PlayerCard player={{ name: p.name, headshot: p.headshot, pos: p.pos }} size="md" accent={p.teamColor} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>{p.name}</span>
              <span style={{ fontSize: 9, padding: '2px 7px', border: `1px solid ${p.teamColor}66`, color: p.teamColor, fontFamily: 'Space Mono, monospace', borderRadius: 2, letterSpacing: '0.08em' }}>{p.teamAbbr}</span>
              <span style={{ fontSize: 9, padding: '2px 7px', border: `1px solid ${p.teamColor}44`, color: p.teamColor, fontFamily: 'Space Mono, monospace', borderRadius: 2 }}>{p.pos}</span>
              {p.jersey && p.jersey !== '—' && <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace' }}>#{p.jersey}</span>}
              <HotBadge tier={p.hotTier} />
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.05em' }}>
              vs {p.oppAbbr} · L5 {p.avgPts.toFixed(1)}/{p.avgReb.toFixed(1)}/{p.avgAst.toFixed(1)} · {(p.h2h || []).length}G vs {p.oppAbbr}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            {[['PTS', p.avgPts], ['REB', p.avgReb], ['AST', p.avgAst]].map(([l, v]) => (
              <div key={l} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 8, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.16em', marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 18, fontFamily: 'Orbitron, monospace', fontWeight: 700, color: p.teamColor }}>{v.toFixed(1)}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 10, borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.15em' }}>
              {open ? 'HIDE' : 'EXPAND'}
            </span>
            <span style={{ fontSize: 14, color: p.teamColor, fontFamily: 'Orbitron, monospace', transition: 'transform 0.2s',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
          </div>
        </div>

        {open && (
          <div style={{ marginTop: 18, animation: 'fadeUp 0.25s ease' }}>
            <div style={{ paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: p.teamColor, letterSpacing: '0.22em' }}>
                  HEAD-TO-HEAD vs {p.oppAbbr}
                </span>
                <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace' }}>
                  {hasH2H ? `${p.h2h.length}G · last: ${p.h2h[0].date}` : 'NO GAMES'}
                </span>
              </div>
              {hasH2H ? (
                <GameLogChart games={p.h2h} stats={NBA_STATS} defaultStat="pts" emptyLabel={`NO GAMES VS ${p.oppAbbr} THIS SEASON`} accent={p.teamColor} colorFor={nbaStatColorFor} />
              ) : (
                <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', padding: '16px 0', letterSpacing: '0.1em' }}>
                  NO GAMES VS {p.oppAbbr} THIS SEASON
                </div>
              )}
            </div>

            <div style={{ paddingTop: 18, marginTop: 18, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: p.teamColor, letterSpacing: '0.22em', marginBottom: 10 }}>
                LAST 5 GAMES (SEASON)
              </div>
              {hasL5 ? (
                <GameLogChart games={p.l5} stats={NBA_STATS} defaultStat="pts" emptyLabel="NO RECENT GAMES" accent={p.teamColor} colorFor={nbaStatColorFor} />
              ) : (
                <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', padding: '16px 0', letterSpacing: '0.1em' }}>
                  NO RECENT GAMES
                </div>
              )}
            </div>
          </div>
        )}
      </HudCard>
    );
  };

  return (
    <div style={{ padding: '20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <SectionHeader label="NBA EDGE FINDER" sub="H2H vs opposing team · Last 5 season games · PTS / REB / AST" />
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {[['all', 'BOTH'], ['away', gameInfo.awayAbbr], ['home', gameInfo.homeAbbr]].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)}
              style={{ padding: '4px 12px', background: filter === v ? 'rgba(0,212,255,0.1)' : 'transparent',
                border: `1px solid ${filter === v ? 'rgba(0,212,255,0.3)' : 'rgba(255,255,255,0.06)'}`,
                color: filter === v ? 'var(--cyan)' : 'var(--dim)', fontFamily: 'Space Mono, monospace',
                fontSize: 10, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.08em' }}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {displayed.map((p, i) => <NbaPlayerCard key={p.id || i} p={p} />)}
      </div>
    </div>
  );
}

Object.assign(window, { NbaEdgeFinderTab });
