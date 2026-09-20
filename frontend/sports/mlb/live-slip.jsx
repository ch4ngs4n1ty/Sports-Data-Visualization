/* Live research slip. Uses the existing window exports and HUD primitives.
   Prices are snapshots, never sportsbook execution or synthesized SGP odds. */
function liveSelectionKey(m) { return `${m.market}:${m.side}:${m.line ?? ''}`; }
function liveValidOdds(value) {
  return String(value).trim() !== '' && Number.isFinite(Number(value)) && Math.abs(Number(value)) >= 100;
}
function liveSlipReturn(stake, odds) {
  if (!liveValidOdds(odds) || !Number.isFinite(Number(stake)) || Number(stake) <= 0) return null;
  return Number(stake) * (1 + (Number(odds) > 0 ? Number(odds) / 100 : 100 / -Number(odds)));
}
function liveMarketSelections(data) {
  const q = data.market?.live;
  if (!q) return [];
  const { state } = data;
  return [
    { market: 'MONEYLINE', side: 'AWAY', label: `${state.away.abbr} ML`, number: q.awayMoneyline },
    { market: 'MONEYLINE', side: 'HOME', label: `${state.home.abbr} ML`, number: q.homeMoneyline },
    { market: 'TOTAL', side: 'OVER', label: `OVER ${q.total}`, line: q.total, number: q.overOdds },
    { market: 'TOTAL', side: 'UNDER', label: `UNDER ${q.total}`, line: q.total, number: q.underOdds },
  ].filter(m => liveValidOdds(m.number) && (m.market !== 'TOTAL' || q.total != null));
}

