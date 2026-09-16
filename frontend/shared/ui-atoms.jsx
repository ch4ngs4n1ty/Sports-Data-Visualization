/* ============================================================
   PLAYIQ — SHARED UI ATOMS
   Shared primitive components reused across all sports.

   Every public signature here is consumed by ~2,600 lines of
   sport-specific tabs, so props are additive only — nothing
   existing was renamed or removed.
   ============================================================ */

/* ── Corner-bracket HUD card ─────────────────────────────
   Now draws a hairline border + elevation underneath the
   brackets. Previously the card had no border at all, so
   panels read as floating text rather than contained surfaces. */
function HudCard({ children, style = {}, accent = 'var(--cyan)', onClick, active = false, className = '', interactive }) {
  const [hov, setHov] = React.useState(false);
  const on = hov || active;
  const clickable = !!onClick;
  const lift = interactive ?? clickable;
  const bw = 1.5, bs = 11, r = 8;

  const keyActivate = e => {
    if (!clickable) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); }
  };

  return (
    <div onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onFocus={() => setHov(true)} onBlur={() => setHov(false)}
      onKeyDown={keyActivate}
      className={className}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      style={{
        position: 'relative',
        background: on ? 'var(--card-hi)' : 'var(--card)',
        border: `1px solid ${on ? accent + '55' : 'var(--line)'}`,
        borderRadius: r,
        cursor: clickable ? 'pointer' : 'default',
        boxShadow: on
          ? `var(--sh-2), 0 0 26px ${accent}1f, inset 0 1px 0 rgba(255,255,255,0.04)`
          : 'var(--sh-1), inset 0 1px 0 rgba(255,255,255,0.025)',
        transform: on && lift ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'background var(--dur-2) ease, border-color var(--dur-2) ease, box-shadow var(--dur-2) ease, transform var(--dur-2) var(--ease)',
        ...style,
      }}>
      {[['top','left'],['top','right'],['bottom','left'],['bottom','right']].map(([v,h]) => (
        <div key={v+h} style={{
          position: 'absolute', [v]: -1, [h]: -1, width: bs, height: bs, pointerEvents: 'none',
          borderTop:    v==='top'    ? `${bw}px solid ${on ? accent : accent+'55'}` : 'none',
          borderBottom: v==='bottom' ? `${bw}px solid ${on ? accent : accent+'55'}` : 'none',
          borderLeft:   h==='left'   ? `${bw}px solid ${on ? accent : accent+'55'}` : 'none',
          borderRight:  h==='right'  ? `${bw}px solid ${on ? accent : accent+'55'}` : 'none',
          [`border${v==='top'?'Top':'Bottom'}${h==='left'?'Left':'Right'}Radius`]: r,
          transition: 'border-color var(--dur-2) ease',
        }} />
      ))}
      {children}
    </div>
  );
}

/* ── Generic pill / chip ─────────────────────────────────── */
function Chip({ children, color = 'var(--dim)', tint, strong = false, title, style = {} }) {
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 'var(--fs-micro)', fontFamily: 'Space Mono, monospace',
      fontWeight: 700, letterSpacing: '0.12em', color,
      padding: '3px 9px', borderRadius: 99,
      background: tint || (strong ? color + '1c' : 'transparent'),
      border: `1px solid ${strong ? color + '66' : 'var(--line)'}`,
      whiteSpace: 'nowrap', ...style,
    }}>{children}</span>
  );
}

/* ── Status badge ─────────────────────────────────────── */
function StatusBadge({ status }) {
  const cfg = {
    'Scheduled':   { color: 'var(--dim)',   label: 'SCHEDULED', pulse: false },
    'In Progress': { color: 'var(--green)', label: 'LIVE',      pulse: true  },
    'Final':       { color: 'var(--muted)', label: 'FINAL',     pulse: false },
    'Postponed':   { color: 'var(--orange)',label: 'POSTPONED', pulse: false },
  };
  const { color, label, pulse } = cfg[status] || cfg.Scheduled;
  return (
    <Chip color={color} strong={pulse}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color,
        boxShadow: `0 0 7px ${color}`, flexShrink: 0,
        animation: pulse ? 'livePulse 1.4s ease-in-out infinite' : 'none' }} />
      {label}
    </Chip>
  );
}

