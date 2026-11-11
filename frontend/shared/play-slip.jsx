/* ============================================================
   PLAYIQ — PLAY SLIP (app-shell UI, all sports)
   ------------------------------------------------------------
   The slip is a GENERAL slot, not part of any game card:
     <PlaySlipNavButton onOpen currentGame />   — top nav, every screen
     <PlaySlipDrawer open onClose currentGame /> — slide-out panel (App shell)
     <PlaySlipSource sportKey eventId suggestions note />
        — rendered by a game's LIVE tab; draws NOTHING, only hands the model's
          suggestions to the drawer (PlaySlipData.publishSuggestions).
   One slip across every game and sport (PlaySlipData store). Data + rules
   live in frontend/data/shared/play-slip.js — read its header before
   changing what is selectable or linked.

   Suggestion shape (source-neutral):
     { kind: 'moneyline'|'spread'|'total'|'milestone', side: 'home'|'away'|'over'|'under',
       line?, period? ('full' | '1st Half' …), athleteId?, stat?, threshold?,
       why, detail?: { modelProb?, fairOdds?, edgePts?, caveats?: [], notes?: [] }, source? }
   A suggestion is addable only when DraftKings posts that exact outcome.

   UX contract (from the request that created this — keep it):
   • Slip order is insertion order and never re-sorts. New suggestions wait in
     their own tray; nothing is added or replaced without a click.
   • `original` is frozen at add time. The working value changes only through
     "Use new price". The ORIGINAL SLIP view always shows what was first added.
   • Indicators are factual (timestamps, "not in latest feed"), never urgency.
   ============================================================ */
const _PS_POLL_MS = 30000;

function _psCopy(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => _psCopyFallback(text));
  return Promise.resolve(_psCopyFallback(text));
}
function _psCopyFallback(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

const _psBtn = {
  fontFamily: 'Space Mono, monospace', fontSize: 'var(--fs-micro)', letterSpacing: '0.06em',
  padding: '7px 11px', borderRadius: 'var(--r-md, 8px)', cursor: 'pointer',
  background: 'var(--surface)', border: '1px solid var(--line-strong)', color: 'var(--text)',
  minHeight: 34, lineHeight: 1.2,
};
const _psMuted = { fontSize: 'var(--fs-micro)', color: 'var(--muted)', fontFamily: 'Space Mono, monospace', lineHeight: 1.6 };

function _PsCopyButton({ text, label, primary }) {
  const [state, setState] = React.useState('idle');
  React.useEffect(() => { if (state === 'idle') return; const t = setTimeout(() => setState('idle'), 1600); return () => clearTimeout(t); }, [state]);
  return <button type="button" style={{ ..._psBtn, ...(primary ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : null) }}
    onClick={() => _psCopy(text).then(ok => setState(ok ? 'ok' : 'fail'))}>
    {state === 'ok' ? '✓ COPIED' : state === 'fail' ? 'COPY FAILED' : label}
  </button>;
}

function _psPeriodChip(w) {
  const full = w.periodKey === 'full';
  return <Chip color={full ? 'var(--muted)' : 'var(--gold)'} strong={!full}>
    {full ? 'FULL GAME' : `${w.period.toUpperCase()} ONLY`}
  </Chip>;
}
function _psSideChip(w) {
  const color = w.kind === 'total' ? (w.side === 'over' ? 'var(--green)' : 'var(--orange)')
    : w.kind === 'spread' ? (w.line > 0 ? 'var(--green)' : w.line < 0 ? 'var(--orange)' : 'var(--text)')
    : 'var(--accent)';
  return <Chip color={color} strong style={{ fontSize: 'var(--fs-xs, 12px)' }}>{w.sideBadge}</Chip>;
}

const _PS_FLAG_COLOR = { ODDS: 'var(--gold)', LINE: 'var(--orange)', NOT_LISTED: 'var(--orange)', FINAL: 'var(--muted)', STALE: 'var(--gold)', UNCHECKED: 'var(--muted)' };
const _PS_FLAG_LABEL = { ODDS: 'ODDS CHANGED', LINE: 'LINE CHANGED', NOT_LISTED: 'NOT IN LATEST FEED', FINAL: 'GAME FINAL', STALE: 'POSSIBLY STALE', UNCHECKED: 'NOT CHECKED' };

function _PsRow({ label, children }) {
  return <div style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.55, color: 'var(--text)' }}>
    <span style={{ color: 'var(--muted)', fontWeight: 700 }}>{label}: </span>{children}
  </div>;
}