function LiveSlipBuilder({ data, selected, onAdd, onRemove, onClear, onLog, unavailable }) {
  const [entries, setEntries] = React.useState({});
  const [notice, setNotice] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const markets = liveMarketSelections(data);
  const patch = (key, field, value) => {
    setEntries(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
    setNotice('');
  };
  const rows = selected.map(m => {
    const key = liveSelectionKey(m), edit = entries[key] || {};
    return { ...m, key, odds: edit.odds ?? String(m.number), stakeUnits: edit.stake ?? '1' };
  });
  const valid = rows.length > 0 && rows.every(r => liveSlipReturn(r.stakeUnits, r.odds) != null);
  const exposure = rows.reduce((sum, r) => sum + (Number(r.stakeUnits) || 0), 0);
  const button = { fontFamily: 'Space Mono, monospace', fontSize: 'var(--fs-micro)', padding: '10px 12px',
    borderRadius: 'var(--r-md)', background: 'var(--surface)', border: '1px solid var(--line-strong)', color: 'var(--text)', cursor: 'pointer' };
  const input = { ...button, width: '100%', boxSizing: 'border-box', marginTop: 5 };
  const copy = async () => {
    const text = [`PlayIQ · ${data.state.away.abbr} @ ${data.state.home.abbr} · research slip`,
      ...rows.map(r => `${r.label} | ${Number(r.odds) > 0 ? '+' : ''}${r.odds} | ${r.stakeUnits}u | ${r.snapshot.half === 'top' ? 'T' : 'B'}${r.snapshot.inning}, ${r.snapshot.score}`),
      'Separate singles. Confirm current prices and availability at your sportsbook.'].join('\n');
    try { await navigator.clipboard.writeText(text); setCopied(true); setNotice('Callout copied.'); }
    catch { setNotice('Clipboard unavailable. Select and copy the selections above.'); }
  };
  return <HudCard accent="var(--accent)" style={{ padding: 'var(--s4)', marginBottom: 'var(--s5)' }}>
    <SectionHeader label="LIVE SLIP" sub="Build your card · review the price · track your singles"
      right={<Chip color="var(--accent)">{selected.length} PICKS</Chip>} />
    <div style={{ display: 'grid', gap: 'var(--s2)', gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))' }}>
      {markets.map(m => {
        const added = selected.some(s => liveSelectionKey(s) === liveSelectionKey(m));
        return <button key={liveSelectionKey(m)} disabled={unavailable || added} onClick={() => { onAdd(m); setNotice(''); }}
          style={{ ...button, opacity: unavailable ? .45 : 1, borderColor: added ? 'var(--accent)' : 'var(--line-strong)' }}>
          <span style={{ display: 'block', color: 'var(--muted)', marginBottom: 7 }}>{m.label}</span>
          <strong style={{ fontFamily: 'Orbitron, monospace', color: 'var(--accent)' }}>{added ? '✓ ADDED' : `${m.number > 0 ? '+' : ''}${m.number}`}</strong>
        </button>;
      })}
    </div>
    <p style={{ fontSize: 'var(--fs-micro)', color: unavailable ? 'var(--orange)' : 'var(--muted)', lineHeight: 1.7 }}>
      {unavailable ? 'New selections paused: refresh the feed and verify an available price.' : 'Reference prices only. Markets may suspend between updates; confirm the line in your sportsbook.'}
      {' '}Same-game selections are correlated. No combined parlay price is estimated.
    </p>
    {!rows.length ? <EmptyState title="BUILD YOUR LIVE CARD" hint="Add a market above or a move from the board. Each pick keeps its price and game-state snapshot." /> :
      <div style={{ display: 'grid', gap: 'var(--s3)' }}>
        {rows.map(r => {
          const current = markets.find(m => liveSelectionKey(m) === r.key);
          const changed = !current || Number(current.number) !== Number(r.number);
          const returns = liveSlipReturn(r.stakeUnits, r.odds);
          return <div key={r.key} style={{ padding: 'var(--s3)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <strong style={{ flex: 1, fontSize: 'var(--fs-sm)' }}>{r.label}</strong>
              <button aria-label={`Remove ${r.label}`} style={button} onClick={() => { onRemove(r.key); setEntries(prev => { const next = { ...prev }; delete next[r.key]; return next; }); }}>×</button>
            </div>
            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', margin: '8px 0' }}>
              {r.snapshot.half === 'top' ? 'TOP' : 'BOT'} {r.snapshot.inning} · {r.snapshot.outs} OUT · {r.snapshot.score}
              {changed && <span style={{ color: 'var(--orange)' }}> · LINE MOVED / UNAVAILABLE — recheck book</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 'var(--s3)', fontSize: 'var(--fs-micro)' }}>
              <label>BOOK ODDS<input aria-label={`${r.label} American odds`} type="number" step="1" value={r.odds} onChange={e => patch(r.key, 'odds', e.target.value)} style={input} /></label>
              <label>STAKE (UNITS)<input aria-label={`${r.label} stake units`} type="number" min="0.01" step="0.25" value={r.stakeUnits} onChange={e => patch(r.key, 'stake', e.target.value)} style={input} /></label>
              <div style={{ color: 'var(--muted)' }}>POTENTIAL RETURN<div style={{ color: 'var(--accent)', marginTop: 14 }}>{returns == null ? '—' : `${returns.toFixed(2)}u`}</div></div>
            </div>
          </div>;
        })}
        {!valid && <div role="alert" style={{ fontSize: 'var(--fs-micro)', color: 'var(--orange)' }}>Enter positive stakes and American odds of +100 or higher, or −100 or lower.</div>}
        <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>EXPOSURE {valid ? `${exposure.toFixed(2)}u` : '—'} · Singles · Returns include stake</div>
        <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
          <button disabled={!valid} style={{ ...button, color: 'var(--accent)', opacity: valid ? 1 : .45 }} onClick={() => {
            if (onLog(rows)) { onClear(); setEntries({}); setNotice('Saved to your tracker. No wager was placed.'); }
            else setNotice('Storage is unavailable. Your slip is still here; try saving again.');
          }}>LOG SINGLES I PLACED</button>
          <button disabled={!valid} style={button} onClick={copy}>{copied ? 'COPY AGAIN' : 'COPY CALLOUT'}</button>
          <button style={button} onClick={() => { onClear(); setEntries({}); }}>CLEAR</button>
        </div>
      </div>}
    <div role="status" style={{ fontSize: 'var(--fs-micro)', color: 'var(--accent)', marginTop: 12 }}>{notice}</div>
    <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--dim)', marginTop: 8 }}>Research and local tracking only. Place and confirm wagers at your sportsbook.</div>
  </HudCard>;
}

function LivePlayFeed({ data }) {
  const s = data.state;
  return <HudCard style={{ padding: 'var(--s4)' }}>
    <SectionHeader label={s.isFinal ? "FINAL PLAYS" : "AT THE PLATE"} sub={`${s.currentBatter?.name || 'Batter pending'} · ${s.balls}–${s.strikes} count`} />
    <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap', marginBottom: 'var(--s3)' }}>
      <Chip color="var(--accent)">{s.currentPitcher?.name || 'Pitcher pending'} pitching</Chip>
      {s.onDeck && <Chip color="var(--muted)">ON DECK · {s.onDeck.name}</Chip>}
    </div>
    {(data.recentPlays || []).length ? data.recentPlays.map(p => <div key={p.id} style={{ display: 'flex', gap: 'var(--s3)', padding: '10px 0', borderTop: '1px solid var(--line)' }}>
      <span style={{ color: p.scoring ? 'var(--green)' : 'var(--accent)', fontSize: 'var(--fs-micro)', minWidth: 48 }}>{p.half === 'top' ? '▲' : '▼'} {p.inning}</span>
      <div style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.6 }}>{p.description}<span style={{ color: 'var(--muted)', fontSize: 'var(--fs-micro)' }}> · {p.awayScore}–{p.homeScore}</span></div>
    </div>) : <EmptyState title="WAITING FOR A COMPLETED PLAY" />}
  </HudCard>;
}
Object.assign(window, { LiveSlipBuilder, LivePlayFeed, liveSelectionKey, liveValidOdds, liveSlipReturn, liveMarketSelections });