/* ── Loader ───────────────────────────────────────────── */
function Loader({ text = 'LOADING' }) {
  return (
    <div role="status" aria-live="polite"
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--s4)', padding: 'var(--s7) var(--s5)' }}>
      <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r="17" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
        <circle cx="22" cy="22" r="17" fill="none" stroke="var(--cyan)" strokeWidth="2.5"
          strokeDasharray="42 65" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 6px var(--cyan))' }}>
          <animateTransform attributeName="transform" type="rotate" from="0 22 22" to="360 22 22" dur="0.9s" repeatCount="indefinite" />
        </circle>
        <circle cx="22" cy="22" r="9" fill="none" stroke="var(--cyan)" strokeWidth="1.5" strokeDasharray="14 30" strokeLinecap="round" opacity="0.55">
          <animateTransform attributeName="transform" type="rotate" from="360 22 22" to="0 22 22" dur="1.4s" repeatCount="indefinite" />
        </circle>
      </svg>
      <span style={{ fontFamily: 'Space Mono, monospace', fontSize: 'var(--fs-xs)', color: 'var(--dim)', letterSpacing: '0.2em' }}>{text}</span>
    </div>
  );
}

/* ── Stat tile (label + value) ───────────────────────────── */
function StatTile({ label, value, color = 'var(--text)', sub, align = 'left' }) {
  return (
    <div style={{ padding: '11px 13px', background: 'var(--surface)', border: '1px solid var(--line)',
      borderRadius: 'var(--r-sm)', textAlign: align, minWidth: 0 }}>
      <div className="piq-label" style={{ marginBottom: 4 }}>{label}</div>
      <div className="piq-num" style={{ fontSize: 'var(--fs-lg)', color, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--dim)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/* ── Empty state ─────────────────────────────────────────── */
function EmptyState({ title = 'NO DATA', hint }) {
  return (
    <div style={{ padding: 'var(--s7) var(--s5)', textAlign: 'center', border: '1px dashed var(--line-strong)',
      borderRadius: 'var(--r-md)', background: 'var(--surface)' }}>
      <div style={{ fontSize: 26, opacity: 0.35, marginBottom: 'var(--s2)' }} aria-hidden="true">◍</div>
      <div className="piq-label" style={{ color: 'var(--muted)', fontSize: 'var(--fs-xs)' }}>{title}</div>
      {hint && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--dim)', marginTop: 6, lineHeight: 1.6 }}>{hint}</div>}
    </div>
  );
}

/* ── Stat bar ─────────────────────────────────────────── */
function StatBar({ label, value, max = 1, color = 'var(--cyan)', decimals = 3 }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div style={{ marginBottom: 'var(--s3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <span className="piq-label">{label}</span>
        <span className="piq-num" style={{ fontSize: 'var(--fs-sm)', color }}>{value != null ? value.toFixed(decimals) : '—'}</span>
      </div>
      <div style={{ height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}88`,
          borderRadius: 99, transition: 'width var(--dur-1) var(--ease)' }} />
      </div>
    </div>
  );
}

/* ── Sparkline ────────────────────────────────────────── */
function Sparkline({ data, width = 200, height = 48, color = 'var(--cyan)', valueKey = 'avg' }) {
  // Unique gradient id — the old `sg_${color}` produced invalid/duplicate ids
  // (colors are strings like "var(--cyan)"), so gradients bled between charts.
  const uid = React.useId().replace(/:/g, '');
  if (!data || data.length < 2) return (
    <svg width={width} height={height} role="img" aria-label="No data">
      <text x={width/2} y={height/2+4} textAnchor="middle" fill="var(--dim)" fontSize="11" fontFamily="Space Mono, monospace">NO DATA</text>
    </svg>
  );
  const vals = data.map(d => d[valueKey] ?? d);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const range = maxV - minV || 0.001;
  const p = 4;
  const pts = vals.map((v, i) => [p + (i/(vals.length-1))*(width-p*2), p + (1-(v-minV)/range)*(height-p*2)]);
  const d = pts.map((pt, i) => `${i===0?'M':'L'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ');
  const area = d + ` L${pts[pts.length-1][0]},${height} L${pts[0][0]},${height} Z`;
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }} role="img" aria-label="Trend sparkline">
      <defs>
        <linearGradient id={`sg_${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg_${uid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((pt, i) => <circle key={i} cx={pt[0]} cy={pt[1]} r={2.5} fill={color} stroke="var(--bg)" strokeWidth="1.5" />)}
    </svg>
  );
}

/* ── OPS Gauge (circular) ─────────────────────────────── */
function OpsGauge({ ops, size = 80 }) {
  const max = 1.4, r = size*0.42, cx = size/2, cy = size/2, sw = size*0.075;
  const pct = Math.min(ops / max, 1);
  const circ = 2 * Math.PI * r;
  const color = ops >= 0.900 ? 'var(--green)' : ops >= 0.750 ? 'var(--gold)' : ops >= 0.600 ? 'var(--cyan)' : 'var(--orange)';
  return (
    <svg width={size} height={size} role="img" aria-label={`OPS ${ops > 0 ? ops.toFixed(3) : 'unavailable'}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={`${circ*pct} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: 'stroke-dasharray var(--dur-1) var(--ease)' }} />
      <text x={cx} y={cy-2} textAnchor="middle" fill={color} fontSize={size*0.185} fontFamily="Orbitron, monospace" fontWeight="700">{ops>0?ops.toFixed(3):'—'}</text>
      <text x={cx} y={cy+size*0.155} textAnchor="middle" fill="var(--dim)" fontSize={size*0.115} fontFamily="Space Mono, monospace" letterSpacing="2">OPS</text>
    </svg>
  );
}

/* ── Player card ─────────────────────────────────────── */
function PlayerCard({ player, size = 'md', accent, showStats = false }) {
  const [imgErr, setImgErr] = React.useState(false);
  const s = size === 'sm' ? 44 : size === 'lg' ? 76 : 56;
  const ac = accent || 'var(--cyan)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, textAlign: 'center', minWidth: 0 }}>
      <div style={{ width: s, height: s, borderRadius: '50%', overflow: 'hidden', border: `2px solid ${ac}55`,
        boxShadow: `0 0 14px ${ac}26, var(--sh-1)`, background: 'var(--surface)', flexShrink: 0 }}>
        {player?.headshot && !imgErr
          ? <img src={player.headshot} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setImgErr(true)} />
          : <div aria-hidden="true" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: s * 0.36, fontFamily: 'Orbitron, monospace', color: ac, fontWeight: 700 }}>
              {(player?.name || '?').charAt(0)}
            </div>
        }
      </div>
      <div style={{ minWidth: 0, maxWidth: '100%' }}>
        <div style={{ fontSize: size === 'sm' ? 'var(--fs-micro)' : 'var(--fs-xs)', fontFamily: 'Space Mono, monospace',
          color: 'var(--text)', fontWeight: 700, lineHeight: 1.3, overflowWrap: 'break-word' }}>
          {player?.name || '—'}
        </div>
        {player?.pos && <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--dim)', fontFamily: 'Space Mono, monospace', marginTop: 3 }}>{player.pos}{player?.jersey ? ` · #${player.jersey}` : ''}</div>}
      </div>
      {showStats && player?.value != null && (
        <div className="piq-num" style={{ fontSize: 'var(--fs-lg)', color: ac }}>{player.value}</div>
      )}
    </div>
  );
}

/* ── SVG Bar Chart (Edge Finder) ──────────────────────── */
function SvgBarChart({ items, height = 140, barW = 28, gap = 10, showLabel = true, valuePad = 18 }) {
  if (!items?.length) return null;
  const totalW = items.length * (barW + gap) - gap;
  const labelH = showLabel ? 30 : 0;
  const totalH = valuePad + height + labelH;
  return (
    <svg width={totalW} height={totalH} style={{ overflow: 'visible' }}>
      {items.map((item, i) => {
        const x = i * (barW + gap);
        const pct = Math.min((item.value || 0) / (item.max || 1), 1);
        const barH = pct * height;
        const barTop = valuePad + (height - barH);
        const color = item.color || 'var(--cyan)';
        const labelY = Math.max(valuePad - 5, barTop - 5);
        return (
          <g key={i}>
            <rect x={x} y={valuePad} width={barW} height={height} fill="rgba(255,255,255,0.04)" rx={4} />
            <rect x={x} y={barTop} width={barW} height={barH} fill={color} rx={4}
              style={{ filter: `drop-shadow(0 0 5px ${color}88)` }} />
            <text x={x + barW/2} y={labelY} textAnchor="middle" fill={color}
              fontSize="11" fontFamily="Orbitron, monospace" fontWeight="700">
              {item.valueLabel || ''}
            </text>
            {showLabel && (
              <text x={x + barW/2} y={valuePad + height + 17} textAnchor="middle" fill="var(--dim)"
                fontSize="10" fontFamily="Space Mono, monospace" letterSpacing="0.5">
                {item.label}
              </text>
            )}
            {showLabel && item.sublabel && (
              <text x={x + barW/2} y={valuePad + height + 28} textAnchor="middle" fill="var(--faint)"
                fontSize="9" fontFamily="Space Mono, monospace">
                {item.sublabel}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ── Dual bar (BvP vs Season comparison) ─────────────── */
function DualStatBar({ label, bvpVal, seasonVal, fmt, higher = true }) {
  if (bvpVal == null && seasonVal == null) return null;
  const max = Math.max(bvpVal || 0, seasonVal || 0, 0.001) * 1.3;
  const bvpPct = Math.min((bvpVal || 0) / max * 100, 100);
  const seaPct = Math.min((seasonVal || 0) / max * 100, 100);
  const edge = (bvpVal != null && seasonVal != null) ? bvpVal - seasonVal : null;
  const isGood = higher ? edge > 0 : edge < 0;
  const edgeColor = edge == null ? 'var(--dim)' : Math.abs(edge) < 0.01 ? 'var(--dim)' : isGood ? 'var(--green)' : 'var(--orange)';

  const Row = ({ tag, val, pct, color, weight }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
      <span style={{ fontSize: 'var(--fs-micro)', color, fontFamily: 'Space Mono, monospace', width: 30, flexShrink: 0, letterSpacing: '0.08em' }}>{tag}</span>
      <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99,
          transition: 'width var(--dur-1) var(--ease)' }} />
      </div>
      <span className="piq-num" style={{ fontSize: 'var(--fs-xs)', color, fontWeight: weight, width: 44, textAlign: 'right' }}>{val != null ? fmt(val) : '—'}</span>
    </div>
  );

  return (
    <div style={{ marginBottom: 'var(--s3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span className="piq-label">{label}</span>
        {edge != null && <span className="piq-num" style={{ fontSize: 'var(--fs-xs)', color: edgeColor }}>
          {edge > 0 ? '+' : ''}{fmt(edge)}
        </span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Row tag="BvP" val={bvpVal} pct={bvpPct} color="var(--cyan)" weight={700} />
        <Row tag="SEA" val={seasonVal} pct={seaPct} color="var(--muted)" weight={400} />
      </div>
    </div>
  );
}

/* ── Weather pill (compact) ───────────────────────────── */
function WeatherPill({ weather }) {
  if (!weather) return null;
  const wind = parseInt(weather.wind, 10) || 0;
  const wColor = wind >= 10 ? 'var(--orange)' : wind >= 6 ? 'var(--gold)' : 'var(--green)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', padding: '7px 13px',
      background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 99 }}>
      <span className="piq-num" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>{weather.temp}°F</span>
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>{weather.condition}</span>
      <span style={{ fontSize: 'var(--fs-xs)', color: wColor, fontFamily: 'Space Mono, monospace', fontWeight: 700 }}>{weather.wind}</span>
      {weather.roofType && weather.roofType !== 'Open' && (
        <Chip color={weather.roofType === 'Indoor' ? 'var(--orange)' : 'var(--gold)'} strong>{weather.roofType.toUpperCase()}</Chip>
      )}
    </div>
  );
}

/* ── Section header ───────────────────────────────────── */
function SectionHeader({ label, sub, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
      <span aria-hidden="true" style={{ width: 3, alignSelf: 'stretch', minHeight: 30, borderRadius: 99,
        background: 'linear-gradient(180deg, var(--cyan), transparent)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ fontSize: 'var(--fs-xs)', fontFamily: 'Space Mono, monospace', fontWeight: 700,
          color: 'var(--cyan)', letterSpacing: '0.22em', margin: 0 }}>{label}</h2>
        {sub && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', fontFamily: 'Space Mono, monospace', marginTop: 4, lineHeight: 1.5 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

/* ── Odds strip ──────────────────────────────────────── */
function OddsStrip({ game }) {
  const pills = [];
  if (game.spread) pills.push(['SPREAD', game.spread]);
  if (game.overUnder) pills.push(['O/U', game.overUnder]);
  if (game.awayMoneyline) pills.push([`${game.awayAbbr} ML`, game.awayMoneyline > 0 ? `+${game.awayMoneyline}` : game.awayMoneyline]);
  if (game.homeMoneyline) pills.push([`${game.homeAbbr} ML`, game.homeMoneyline > 0 ? `+${game.homeMoneyline}` : game.homeMoneyline]);
  if (!pills.length) return null;
  return (
    <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
      {pills.map(([l, v]) => (
        <div key={l} style={{ padding: '6px 12px', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)',
          background: 'var(--surface)', textAlign: 'center' }}>
          <div className="piq-label" style={{ fontSize: 'var(--fs-micro)', marginBottom: 2 }}>{l}</div>
          <div className="piq-num" style={{ fontSize: 'var(--fs-sm)', color: 'var(--cyan)' }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Form dots (W/L pills) ───────────────────────────── */
function FormDots({ form }) {
  return (
    <div style={{ display: 'flex', gap: 5 }} role="list" aria-label="Recent form">
      {form.map((g, i) => {
        const win = g.result === 'W';
        const c = win ? 'var(--green)' : 'var(--orange)';
        return (
          <div key={i} role="listitem" style={{
            width: 24, height: 24, borderRadius: 'var(--r-xs)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: win ? 'rgba(0,255,136,0.13)' : 'rgba(255,107,53,0.13)',
            border: `1px solid ${win ? 'rgba(0,255,136,0.38)' : 'rgba(255,107,53,0.38)'}`,
            fontSize: 'var(--fs-xs)', fontFamily: 'Space Mono, monospace', color: c, fontWeight: 700,
          }} title={`${g.result} ${g.myScore}-${g.oppScore} vs ${g.opponent}`}>
            {g.result}
          </div>
        );
      })}
    </div>
  );
}

/* ── Game log chart (L5 season + BvP per-game) ────────── */
const defaultStatColorFor = (v, sk) => {
  if (sk === 'k')   return v === 0 ? 'var(--green)' : v === 1 ? 'var(--cyan)' : v >= 3 ? 'var(--orange)' : 'var(--gold)';
  if (sk === 'hr')  return v >= 1 ? 'var(--green)' : 'var(--faint)';
  if (sk === 'bb')  return v >= 2 ? 'var(--green)' : v === 1 ? 'var(--gold)' : 'var(--faint)';
  return v === 0 ? 'var(--orange)' : v === 1 ? 'var(--cyan)' : 'var(--green)';
};

function GameLogChart({ games, stats, defaultStat, emptyLabel = 'NO GAMES', accent = 'var(--cyan)', chartHeight = 130, maxBarW = 64, colorFor = defaultStatColorFor }) {
  const [statKey, setStatKey] = React.useState(defaultStat || stats[0].key);
  if (!games?.length) {
    return <EmptyState title={emptyLabel} />;
  }

  const vals = games.map(g => Number(g[statKey] || 0));
  const maxVal = Math.max(...vals, 1);
  const barColor = v => colorFor(v, statKey);
  const total = vals.reduce((a, b) => a + b, 0);
  const high = Math.max(...vals);
  const low = Math.min(...vals);
  const avg = total / vals.length;
  const hasWeather = games.some(g => g.weather);

  const Cell = ({ children }) => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, minWidth: 0 }}>
      {children}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--s2)', marginBottom: 'var(--s4)', flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="piq-label" style={{ marginRight: 2 }}>STAT</span>
        <div className="piq-seg" role="group" aria-label="Select stat">
          {stats.map(s => (
            <button key={s.key} onClick={() => setStatKey(s.key)} aria-pressed={statKey === s.key}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--s4)', alignItems: 'flex-end', padding: '0 var(--s1)' }}>
        {games.map((g, i) => {
          const v = Number(g[statKey] || 0);
          const pct = Math.min(v / maxVal, 1) * 100;
          const color = barColor(v);
          return (
            <Cell key={i}>
              <div className="piq-num" style={{ fontSize: 'var(--fs-sm)', color, height: 16, lineHeight: 1 }}>{v}</div>
              <div style={{ width: '100%', maxWidth: maxBarW, height: chartHeight,
                background: 'rgba(255,255,255,0.035)', borderRadius: 'var(--r-sm)', position: 'relative', overflow: 'hidden',
                border: '1px solid var(--line)' }}>
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${pct}%`, background: color,
                  boxShadow: `0 0 10px ${color}88, inset 0 0 8px ${color}22`, borderRadius: 'var(--r-xs)',
                  transition: 'height var(--dur-1) var(--ease)' }} />
              </div>
            </Cell>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 'var(--s4)', marginTop: 'var(--s2)', padding: '0 var(--s1)' }}>
        {games.map((g, i) => (
          <Cell key={i}>
            {/* Opponent as a logo when the game carries one, text abbr otherwise
                (MLB logs don't set `oppLogo`, so they keep the old label).
                Away games are dimmed slightly — that's the only remaining
                home/away cue once the "vs"/"@" prefix is gone, so the title
                attribute spells it out for anyone who needs it. */}
            {g.oppLogo ? (
              <div title={`${g.home ? 'vs' : '@'} ${g.opp || ''}`.trim()}
                style={{ height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src={g.oppLogo} alt={`${g.home ? 'vs' : '@'} ${g.opp || ''}`.trim()}
                  style={{ height: 22, width: 22, objectFit: 'contain', opacity: g.home ? 1 : 0.72,
                    filter: g.home ? 'none' : 'saturate(0.85)' }}
                  onError={e => { e.target.style.display = 'none'; }} />
              </div>
            ) : (
              <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 'var(--fs-xs)', color: 'var(--muted)', textAlign: 'center', height: 22, lineHeight: '22px' }}>
                {g.home ? 'vs' : '@'}{g.opp || '?'}
              </div>
            )}
            <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 'var(--fs-micro)', color: 'var(--dim)', textAlign: 'center', marginTop: -2 }}>
              {g.date}
            </div>
          </Cell>
        ))}
      </div>

      {hasWeather && (
        <div style={{ display: 'flex', gap: 'var(--s4)', marginTop: 'var(--s3)', padding: '0 var(--s1)' }}>
          {games.map((g, i) => (
            <Cell key={i}>
              <div style={{ width: '100%', maxWidth: maxBarW, padding: '7px 4px', textAlign: 'center',
                background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-xs)',
                fontFamily: 'Space Mono, monospace' }}>
                {g.weather ? (
                  <>
                    <div className="piq-num" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text)' }}>{g.weather.temp != null ? `${g.weather.temp}°` : '—'}</div>
                    <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--dim)', marginTop: 2 }}>{g.weather.wind || '—'}</div>
                  </>
                ) : <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--dim)' }}>—</div>}
              </div>
            </Cell>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))', gap: 'var(--s2)',
        marginTop: 'var(--s4)', paddingTop: 'var(--s4)', borderTop: '1px solid var(--line)' }}>
        {[['AVG', avg.toFixed(1), accent], ['TOTAL', total, accent], ['HIGH', high, 'var(--green)'], ['LOW', low, 'var(--orange)']].map(([l, v, c]) => (
          <StatTile key={l} label={l} value={v} color={c} />
        ))}
      </div>
    </div>
  );
}

/* ── Tab-level loader (Phase 2 lazy data) ─────────────── */
function TabLoader({ source, label, rows = 4 }) {
  const SRC_LABELS = {
    rotowire: 'ROTOWIRE', savant: 'BASEBALL SAVANT', espn: 'ESPN',
    stats: 'MLB STATS API', backend: 'ANALYTICS ENGINE', nba: 'NBA DATA',
  };
  const src = SRC_LABELS[(source || '').toLowerCase()] || (source || 'DATA SOURCE').toUpperCase();
  return (
    <div style={{ padding: 'var(--s6) 0', animation: 'fadeUp var(--dur-3) var(--ease)' }} role="status" aria-live="polite">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)', marginBottom: 'var(--s5)' }}>
        <svg width="28" height="28" viewBox="0 0 40 40" style={{ flexShrink: 0 }} aria-hidden="true">
          <circle cx="20" cy="20" r="15" fill="none" stroke="var(--line-strong)" strokeWidth="2.5" />
          <circle cx="20" cy="20" r="15" fill="none" stroke="var(--cyan)" strokeWidth="2.5"
            strokeDasharray="38 56" strokeLinecap="round">
            <animateTransform attributeName="transform" type="rotate" from="0 20 20" to="360 20 20" dur="0.85s" repeatCount="indefinite" />
          </circle>
        </svg>
        <div>
          <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 'var(--fs-xs)', color: 'var(--cyan)', letterSpacing: '0.2em', marginBottom: 4, fontWeight: 700 }}>
            FETCHING FROM {src}
          </div>
          {label && (
            <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 'var(--fs-xs)', color: 'var(--dim)', letterSpacing: '0.08em' }}>{label}</div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{ height: 58, background: 'var(--card)', border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)', position: 'relative', overflow: 'hidden',
            animation: `skeletonPulse 1.6s ease-in-out ${i * 0.12}s infinite` }}>
            <div style={{ position: 'absolute', top: 0, left: '-100%', width: '55%', height: '100%',
              background: 'linear-gradient(90deg, transparent, rgba(0,212,255,0.06), transparent)',
              animation: `shimmer 1.9s ease-in-out ${i * 0.18}s infinite` }} />
            <div style={{ position: 'absolute', top: 18, left: 20, height: 9, width: `${30 + (i % 3) * 15}%`,
              background: 'rgba(255,255,255,0.05)', borderRadius: 99 }} />
            <div style={{ position: 'absolute', top: 34, left: 20, height: 7, width: `${20 + (i % 2) * 10}%`,
              background: 'rgba(255,255,255,0.03)', borderRadius: 99 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, {
  HudCard, StatusBadge, Loader, StatBar, Sparkline, OpsGauge,
  PlayerCard, SvgBarChart, DualStatBar, WeatherPill, SectionHeader,
  OddsStrip, FormDots, GameLogChart, TabLoader,
  // new atoms
  Chip, StatTile, EmptyState,
});
