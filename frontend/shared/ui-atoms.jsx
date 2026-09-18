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
function HudCard({ children, style = {}, accent = 'var(--cyan)', onClick, active = false, className = '', interactive, glow = true }) {
  const [hov, setHov] = React.useState(false);
  const ref = React.useRef(null);
  const on = hov || active;
  const clickable = !!onClick;
  const lift = interactive ?? clickable;
  const bw = 1.5, bs = 11, r = 8;

  const keyActivate = e => {
    if (!clickable) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); }
  };

  /* Pointer-tracked spotlight. We write CSS custom properties on the node
     instead of setState so moving the mouse never triggers a React render —
     this stays smooth even on the 30+ card slate grid. */
  const onMove = e => {
    const el = ref.current; if (!el) return;
    const b = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${((e.clientX - b.left) / b.width) * 100}%`);
    el.style.setProperty('--my', `${((e.clientY - b.top) / b.height) * 100}%`);
  };

  // `accent` may be a raw hex (#00ff88) or a CSS var reference. Hex supports
  // the +alpha suffix trick; a var() must go through color-mix instead.
  const isVar = typeof accent === 'string' && accent.includes('var(');
  const at = (hex, pct) => isVar ? `color-mix(in srgb, ${accent} ${pct}%, transparent)` : accent + hex;

  return (
    <div ref={ref}
      onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onMouseMove={glow ? onMove : undefined}
      onFocus={() => setHov(true)} onBlur={() => setHov(false)}
      onKeyDown={keyActivate}
      className={className}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      style={{
        position: 'relative', isolation: 'isolate',
        // A top-lit gradient rather than a flat fill, so the surface has a
        // light direction and stops reading as a plain colored rectangle.
        background: on
          ? `linear-gradient(180deg, var(--card-hi), var(--card))`
          : `linear-gradient(180deg, var(--card), var(--surface))`,
        border: `1px solid ${on ? at('66', 42) : 'var(--line)'}`,
        borderRadius: r,
        cursor: clickable ? 'pointer' : 'default',
        boxShadow: on
          ? `var(--sh-3), 0 0 32px ${at('26', 16)}, inset 0 1px 0 rgba(255,255,255,0.06)`
          : 'var(--sh-1), inset 0 1px 0 rgba(255,255,255,0.03)',
        transform: on && lift ? 'translateY(-3px) scale(1.006)' : 'translateY(0) scale(1)',
        transition: 'background var(--dur-2) ease, border-color var(--dur-2) ease, box-shadow var(--dur-2) ease, transform var(--dur-3) var(--ease-spring)',
        ...style,
      }}>

      {/* Cursor spotlight — a soft accent bloom that follows the pointer.
          Only painted while hovered, and never intercepts clicks. */}
      {glow && (
        <div aria-hidden="true" style={{
          position: 'absolute', inset: 0, borderRadius: r, pointerEvents: 'none', zIndex: 0,
          background: `radial-gradient(260px circle at var(--mx, 50%) var(--my, 0%), ${at('1f', 13)}, transparent 72%)`,
          opacity: on ? 1 : 0, transition: 'opacity var(--dur-3) ease',
        }} />
      )}

      {/* Corner brackets */}
      {[['top','left'],['top','right'],['bottom','left'],['bottom','right']].map(([v,h]) => (
        <div key={v+h} aria-hidden="true" style={{
          position: 'absolute', [v]: -1, [h]: -1, width: on ? bs + 4 : bs, height: on ? bs + 4 : bs,
          pointerEvents: 'none', zIndex: 2,
          borderTop:    v==='top'    ? `${bw}px solid ${on ? accent : at('55', 34)}` : 'none',
          borderBottom: v==='bottom' ? `${bw}px solid ${on ? accent : at('55', 34)}` : 'none',
          borderLeft:   h==='left'   ? `${bw}px solid ${on ? accent : at('55', 34)}` : 'none',
          borderRight:  h==='right'  ? `${bw}px solid ${on ? accent : at('55', 34)}` : 'none',
          [`border${v==='top'?'Top':'Bottom'}${h==='left'?'Left':'Right'}Radius`]: r,
          filter: on ? `drop-shadow(0 0 6px ${at('88', 55)})` : 'none',
          transition: 'border-color var(--dur-2) ease, width var(--dur-3) var(--ease-spring), height var(--dur-3) var(--ease-spring), filter var(--dur-2) ease',
        }} />
      ))}

      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
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

/* ── Count-up animation ──────────────────────────────────
   Animates a number from 0 to its value on mount (and on change). Keeps the
   original string's decimal places and any suffix (%, °, +) so callers can
   keep passing pre-formatted values. Returns the value unchanged when it is
   not numeric, or when the user prefers reduced motion. */
function useCountUp(value, ms = 620) {
  const raw = String(value ?? '');
  const m = /^(-?)(\d+(?:\.\d+)?)(.*)$/.exec(raw);
  const target = m ? parseFloat(m[2]) : null;
  const decimals = m && m[2].includes('.') ? m[2].split('.')[1].length : 0;
  const [n, setN] = React.useState(target);

  React.useEffect(() => {
    if (target == null) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setN(target); return; }
    let raf, start;
    const step = t => {
      if (start == null) start = t;
      const p = Math.min((t - start) / ms, 1);
      // easeOutExpo — fast arrival, gentle settle
      const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      setN(target * e);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  if (target == null || n == null) return raw;
  return `${m[1]}${n.toFixed(decimals)}${m[3]}`;
}

/* ── Stat tile (label + value) ───────────────────────────── */
function StatTile({ label, value, color = 'var(--text)', sub, align = 'left', countUp = true }) {
  const shown = useCountUp(countUp ? value : null);
  const display = countUp ? shown : value;
  return (
    <div style={{ position: 'relative', overflow: 'hidden',
      padding: '11px 13px',
      background: 'linear-gradient(180deg, var(--card), var(--surface))',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-sm)', textAlign: align, minWidth: 0 }}>
      {/* Accent edge — ties the tile to the active theme */}
      <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2,
        background: `linear-gradient(180deg, ${color}, transparent)`, opacity: 0.8 }} />
      <div className="piq-label" style={{ marginBottom: 4 }}>{label}</div>
      <div className="piq-num tabular" style={{ fontSize: 'var(--fs-lg)', color, lineHeight: 1.1,
        textShadow: `0 0 20px ${color === 'var(--text)' ? 'transparent' : 'currentColor'}` }}>{display}</div>
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
      <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden',
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)' }}>
        {/* Flat fill, not a `${color}aa` gradient: callers pass var(--cyan)
            and friends, and "var(--cyan)aa" is invalid — it voids the whole
            background and the bar renders empty. */}
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99,
          background: color,
          transformOrigin: 'left',
          animation: 'growRight 560ms var(--ease-out) backwards',
          transition: 'width var(--dur-1) var(--ease)' }} />
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
  // Rough path length, used to animate the stroke drawing itself on mount.
  const len = pts.reduce((a, p, i) => i ? a + Math.hypot(p[0]-pts[i-1][0], p[1]-pts[i-1][1]) : 0, 0);
  const last = pts[pts.length - 1];

  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }} role="img" aria-label="Trend sparkline">
      <defs>
        <linearGradient id={`sg_${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.34" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <style>{`
          @keyframes dash_${uid} { to { stroke-dashoffset: 0; } }
          @keyframes fadein_${uid} { to { opacity: 1; } }
        `}</style>
      </defs>
      <path d={area} fill={`url(#sg_${uid})`} opacity="0"
        style={{ animation: `fadein_${uid} 420ms var(--ease-out) 380ms forwards` }} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray={len} strokeDashoffset={len}
        style={{ filter: `drop-shadow(0 0 5px ${color})`,
                 animation: `dash_${uid} 720ms var(--ease-out) forwards` }} />
      {pts.map((pt, i) => (
        <circle key={i} cx={pt[0]} cy={pt[1]} r={i === pts.length - 1 ? 3.2 : 2.3}
          fill={i === pts.length - 1 ? color : 'var(--bg)'} stroke={color} strokeWidth="1.6" opacity="0"
          style={{ animation: `fadein_${uid} 260ms var(--ease-out) ${340 + i * 40}ms forwards` }} />
      ))}
      {/* The most recent point pulses — it's the one that matters */}
      {last && (
        <circle cx={last[0]} cy={last[1]} r="3.2" fill="none" stroke={color} strokeWidth="1.4" opacity="0.7"
          style={{ animation: 'livePulse 2.4s ease-in-out 900ms infinite', transformOrigin: `${last[0]}px ${last[1]}px` }} />
      )}
    </svg>
  );
}

/* ── OPS Gauge (circular) ─────────────────────────────── */
function OpsGauge({ ops, size = 80 }) {
  const uid = React.useId().replace(/:/g, '');
  const max = 1.4, r = size*0.42, cx = size/2, cy = size/2, sw = size*0.075;
  const pct = Math.min(ops / max, 1);
  const circ = 2 * Math.PI * r;
  const color = ops >= 0.900 ? 'var(--green)' : ops >= 0.750 ? 'var(--gold)' : ops >= 0.600 ? 'var(--cyan)' : 'var(--orange)';
  // The arc sweeps from empty to its value on mount, and the readout counts
  // up alongside it, so the gauge reads as taking a measurement.
  const shown = useCountUp(ops > 0 ? ops.toFixed(3) : null, 720);
  return (
    <svg width={size} height={size} role="img" aria-label={`OPS ${ops > 0 ? ops.toFixed(3) : 'unavailable'}`}>
      <defs><style>{`@keyframes sweep_${uid} { from { stroke-dashoffset: ${circ}; } to { stroke-dashoffset: 0; } }`}</style></defs>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={sw} />
      {/* Faint full ring in the accent, so the dial has a track to travel */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw} opacity="0.1" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={`${circ*pct} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ filter: `drop-shadow(0 0 7px ${color})`,
                 animation: `sweep_${uid} 780ms var(--ease-out) backwards`,
                 transition: 'stroke-dasharray var(--dur-1) var(--ease)' }} />
      <text x={cx} y={cy-2} textAnchor="middle" fill={color} fontSize={size*0.185}
        fontFamily="Orbitron, monospace" fontWeight="700"
        style={{ fontVariantNumeric: 'tabular-nums' }}>{ops>0?shown:'—'}</text>
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
            <rect x={x} y={valuePad} width={barW} height={height} fill="rgba(255,255,255,0.045)" rx={4} />
            {/* Grows from its baseline, staggered across the series */}
            <rect x={x} y={barTop} width={barW} height={barH} fill={color} rx={4}
              style={{ filter: `drop-shadow(0 0 6px ${color}99)`,
                       transformOrigin: `${x + barW / 2}px ${valuePad + height}px`,
                       animation: `growUp 500ms var(--ease-out) ${i * 50}ms backwards` }} />
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
        background: 'linear-gradient(180deg, var(--accent), var(--accent-2), transparent)', flexShrink: 0,
        boxShadow: '0 0 12px var(--accent-glow)',
        transformOrigin: 'top', animation: 'growUp 420ms var(--ease-out) backwards' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ fontSize: 'var(--fs-xs)', fontFamily: 'Space Mono, monospace', fontWeight: 700,
          color: 'var(--accent)', letterSpacing: '0.22em', margin: 0,
          textShadow: '0 0 16px var(--accent-glow)' }}>{label}</h2>
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
    <div className="stagger" style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
      {pills.map(([l, v]) => (
        <div key={l} style={{ padding: '6px 12px', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)',
          background: 'linear-gradient(180deg, var(--card), var(--surface))', textAlign: 'center',
          boxShadow: 'var(--sh-1)' }}>
          <div className="piq-label" style={{ fontSize: 'var(--fs-micro)', marginBottom: 2 }}>{l}</div>
          <div className="piq-num tabular" style={{ fontSize: 'var(--fs-sm)', color: 'var(--accent)',
            textShadow: '0 0 14px var(--accent-glow)' }}>{v}</div>
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
              <div className="piq-num tabular" style={{ fontSize: 'var(--fs-sm)', color, height: 16, lineHeight: 1,
                textShadow: `0 0 14px ${color}` }}>{v}</div>
              <div style={{ width: '100%', maxWidth: maxBarW, height: chartHeight,
                background: 'rgba(255,255,255,0.035)', borderRadius: 'var(--r-sm)', position: 'relative', overflow: 'hidden',
                border: '1px solid var(--line)' }}>
                {/* Bars grow from the baseline, staggered left→right, so the
                    chart draws itself instead of appearing fully formed.
                    `color` is usually a var() (callers pass var(--green) etc.),
                    so the fill must be a FLAT color — a `${color}bb` gradient
                    stop produces "var(--green)bb", which is invalid and voids
                    the whole background, leaving a bar with no fill at all. */}
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
                  // A zero value still needs to be visible as a zero, not vanish.
                  height: v === 0 ? 3 : `${pct}%`,
                  minHeight: 3,
                  background: color,
                  opacity: v === 0 ? 0.55 : 1,
                  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.3)`,
                  borderRadius: 'var(--r-xs)',
                  transformOrigin: 'bottom',
                  animation: `growUp 460ms var(--ease-out) ${i * 55}ms backwards`,
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
  // hooks
  useCountUp,
});