function LivePlayerBoard({ data }) {
  const players = data.players || [];
  return <HudCard style={{ padding: 'var(--s4)' }}>
    <SectionHeader label="LIVE PLAYER PERFORMANCES" sub="Current game box score · updates with the play feed" />
    {!players.length ? <EmptyState title="PLAYER STATS PENDING" /> : <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 'var(--fs-micro)', textAlign: 'left', borderCollapse: 'collapse' }}>
        <thead><tr>{['Player', 'AB', 'H', 'R', 'RBI', 'HR', 'IP', 'K', 'Pitches'].map(h => <th key={h} style={{ padding: 8 }}>{h}</th>)}</tr></thead>
        <tbody>{players.map(p => <tr key={`${p.side}-${p.id}`} style={{ borderTop: '1px solid var(--line)' }}>
          <td style={{ padding: 8 }}>{p.name} <span style={{ color: 'var(--muted)' }}>{data.state[p.side]?.abbr}</span></td>
          {['atBats', 'hits', 'runs', 'rbi', 'homeRuns'].map(k => <td key={k} style={{ padding: 8 }}>{p.batting[k] ?? '—'}</td>)}
          {['inningsPitched', 'strikeOuts', 'numberOfPitches'].map(k => <td key={k} style={{ padding: 8 }}>{p.pitching[k] ?? '—'}</td>)}
        </tr>)}</tbody>
      </table>
    </div>}
  </HudCard>;
}