function _PsCard({ sel, index, snap, now, reviewHit, onPatch, onAccept, onRemove }) {
  const D = window.PlaySlipData;
  const [open, setOpen] = React.useState(false);
  const w = sel.working;
  const { current, flags } = D.compare(sel, snap, now);
  const changed = flags.some(f => f.type === 'ODDS' || f.type === 'LINE' || f.type === 'NOT_LISTED');
  const ctx = current && snap ? D.gameContext(snap, current) : w.context;
  const m = sel.matchup;
  /* A selection link only while the outcome is still in the feed; otherwise the game page. */
  const link = current ? current.link?.url || null : snap ? null : w.link?.url || null;
  const eventLink = snap?.eventLink || w.eventLink || null;
  const accent = changed ? 'var(--orange)' : sel.found || sel.addedManually ? 'var(--green)' : 'var(--accent)';

  let updated;
  if (!snap) updated = `added ${D.fmtClock(sel.addedAt)} · not checked since`;
  else if (current) updated = `price unchanged for ${D.fmtAge((now - current.observedAt) / 1000)}+ · checked ${D.fmtAge((now - snap.fetchedAt) / 1000)} ago`;
  else updated = `checked ${D.fmtAge((now - snap.fetchedAt) / 1000)} ago`;

  const toggle = (field, label) => <button type="button" aria-pressed={!!sel[field]} onClick={() => onPatch({ [field]: !sel[field] })}
    style={{ ..._psBtn, ...(sel[field] ? { borderColor: 'var(--green)', color: 'var(--green)', background: 'color-mix(in srgb, var(--green) 10%, transparent)' } : null) }}>
    {sel[field] ? '✓ ' : ''}{label}
  </button>;

  return <HudCard accent={accent} glow={false} style={{ padding: 'var(--s4)', outline: reviewHit ? '2px solid var(--orange)' : 'none', outlineOffset: 2 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
      <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 'var(--fs-micro)', color: 'var(--muted)', letterSpacing: '0.12em' }}>
        {index + 1} · {m.sport} · {m.away} @ {m.home}
      </span>
      <span style={{ flex: 1 }} />
      {sel.found && <Chip color="var(--green)" strong>FOUND</Chip>}
      {sel.addedManually && <Chip color="var(--green)" strong>ADDED MANUALLY</Chip>}
    </div>

    <div style={{ fontFamily: 'Orbitron, monospace', fontWeight: 800, fontSize: 'var(--fs-lg, 18px)', color: 'var(--text)', letterSpacing: '0.02em', lineHeight: 1.3, overflowWrap: 'anywhere' }}>
      {w.headline}
    </div>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 10px' }}>
      {_psSideChip(w)}{_psPeriodChip(w)}
    </div>

    <div style={{ display: 'grid', gap: 3 }}>
      <_PsRow label="DraftKings market">{w.sourceMarket}{w.periodKey === 'full' && w.kind !== 'milestone' ? ' (full game)' : ''} <span style={{ color: 'var(--muted)' }}>· look in {w.lookIn}</span></_PsRow>
      <_PsRow label="Odds">
        <strong style={{ fontFamily: 'Orbitron, monospace', color: flags.some(f => f.type === 'ODDS') ? 'var(--gold)' : 'var(--text)' }}>{D.fmtOdds(w.odds)}</strong>
        {ctx?.current && <> · <span style={{ color: 'var(--muted)', fontWeight: 700 }}>Current:</span> {ctx.current.value} {ctx.current.unit}</>}
        {ctx?.detail && <> · {ctx.detail}</>}
        {ctx?.score && <span style={{ color: 'var(--muted)' }}> · {ctx.score}</span>}
      </_PsRow>
      <_PsRow label="Updated"><span style={{ color: 'var(--muted)' }}>{updated}</span></_PsRow>
      <_PsRow label="Why selected">{sel.why || <span style={{ color: 'var(--muted)' }}>{sel.source}. No model note.</span>}</_PsRow>
    </div>

    {flags.length > 0 && <div role="status" style={{ display: 'grid', gap: 4, marginTop: 10, padding: '8px 10px', borderRadius: 'var(--r-md, 8px)',
      border: `1px solid ${changed ? 'var(--orange)' : 'var(--line)'}`, background: changed ? 'color-mix(in srgb, var(--orange) 8%, transparent)' : 'transparent' }}>
      {flags.map((f, i) => <div key={i} style={{ fontSize: 'var(--fs-micro)', lineHeight: 1.5, fontFamily: 'Space Mono, monospace' }}>
        <strong style={{ color: _PS_FLAG_COLOR[f.type] }}>{_PS_FLAG_LABEL[f.type]}</strong> <span style={{ color: 'var(--text)' }}>{f.text}</span>
      </div>)}
      {changed && current && <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>
        Now posted: <strong style={{ color: 'var(--text)' }}>{current.selectionText} {D.fmtOdds(current.odds)}</strong>. Your card still shows what you added until you choose otherwise.
      </div>}
    </div>}

    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
      <_PsCopyButton text={D.copyLine(sel)} label="COPY PLAY" primary />
      {link ? <a href={link} target="_blank" rel="noopener noreferrer" style={{ ..._psBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>OPEN SELECTION ON DK ↗</a>
        : eventLink ? <a href={eventLink} target="_blank" rel="noopener noreferrer" style={{ ..._psBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>OPEN GAME ON DK ↗</a> : null}
      {toggle('found', 'FOUND')}
      {toggle('addedManually', 'ADDED MANUALLY')}
      {changed && current && <button type="button" style={{ ..._psBtn, borderColor: 'var(--gold)', color: 'var(--gold)' }} onClick={onAccept}>USE NEW PRICE</button>}
      <button type="button" aria-expanded={open} style={_psBtn} onClick={() => setOpen(o => !o)}>{open ? 'HIDE DETAILS ▴' : 'DETAILS ▾'}</button>
      <button type="button" aria-label={`Remove ${w.headline}`} style={{ ..._psBtn, color: 'var(--muted)' }} onClick={onRemove}>REMOVE</button>
    </div>

    {open && <div style={{ ..._psMuted, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)', display: 'grid', gap: 4 }}>
      {sel.detail?.modelProb != null && <div>Model chance: <span style={{ color: 'var(--text)' }}>{(sel.detail.modelProb * 100).toFixed(1)}%</span>
        {sel.detail.fairOdds != null && <> · fair price {D.fmtOdds(Math.round(sel.detail.fairOdds))}</>}
        {sel.detail.edgePts != null && <> · edge vs de-vigged market {sel.detail.edgePts > 0 ? '+' : ''}{Number(sel.detail.edgePts).toFixed(1)} pts</>}</div>}
      {(sel.detail?.notes || []).map((n, i) => <div key={`n${i}`}>{n}</div>)}
      {(sel.detail?.caveats || []).map((c, i) => <div key={`c${i}`}>• {c}</div>)}
      <div>Source: {w.provider || 'DraftKings'} via ESPN · selection wording “{w.sourceSelection}” · market “{w.sourceMarket}”</div>
      <div>Added {D.fmtClock(sel.addedAt)} at {D.fmtOdds(sel.original.odds)}{sel.original.line != null ? ` (line ${sel.original.kind === 'spread' ? D.fmtLine(sel.original.line) : sel.original.line})` : ''}{sel.original.context?.detail ? ` · ${sel.original.context.detail}` : ''}
        {sel.acceptedAt ? ` · updated to the posted price at ${D.fmtClock(sel.acceptedAt)}` : ''}</div>
      <div>{link ? 'Selection link comes from ESPN’s DraftKings feed; its outcome id was checked against this line.'
        : (current || w).linkNote || (eventLink ? 'DraftKings does not publish a per-selection link for this market in the feed; the game page link is from ESPN’s feed.' : 'No DraftKings link is published for this game in the feed.')}</div>
      <div style={{ color: 'var(--dim)' }}>id {sel.id} · event {sel.eventId}</div>
    </div>}
  </HudCard>;
}

function _PsPicker({ snap, slipIds, onAdd }) {
  const D = window.PlaySlipData;
  const [q, setQ] = React.useState('');
  const all = React.useMemo(() => Object.values(snap?.outcomes || {}), [snap]);
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = !terms.length ? all.filter(o => o.periodKey === 'full' && o.kind !== 'milestone')
    : all.filter(o => { const hay = `${o.headline} ${o.sourceMarket} ${o.period}`.toLowerCase(); return terms.every(t => hay.includes(t)); });
  const skipped = Object.values(snap?.skipped || {}).reduce((a, b) => a + b, 0);
  return <div style={{ marginTop: 'var(--s3)' }}>
    <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search a player, team or market (e.g. “25+ points”)"
      aria-label="Search posted DraftKings lines"
      style={{ ..._psBtn, width: '100%', boxSizing: 'border-box', cursor: 'text', fontSize: 'var(--fs-sm)', padding: '10px 12px' }} />
    <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
      {hits.slice(0, 10).map(o => {
        const inSlip = slipIds.has(o.key);
        return <div key={o.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', borderTop: '1px solid var(--line)' }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', overflowWrap: 'anywhere' }}>
            {o.headline} <span style={{ color: 'var(--muted)', fontSize: 'var(--fs-micro)' }}>· {o.periodKey === 'full' ? 'full game' : o.period}</span>
          </div>
          <strong style={{ fontFamily: 'Orbitron, monospace', fontSize: 'var(--fs-sm)' }}>{D.fmtOdds(o.odds)}</strong>
          <button type="button" disabled={inSlip} style={{ ..._psBtn, opacity: inSlip ? .5 : 1 }} onClick={() => onAdd(o, null)}>{inSlip ? 'IN SLIP' : '+ ADD'}</button>
        </div>;
      })}
      {terms.length > 0 && !hits.length && <div style={_psMuted}>No selectable DraftKings outcome matches.</div>}
      {hits.length > 10 && <div style={_psMuted}>{hits.length - 10} more — narrow the search.</div>}
    </div>
    {skipped > 0 && <div style={{ ..._psMuted, marginTop: 6 }}>
      {skipped} posted outcomes (player over/unders, team totals, period spreads/totals) are hidden: the feed lists them without saying which is Over/Under or which side is +/−, and a guessed side could send you to the wrong selection.
    </div>}
  </div>;
}


/* ── store hooks ──────────────────────────────────────────────────────── */
function usePlaySlipStore() {
  const D = window.PlaySlipData;
  const [slip, setSlip] = React.useState(() => D.getSlip());
  React.useEffect(() => D.subscribeSlip(setSlip), []);
  return slip;
}
function usePlaySlipSuggestions(game) {
  const D = window.PlaySlipData;
  const k = game ? D.eventKey(game.sportKey, game.eventId) : null;
  const [entry, setEntry] = React.useState(() => game ? D.getSuggestions(game.sportKey, game.eventId) : null);
  React.useEffect(() => {
    const read = () => setEntry(game ? D.getSuggestions(game.sportKey, game.eventId) : null);
    read();
    return D.subscribeSuggestions(read);
  }, [k]);
  return entry;
}
const _psSupported = g => !!(g && g.eventId && window.PlaySlipData?.SPORT_PATH[g.sportKey]);

/* Game tabs render this instead of a slip. It draws nothing. */
function PlaySlipSource({ sportKey, eventId, suggestions = [], note = '' }) {
  const D = window.PlaySlipData;
  React.useEffect(() => { D.publishSuggestions(sportKey, eventId, suggestions, note); });
  React.useEffect(() => () => D.clearSuggestions(sportKey, eventId), [sportKey, eventId]);
  return null;
}

/* ── nav button ──────────────────────────────────────────────────────── */
function PlaySlipNavButton({ onOpen, currentGame }) {
  const D = window.PlaySlipData;
  const slip = usePlaySlipStore();
  const entry = usePlaySlipSuggestions(_psSupported(currentGame) ? currentGame : null);
  const inSlip = new Set(slip.items.map(D.itemKey));
  const pending = entry ? entry.suggestions.filter(s => {
    const k = D.outcomeKeyFor(s, null);
    return !k || !inSlip.has(`${entry.sportKey}:${entry.eventId}:${k}`);
  }).length : 0;
  const n = slip.items.length;
  return <button type="button" className="slip-nav-btn" onClick={onOpen} aria-haspopup="dialog"
    aria-label={`Open simulated slip, ${n} pick${n === 1 ? '' : 's'}${pending ? `, ${pending} suggested for this game` : ''}`}>
    <span>SLIP</span>
    <b className={n ? 'on' : ''}>{n}</b>
    {pending > 0 && <i title={`${pending} suggested for this game`}>+{pending}</i>}
  </button>;
}

/* ── "add from this game" (inside the drawer) ─────────────────────────── */
function _PsAddFromGame({ game, snap, slip, onAdd }) {
  const D = window.PlaySlipData;
  const entry = usePlaySlipSuggestions(game);
  const order = React.useRef(new Map());
  const [showSearch, setShowSearch] = React.useState(false);
  const ids = new Set(slip.items.filter(s => s.sportKey === game.sportKey && String(s.eventId) === String(game.eventId)).map(s => s.id));
  const suggestions = entry?.suggestions || [];
  const tray = React.useMemo(() => {
    const rows = suggestions.map(sg => {
      const key = D.outcomeKeyFor(sg, snap) || JSON.stringify([sg.kind, sg.side, sg.line, sg.period, sg.athleteId, sg.threshold]);
      if (!order.current.has(key)) order.current.set(key, order.current.size);
      return { key, sg, ...(snap ? D.matchSuggestion(sg, snap) : { outcome: null, reason: 'Checking DraftKings…' }) };
    });
    return rows.sort((a, b) => order.current.get(a.key) - order.current.get(b.key));
  }, [suggestions, snap]);
  const fresh = tray.filter(r => !ids.has(r.outcome?.key || r.key));
  const label = `${game.awayAbbr || game.away?.abbr || snap?.game?.away?.abbr || 'AWAY'} @ ${game.homeAbbr || game.home?.abbr || snap?.game?.home?.abbr || 'HOME'}`;
  return <section aria-label="Add selections from this game" style={{ padding: 'var(--s3)', border: '1px solid var(--line)', borderRadius: 'var(--r-md, 8px)', marginBottom: 'var(--s3)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
      <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 'var(--fs-micro)', letterSpacing: '0.14em', color: 'var(--accent)', flex: 1 }}>
        ADD FROM {(D.SPORT_LABEL[game.sportKey] || '').toUpperCase()} · {snap?.game ? `${snap.game.away?.abbr} @ ${snap.game.home?.abbr}` : label}
      </span>
      <button type="button" aria-expanded={showSearch} style={_psBtn} onClick={() => setShowSearch(v => !v)}>{showSearch ? 'CLOSE SEARCH' : 'SEARCH POSTED LINES'}</button>
    </div>
    <div style={_psMuted}>
      {snap ? `${snap.provider ? `${snap.provider} via ESPN` : 'DraftKings via ESPN'} · checked ${D.fmtClock(snap.fetchedAt)}${snap.game?.state === 'pre' ? ' · pregame prices' : ''}` : 'Checking DraftKings…'}
      {(snap?.errors || []).map((e, i) => <div key={i} style={{ color: 'var(--orange)' }}>{e}</div>)}
    </div>
    <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 'var(--fs-micro)', letterSpacing: '0.12em', color: 'var(--muted)', margin: '10px 0 4px' }}>
      SUGGESTED PLAYS {!tray.length ? '· NONE RIGHT NOW' : fresh.length ? `· ${fresh.length} NOT IN SLIP` : '· ALL IN SLIP'}
    </div>
    <div style={_psMuted}>{entry?.note || 'Model suggestions appear here while this game’s ◉ LIVE tab is open.'}</div>
    <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
      {fresh.map(r => <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', borderTop: '1px solid var(--line)', opacity: r.outcome ? 1 : .6 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', overflowWrap: 'anywhere' }}>
          {r.outcome ? r.outcome.headline : r.sg.label || `${r.sg.kind} ${r.sg.side || ''} ${r.sg.line ?? ''}`}
          {r.outcome && <span style={{ color: 'var(--muted)', fontSize: 'var(--fs-micro)' }}> · {r.outcome.periodKey === 'full' ? 'full game' : r.outcome.period}</span>}
          {!r.outcome && <div style={_psMuted}>{r.reason}</div>}
        </div>
        {r.outcome && <strong style={{ fontFamily: 'Orbitron, monospace', fontSize: 'var(--fs-sm)' }}>{D.fmtOdds(r.outcome.odds)}</strong>}
        <button type="button" disabled={!r.outcome} style={{ ..._psBtn, opacity: r.outcome ? 1 : .45 }} onClick={() => onAdd(r.outcome, r.sg, snap)}>+ ADD</button>
      </div>)}
    </div>
    {showSearch && <_PsPicker snap={snap} slipIds={ids} onAdd={(o, sg) => onAdd(o, sg, snap)} />}
  </section>;
}