function PaperSimulation({ data, unavailable, onLog }) {
  const [market, setMarket] = React.useState('MONEYLINE');
  const [side, setSide] = React.useState('HOME');
  const [line, setLine] = React.useState('8.5');
  const [odds, setOdds] = React.useState('');
  const [stake, setStake] = React.useState('1');
  const [priceSource, setPriceSource] = React.useState('manual');
  const [draft, setDraft] = React.useState(null);
  const [notice, setNotice] = React.useState('');
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const price = window.paperPrice(data.model, data.state, market, side, line, odds);
  const quote = data.market?.live;
  const reference = market === 'MONEYLINE' ? (side === 'HOME' ? quote?.homeMoneyline : quote?.awayMoneyline)
    : Number(line) === Number(quote?.total) ? (side === 'OVER' ? quote?.overOdds : quote?.underOdds) : null;
  const input = { padding: 10, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 6, width: '100%', boxSizing: 'border-box' };
  const changed = fn => e => { fn(e.target.value); setDraft(null); setNotice(''); };
  const current = draft && draft.revision === data.revision;
  const remaining = draft ? Math.max(0, Math.ceil((Date.parse(draft.selectedAt) + 5000 - now) / 1000)) : 0;
  const blocked = unavailable || !data.model || !data.state.isLive;
  return <HudCard style={{ padding: 'var(--s4)', marginBottom: 'var(--s4)' }} accent="var(--gold)">
    <SectionHeader label="PAPER SIMULATOR" sub="Moneyline or total · manual price · no wager submission" />
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(115px, 1fr))', fontSize: 'var(--fs-micro)' }}>
      <label>MARKET<select style={input} value={market} onChange={e => { setMarket(e.target.value); setSide(e.target.value === 'TOTAL' ? 'OVER' : 'HOME'); setDraft(null); }}><option>MONEYLINE</option><option>TOTAL</option></select></label>
      <label>SIDE<select style={input} value={side} onChange={changed(setSide)}>{(market === 'TOTAL' ? ['OVER', 'UNDER'] : ['HOME', 'AWAY']).map(v => <option key={v}>{v}</option>)}</select></label>
      {market === 'TOTAL' && <label>TOTAL<input style={input} type="number" min="0" step="0.5" value={line} onChange={changed(setLine)} /></label>}
      <label>AMERICAN ODDS<input style={input} type="number" placeholder="e.g. -110" value={odds} onChange={e => { setOdds(e.target.value); setPriceSource('manual'); setDraft(null); }} /></label>
      <label>PAPER UNITS<input style={input} type="number" min="0.01" step="0.25" value={stake} onChange={changed(setStake)} /></label>
    </div>
    {liveValidOdds(reference) && <button style={{ ...input, width: 'auto', marginTop: 12 }} onClick={() => { setOdds(String(reference)); setPriceSource('unverified-reference'); setDraft(null); }}>USE UNVERIFIED REFERENCE {reference > 0 ? '+' : ''}{reference}</button>}
    <p style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', lineHeight: 1.7 }}>
      The model uses inning, runners, outs, and pitching assumptions; it does not model the current count or player props. Enter a price to test a scenario. Publication time and market availability are unknown. A five-second review delay tests whether the game state stays unchanged; it does not simulate a sportsbook accepting the price.
    </p>
    {price && <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <StatTile label="MODEL WIN" value={`${(price.win * 100).toFixed(1)}%`} countUp={false} />
      <StatTile label="PUSH" value={`${(price.push * 100).toFixed(1)}%`} countUp={false} />
      <StatTile label="HYPOTHETICAL EV" value={`${price.ev >= 0 ? '+' : ''}${(price.ev * 100).toFixed(1)}%`} countUp={false} />
      <Chip color={price.ev > 0 ? 'var(--gold)' : 'var(--muted)'}>{price.ev > 0 ? 'MODEL-POSITIVE · UNVERIFIED PRICE' : 'NO PLAY AT THIS PRICE'}</Chip>
    </div>}
    {blocked && <p role="status" style={{ color: 'var(--orange)', fontSize: 'var(--fs-micro)' }}>Simulation paused until the live feed and model agree.</p>}
    <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
      <button style={{ ...input, width: 'auto' }} disabled={blocked || !price || !(Number(stake) > 0)} onClick={() => {
        const label = market === 'MONEYLINE' ? `${data.state[side.toLowerCase()].abbr} ML` : `${side} ${line}`;
        setDraft(window.paperSnapshot(data, { market, side, line: market === 'TOTAL' ? Number(line) : null,
          odds: Number(odds), stakeUnits: Number(stake), label, priceSource }));
        setNow(Date.now()); setNotice('');
      }}>PREPARE PAPER PICK</button>
      {draft && <button style={{ ...input, width: 'auto' }} disabled={blocked || !current || remaining > 0} onClick={() => {
        if (blocked || !current || Date.now() < Date.parse(draft.selectedAt) + 5000) return;
        const record = { ...draft, audit: { ...draft.audit, decisionDelayMs: Date.now() - Date.parse(draft.selectedAt) } };
        if (onLog([record])) { setDraft(null); setNotice('Paper pick saved. Settle it in the paper tracker after the result.'); }
        else setNotice('Could not save locally. Your prepared pick is still here.');
      }}>{!current ? 'STATE CHANGED — PREPARE AGAIN' : remaining ? `REVIEW · ${remaining}s` : 'SAVE PAPER PICK'}</button>}
    </div>
    <div role="status" style={{ marginTop: 12, fontSize: 'var(--fs-micro)', color: 'var(--gold)' }}>{notice}</div>
  </HudCard>;
}
Object.assign(window, { LivePlayerBoard, PaperSimulation });