/* ── the drawer ──────────────────────────────────────────────────────── */
function PlaySlipDrawer({ open, onClose, currentGame }) {
  const D = window.PlaySlipData;
  const slip = usePlaySlipStore();
  const [snaps, setSnaps] = React.useState({});           // eventKey → snapshot
  const [checking, setChecking] = React.useState(false);
  const [review, setReview] = React.useState(null);
  const [now, setNow] = React.useState(Date.now());
  const [showOriginal, setShowOriginal] = React.useState(false);
  const inflight = React.useRef({});
  const closeRef = React.useRef(null);
  const game = _psSupported(currentGame) ? currentGame : null;

  const events = React.useMemo(() => {
    const m = new Map();
    for (const it of slip.items) m.set(D.eventKey(it.sportKey, it.eventId), [it.sportKey, String(it.eventId)]);
    if (game) m.set(D.eventKey(game.sportKey, game.eventId), [game.sportKey, String(game.eventId)]);
    return m;
  }, [slip.items, game?.sportKey, game?.eventId]);

  const fetchOne = React.useCallback((sportKey, eventId) => {
    const k = D.eventKey(sportKey, eventId);
    if (inflight.current[k]) return inflight.current[k];
    const p = D.fetchMarketSnapshot(sportKey, eventId)
      .then(s => { setSnaps(prev => ({ ...prev, [k]: s })); return s; })
      .catch(() => null)
      .finally(() => { delete inflight.current[k]; });
    inflight.current[k] = p;
    return p;
  }, []);
  const refreshAll = React.useCallback(async () => {
    setChecking(true);
    const out = {};
    await Promise.all([...events.entries()].map(async ([k, [s, e]]) => { out[k] = await fetchOne(s, e); }));
    setChecking(false);
    return out;
  }, [events, fetchOne]);

  /* Poll only while the drawer is open and the page is visible. */
  React.useEffect(() => {
    if (!open) return;
    let timer;
    const tick = () => { if (!document.hidden) refreshAll(); timer = setTimeout(tick, _PS_POLL_MS); };
    tick();
    return () => clearTimeout(timer);
  }, [open, refreshAll]);
  React.useEffect(() => { if (!open) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [open]);
  React.useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const add = (outcome, suggestion, snap) => {
    if (!outcome || !snap) return;
    const sel = D.makeSelection(outcome, snap, suggestion);
    D.updateSlip(s => s.items.some(x => D.itemKey(x) === D.itemKey(sel)) ? s : ({
      ...s, createdAt: s.createdAt || sel.addedAt, items: [...s.items, sel],
      original: [...s.original, { id: sel.id, sportKey: sel.sportKey, eventId: sel.eventId, addedAt: sel.addedAt, matchup: sel.matchup, why: sel.why, original: sel.original }],
    }));
  };
  const same = (a, key) => D.itemKey(a) === key;
  const patch = (key, p) => D.updateSlip(s => ({ ...s, items: s.items.map(x => same(x, key) ? { ...x, ...p } : x) }));
  const accept = key => {
    D.updateSlip(s => ({ ...s, items: s.items.map(x => same(x, key) ? D.acceptCurrent(x, snaps[D.eventKey(x.sportKey, x.eventId)]) : x) }));
    setReview(r => r?.hits ? { ...r, hits: new Set([...r.hits].filter(h => h !== key)) } : r);
  };
  const remove = key => D.updateSlip(s => ({ ...s, items: s.items.filter(x => !same(x, key)) }));

  const runReview = async () => {
    const fresh = await refreshAll();
    const at = Date.now(), counts = { ODDS: 0, LINE: 0, NOT_LISTED: 0, STALE: 0, FINAL: 0 }, hits = new Set();
    let failed = 0;
    for (const sel of slip.items) {
      const s = fresh[D.eventKey(sel.sportKey, sel.eventId)];
      if (!s) { failed++; continue; }
      const r = D.compare(sel, s, at);
      for (const f of r.flags) if (f.type in counts) counts[f.type]++;
      if (D.hasChange(r)) hits.add(D.itemKey(sel));
    }
    setReview({ at, counts, hits, failed, total: slip.items.length, unchanged: slip.items.length - hits.size - failed });
  };

  if (!open) return null;
  const items = slip.items;
  const foundCount = items.filter(s => s.found || s.addedManually).length;
  const liveKeys = new Set(items.map(D.itemKey));
  const snapList = Object.values(snaps);
  const oldest = snapList.length ? Math.min(...snapList.map(s => s.fetchedAt)) : null;
  const curSnap = game ? snaps[D.eventKey(game.sportKey, game.eventId)] : null;

  return <div className="slip-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <aside className="slip-drawer" role="dialog" aria-modal="true" aria-label="Simulated slip">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 'var(--s3)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'Orbitron, monospace', fontWeight: 800, letterSpacing: '0.16em', color: 'var(--accent)' }}>SIMULATED SLIP</div>
          <div style={_psMuted}>Find each selection on DraftKings by hand · simulation, not wagers</div>
        </div>
        <Chip color="var(--accent)" strong>{items.length} PICKS</Chip>
        {items.length > 0 && <Chip color={foundCount === items.length ? 'var(--green)' : 'var(--muted)'}>{foundCount}/{items.length} FOUND</Chip>}
        <button ref={closeRef} type="button" aria-label="Close slip" style={{ ..._psBtn, padding: '6px 10px' }} onClick={onClose}>✕</button>
      </div>

      <div style={{ ..._psMuted, marginBottom: 'var(--s3)' }}>
        {oldest ? `Prices from ESPN's DraftKings feed · oldest check ${D.fmtClock(oldest)} (${D.fmtAge((now - oldest) / 1000)} ago)` : events.size ? 'Checking DraftKings…' : 'No games in the slip yet.'}
        {checking && ' · checking now…'}{events.size > 0 && ` · auto-checks every ${_PS_POLL_MS / 1000}s while open`}
        {!D.slipSaveOk() && <div style={{ color: 'var(--orange)' }}>Browser storage unavailable — this slip lasts only while the page is open.</div>}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 'var(--s3)' }}>
        <button type="button" disabled={!items.length || checking} onClick={runReview}
          style={{ ..._psBtn, borderColor: 'var(--accent)', color: 'var(--accent)', opacity: items.length ? 1 : .5 }}>{checking ? 'CHECKING…' : 'REVIEW CURRENT SLIP'}</button>
        {items.length > 0 && <_PsCopyButton text={D.copySlip(items)} label="COPY ENTIRE SLIP" />}
        {slip.original.length > 0 && <button type="button" aria-expanded={showOriginal} style={_psBtn} onClick={() => setShowOriginal(v => !v)}>
          {showOriginal ? 'HIDE ORIGINAL SLIP' : `ORIGINAL SLIP (${slip.original.length})`}</button>}
      </div>

      {review && <div role="status" style={{ ..._psMuted, color: 'var(--text)', padding: '8px 10px', marginBottom: 'var(--s3)', borderRadius: 'var(--r-md, 8px)',
        border: `1px solid ${review.hits.size || review.failed ? 'var(--orange)' : 'var(--green)'}` }}>
        Reviewed {D.fmtClock(review.at)} · {review.total} selection{review.total === 1 ? '' : 's'} ·{' '}
        {[['ODDS', 'odds change'], ['LINE', 'line change'], ['NOT_LISTED', 'not in latest feed'], ['FINAL', 'game final'], ['STALE', 'possibly stale']]
          .filter(([k]) => review.counts[k]).map(([k, l]) => `${review.counts[k]} ${l}${review.counts[k] > 1 && (k === 'ODDS' || k === 'LINE') ? 's' : ''}`).join(' · ') || 'no changes'}
        {' '}· {review.unchanged} unchanged{review.failed ? ` · ${review.failed} could not be checked (feed did not load)` : ''}{review.hits.size ? ' — changed cards are outlined.' : '.'}
      </div>}

      {game && <_PsAddFromGame game={game} snap={curSnap} slip={slip} onAdd={add} />}

      {!items.length ? <div style={{ ..._psMuted, padding: 'var(--s3) 0' }}>
        Slip is empty. {game ? 'Add a suggested play or a posted line from this game above' : 'Open any game and add plays from here'} — each card keeps the price and game state from the moment you add it.
      </div> : <div style={{ display: 'grid', gap: 'var(--s3)' }}>
        {items.map((sel, i) => {
          const key = D.itemKey(sel);
          return <_PsCard key={key} sel={sel} index={i} snap={snaps[D.eventKey(sel.sportKey, sel.eventId)] || null} now={now}
            reviewHit={!!review?.hits?.has(key)}
            onPatch={p => patch(key, p)} onAccept={() => accept(key)} onRemove={() => remove(key)} />;
        })}
      </div>}

      {showOriginal && slip.original.length > 0 && <div style={{ marginTop: 'var(--s4)', paddingTop: 'var(--s3)', borderTop: '1px dashed var(--line-strong)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 'var(--fs-micro)', letterSpacing: '0.14em', color: 'var(--muted)', flex: 1 }}>ORIGINAL SIMULATED SLIP · FROZEN AT ADD TIME</span>
          <_PsCopyButton text={D.copySlip(slip.original.map(o => ({ ...o, working: o.original })), { label: 'PlayIQ original simulated slip', at: slip.createdAt })} label="COPY ORIGINAL" />
        </div>
        {slip.original.map((o, i) => <div key={`${o.sportKey}:${o.eventId}:${o.id}:${o.addedAt}`} style={{ ..._psMuted, color: 'var(--text)', padding: '5px 0', borderTop: '1px solid var(--line)' }}>
          {i + 1}. {o.matchup?.sport} {o.matchup?.away} @ {o.matchup?.home} · {o.original.headline} · {o.original.periodKey === 'full' ? 'full game' : o.original.period} · <strong>{D.fmtOdds(o.original.odds)}</strong>
          <span style={{ color: 'var(--muted)' }}> · added {D.fmtClock(o.addedAt)}{o.original.context?.detail ? ` (${o.original.context.detail})` : ''}{!liveKeys.has(`${o.sportKey}:${o.eventId}:${o.id}`) ? ' · removed from working slip' : ''}</span>
        </div>)}
      </div>}

      <div style={{ ..._psMuted, color: 'var(--dim)', marginTop: 'var(--s3)' }}>
        Simulation and research only — nothing here places a wager. Prices come from ESPN’s DraftKings feed and can lag the sportsbook; confirm each one on DraftKings.
      </div>
    </aside>
  </div>;
}

Object.assign(window, { PlaySlipNavButton, PlaySlipDrawer, PlaySlipSource });
