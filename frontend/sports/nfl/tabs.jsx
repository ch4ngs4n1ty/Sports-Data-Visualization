// NFL-specific tabs.
//
// MATCHUP (season team profiles) and EDGE FINDER (per-player Last 5 + career
// games vs tonight's opponent, every season). The Edge Finder is deliberately
// NOT a probability model: it shows the real game logs, averages and — when
// the user types a prop line — plain hit rates. No projection is invented.

// A single head-to-head stat row: both teams' value with the better side lit.
// `better` says which direction wins ('high' or 'low') so turnover-style stats
// where low is good still highlight correctly.
function NflCompareRow({ label, away, home, better = 'high', fmt = v => v }) {
  const av = away?.value ?? null;
  const hv = home?.value ?? null;
  const known = av != null && hv != null && av !== hv;
  const awayWins = known && (better === 'high' ? av > hv : av < hv);
  const homeWins = known && !awayWins;

  const side = (stat, wins, color) => (
    <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
      <div className="piq-num" style={{
        fontSize: 'var(--fs-lg)', lineHeight: 1.1,
        color: wins ? color : 'var(--muted)',
        textShadow: wins ? `0 0 18px ${color}44` : 'none',
      }}>
        {stat ? fmt(stat.display ?? stat.value) : '—'}
      </div>
    </div>
  );

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--s3)',
      padding: '10px 0', borderBottom: '1px solid var(--line)',
    }}>
      {side(away, awayWins, 'var(--cyan)')}
      <div style={{ flex: '0 0 34%', textAlign: 'center' }}>
        <div className="piq-label" style={{ color: 'var(--muted)' }}>{label}</div>
      </div>
      {side(home, homeWins, 'var(--gold)')}
    </div>
  );
}

// NFL MATCHUP tab — season-long team profiles side by side.
function NflMatchupTab({ gameData }) {
  const prof = gameData?.nflProfiles;
  if (!prof) return <TabLoader source="espn" label="TEAM PROFILES" rows={5} />;
  const { away, home } = prof;
  if (!away && !home) {
    return <EmptyState title="NO TEAM DATA" hint="ESPN has no season statistics for these teams yet. Team stats populate once the season is underway." />;
  }

  // Offense: more is better. Defense: fewer yards/points allowed is better.
  const OFFENSE = [
    { label: 'PTS / GM', key: 'pointsFor', better: 'high' },
    { label: 'TOTAL YDS', key: 'totalYards', better: 'high' },
    { label: 'PASS YDS / GM', key: 'passYards', better: 'high' },
    { label: 'RUSH YDS / GM', key: 'rushYards', better: 'high' },
    { label: '3RD DOWN %', key: 'thirdDown', better: 'high' },
  ];
  const DEFENSE = [
    { label: 'PTS ALLOWED / GM', key: 'pointsAgainst', better: 'low' },
    { label: 'YDS ALLOWED', key: 'yardsAllowed', better: 'low' },
    { label: 'PASS YDS ALLOWED', key: 'passYardsAllowed', better: 'low' },
    { label: 'RUSH YDS ALLOWED', key: 'rushYardsAllowed', better: 'low' },
    { label: 'OPP 3RD DOWN %', key: 'thirdDownAllowed', better: 'low' },
    { label: 'SACKS', key: 'sacks', better: 'high' },
    { label: 'TAKEAWAYS', key: 'takeaways', better: 'high' },
    { label: 'TO DIFF', key: 'turnoverDiff', better: 'high' },
  ];

  return (
    <div>
      <SectionHeader label="SEASON MATCHUP" sub="ESPN team statistics · brighter value is the better side" />

      <HudCard style={{ padding: 'var(--s5)' }}>
        {/* Team header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <img src={gameData.gameInfo?.awayLogo} alt="" style={{ width: 42, height: 42, objectFit: 'contain' }} />
            <div className="piq-num" style={{ fontSize: 'var(--fs-sm)', color: 'var(--cyan)', marginTop: 4 }}>
              {gameData.gameInfo?.awayAbbr}
            </div>
            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>{away?.record || ''}</div>
          </div>
          <div style={{ flex: '0 0 34%', textAlign: 'center' }}>
            <Chip color="var(--muted)">@</Chip>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <img src={gameData.gameInfo?.homeLogo} alt="" style={{ width: 42, height: 42, objectFit: 'contain' }} />
            <div className="piq-num" style={{ fontSize: 'var(--fs-sm)', color: 'var(--gold)', marginTop: 4 }}>
              {gameData.gameInfo?.homeAbbr}
            </div>
            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>{home?.record || ''}</div>
          </div>
        </div>

        <div className="piq-label" style={{ color: 'var(--cyan)', margin: '6px 0 2px' }}>OFFENSE</div>
        {OFFENSE.map(r => (
          <NflCompareRow key={r.key} label={r.label}
            away={away?.[r.key]} home={home?.[r.key]} better={r.better} />
        ))}

        <div className="piq-label" style={{ color: 'var(--orange)', margin: 'var(--s4) 0 2px' }}>DEFENSE</div>
        {DEFENSE.map(r => (
          <NflCompareRow key={r.key} label={r.label}
            away={away?.[r.key]} home={home?.[r.key]} better={r.better} />
        ))}
      </HudCard>

      <div style={{ marginTop: 'var(--s3)', fontSize: 'var(--fs-micro)', color: 'var(--dim)', lineHeight: 1.7 }}>
        Season totals from ESPN team statistics. Defensive figures are what
        opponents have produced against this team. The brighter value is the
        better of the two — fewer yards and points allowed wins on defense.
      </div>
    </div>
  );
}

// ── EDGE FINDER ──────────────────────────────────────────────────────────────

const NFL_SIDE_COLOR = { away: 'var(--cyan)', home: 'var(--gold)' };
const nflFmt = (v, d = 1) => v == null ? '—' : (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(d));
// Meetings drawn on a card's vs-team strip; the TIMELINE lists every one.
const NFL_VS_BARS = 8;
const nflOldestFirst = games => [...(games || [])].reverse();
// "2020–2026", or just "2023" when every entry is the same season.
const nflSeasonSpan = years => {
  const ys = (years || []).filter(Boolean);
  if (!ys.length) return '';
  const lo = Math.min(...ys), hi = Math.max(...ys);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
};

// Relative change of `v` against `base`, or null when there's nothing to
// compare (a 0.0 baseline — e.g. a WR's passing yards — has no meaningful %).
function nflDelta(v, base) {
  if (v == null || base == null || base <= 0) return null;
  return (v - base) / base;
}

function NflDeltaChip({ delta, title }) {
  if (delta == null) return null;
  const pct = Math.round(delta * 100);
  const color = pct >= 15 ? 'var(--green)' : pct <= -15 ? 'var(--orange)' : 'var(--muted)';
  return (
    <span title={title} className="piq-num tabular" style={{ fontSize: 'var(--fs-micro)', color, letterSpacing: '0.06em' }}>
      {pct > 0 ? '▲' : pct < 0 ? '▼' : '•'} {pct > 0 ? '+' : ''}{pct}%
    </span>
  );
}

// Bars are coloured against the prop line when one is entered (over = green),
// otherwise against the player's own 17-game baseline. The shared default
// colours by 0 / 1 / 2+, which would paint every yardage bar green.
function nflColorFor(line, base) {
  return v => {
    if (line != null && Number.isFinite(line)) return v > line ? 'var(--green)' : 'var(--orange)';
    if (base == null || base <= 0) return v > 0 ? 'var(--cyan)' : 'var(--faint)';
    if (v >= base * 1.15) return 'var(--green)';
    if (v >= base * 0.85) return 'var(--cyan)';
    return 'var(--orange)';
  };
}

function NflMiniStat({ label, value, sub, color = 'var(--text)', extra }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 64 }}>
      <div className="piq-label" style={{ color: 'var(--muted)', marginBottom: 3 }}>{label}</div>
      <div className="piq-num tabular" style={{ fontSize: 'var(--fs-lg)', color, lineHeight: 1.1 }}>{value}</div>
      {(sub || extra) && (
        <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginTop: 2, display: 'flex', gap: 5, justifyContent: 'center', flexWrap: 'wrap' }}>
          {sub && <span>{sub}</span>}{extra}
        </div>
      )}
    </div>
  );
}

// "Sep 21 2026" for a game row — the year is always shown here because the
// timeline's whole job is to say WHEN each meeting happened.
function nflGameWhen(g) {
  const { md, year } = gameLogDateParts(g);
  return year ? `${md} ${year}` : md;
}

// Compact always-visible bar chart for a card. Every bar carries its value,
// the opponent logo and the full date WITH the year (these strips routinely
// cross seasons). A typed prop line is drawn as a dashed rule so over/under
// reads at a glance. Negative yardage (a -1 rushing day) draws no bar but
// still prints its value.
function NflBarStrip({ title, sub, items, line, accent, height = 92, empty }) {
  const hasLine = line != null && Number.isFinite(line);
  const max = Math.max(1, ...items.map(it => it.value || 0), hasLine ? line : 0);
  const linePct = hasLine ? Math.min(line / max, 1) * 100 : null;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 8 }}>
        <span className="piq-label" style={{ color: accent }}>{title}</span>
        {sub && <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>{sub}</span>}
      </div>
      {!items.length ? (
        <div style={{ height: height + 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px dashed var(--line)', borderRadius: 3, fontSize: 'var(--fs-micro)', color: 'var(--muted)',
          letterSpacing: '0.1em', textAlign: 'center', padding: '0 var(--s2)' }}>
          {empty}
        </div>
      ) : (
        <div>
          <div style={{ position: 'relative', height: height + 16, display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            {hasLine && (
              <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: `${linePct * height / (height + 16)}%`,
                borderTop: '1px dashed var(--gold)', opacity: 0.8, zIndex: 1, pointerEvents: 'none' }}>
                <span className="piq-num tabular" style={{ position: 'absolute', right: 0, top: -13, fontSize: 9,
                  color: 'var(--gold)', background: 'var(--card)', padding: '0 3px' }}>{line}</span>
              </div>
            )}
            {items.map((it, i) => {
              const v = it.value;
              const h = v == null ? 0 : Math.max(0, Math.min(v / max, 1)) * height;
              return (
                <div key={it.key} title={it.title} style={{ flex: 1, minWidth: 0, maxWidth: 46, margin: '0 auto',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                  <div className="piq-num tabular" style={{ fontSize: 'var(--fs-micro)', color: v == null ? 'var(--dim)' : it.color,
                    marginBottom: 3, lineHeight: 1, position: 'relative', zIndex: 2, background: 'var(--card)', padding: '0 2px' }}>
                    {v == null ? '—' : nflFmt(v)}
                  </div>
                  <div style={{ width: '100%', height: Math.max(h, v == null ? 0 : 2), borderRadius: '2px 2px 0 0',
                    background: v == null ? 'transparent' : it.color,
                    boxShadow: v == null ? 'none' : `0 0 10px color-mix(in srgb, ${it.color} 35%, transparent)`,
                    border: v == null ? '1px dashed var(--line)' : 'none',
                    minHeight: v == null ? 14 : 0,
                    transformOrigin: 'bottom', animation: `growUp 120ms var(--ease-out) ${i * 20}ms backwards` }} />
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 5, borderTop: '1px solid var(--line)', paddingTop: 5 }}>
            {items.map(it => (
              <div key={it.key} style={{ flex: 1, minWidth: 0, maxWidth: 46, margin: '0 auto', textAlign: 'center', lineHeight: 1.25 }}>
                {it.logo
                  ? <img src={it.logo} alt={it.logoAlt || ''} style={{ width: 16, height: 16, objectFit: 'contain', display: 'block', margin: '0 auto 2px' }}
                      onError={e => { e.target.style.display = 'none'; }} />
                  : it.top && <div style={{ fontSize: 9, color: 'var(--muted)' }}>{it.top}</div>}
                <div style={{ fontSize: 9, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</div>
                {it.year && <div className="tabular" style={{ fontSize: 9, color: 'var(--dim)' }}>{it.year}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Game → bar item. Label is "SEP 21", the year sits on its own line beneath.
function nflGameBar(g, statKey, colorFor) {
  const { md, year } = gameLogDateParts(g);
  const v = g[statKey] || 0;
  return {
    key: g.eventId, value: v, color: colorFor(v),
    logo: g.oppLogo, logoAlt: g.opp, top: `${g.home ? 'vs' : '@'}${g.opp}`,
    label: md, year,
    title: `${nflGameWhen(g)} · ${g.home ? 'vs' : '@'} ${g.opp} · ${nflFmt(v)}${g.result ? ` · ${g.result} ${g.score || ''}` : ''}${g.seasonType === 'POST' ? ` · ${g.note || 'playoffs'}` : ''}`,
  };
}

// One season of the vs-team timeline. Seasons with no meeting still render,
// so the gaps are visible rather than silently skipped.
function NflSeasonRow({ season, entry, statKey, line, currentTeam, color }) {
  const hr = entry ? nflHitRate(entry.games, statKey, line) : null;
  return (
    <div style={{ display: 'flex', gap: 'var(--s3)', padding: '10px 0', borderBottom: '1px solid var(--line)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ width: 62, flexShrink: 0 }}>
        <div className="piq-num tabular" style={{ fontSize: 'var(--fs-md)', color: entry ? color : 'var(--dim)' }}>{season}</div>
        <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>{entry ? `${entry.n}G · ${entry.wins}-${entry.losses}` : 'no meeting'}</div>
      </div>
      {entry && (
        <div style={{ width: 70, flexShrink: 0, textAlign: 'center' }}>
          <div className="piq-num tabular" style={{ fontSize: 'var(--fs-md)', color: 'var(--text)' }}>{nflFmt(entry.avg[statKey])}</div>
          <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>{hr ? `${hr.hits}/${hr.n} over` : 'avg'}</div>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(entry?.games || []).map(g => {
          const v = g[statKey] || 0;
          const over = line != null && Number.isFinite(line) ? v > line : null;
          return (
            <div key={g.eventId} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 'var(--fs-xs)' }}>
              <span className="tabular" style={{ color: 'var(--muted)', minWidth: 92 }}>{nflGameWhen(g)}</span>
              <span style={{ color: 'var(--text)', minWidth: 52 }}>
                {g.oppLogo && <img src={g.oppLogo} alt="" style={{ width: 14, height: 14, objectFit: 'contain', verticalAlign: 'middle', marginRight: 4 }} onError={e => { e.target.style.display = 'none'; }} />}
                {g.home ? 'vs' : '@'} {g.opp}
              </span>
              <span className="piq-num tabular" style={{ color: over == null ? 'var(--text)' : over ? 'var(--green)' : 'var(--orange)', minWidth: 36 }}>{nflFmt(v)}</span>
              {g.result && <span style={{ color: g.result === 'W' ? 'var(--green)' : g.result === 'L' ? 'var(--orange)' : 'var(--muted)' }}>{g.result} {g.score || ''}</span>}
              {g.seasonType === 'POST' && <Chip color="var(--gold)">{g.note || 'PLAYOFFS'}</Chip>}
              {g.teamAbbr && currentTeam && g.teamAbbr !== currentTeam && <Chip color="var(--muted)">w/ {g.teamAbbr}</Chip>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NflEdgePlayerCard({ p, career, line, onLine, statKey, onStat }) {
  const [open, setOpen] = React.useState(false);
  const color = NFL_SIDE_COLOR[p.side];
  const stats = nflEdgeStatsFor(p.pos);
  const stat = stats.find(s => s.key === statKey) || stats[0];
  const keys = stats.map(s => s.key);

  // The recent log renders the card immediately; the career log (all seasons)
  // replaces it as the source once it lands, which only ADDS older games.
  const careerReady = career && career !== 'loading';
  const log = careerReady ? career.games : (p.recent?.games || []);
  const sum = summarizeNflPlayerLog(log, p.oppTeamId, keys);
  const seasons = careerReady ? career.seasons : (p.recent?.seasons || []);

  const base = sum.baselineAvg[stat.key];
  const l5v = sum.l5Avg[stat.key];
  const vsv = sum.vsOppAvg[stat.key];
  const hot = nflDelta(l5v, base);
  const l5Hit = nflHitRate(sum.l5, stat.key, line);
  const vsHit = nflHitRate(sum.vsOpp, stat.key, line);
  const baseHit = nflHitRate(log.filter(g => !g.dnp).slice(0, 17), stat.key, line);
  const injured = p.status && !/^active$/i.test(p.status);
  const l5Seasons = [...new Set(sum.l5.map(g => g.season))];
  const colorFor = nflColorFor(line, base);

  return (
    <HudCard style={{ padding: 'var(--s4) var(--s5)' }} accent={color}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)', flexWrap: 'wrap' }}>
        <PlayerCard player={{ name: p.name, headshot: p.headshot, pos: p.pos }} size="md" accent={color} />
        <div style={{ flex: 1, minWidth: 170 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
            <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text)', fontWeight: 700 }}>{p.name}</span>
            <Chip color={color}>{p.teamAbbr} {p.depth || p.pos}</Chip>
            {p.jersey && <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>#{p.jersey}</span>}
            {injured && <Chip color={/out|doubtful|injured/i.test(p.status) ? 'var(--orange)' : 'var(--gold)'} title={p.injuryDesc}>{String(p.status).toUpperCase()}</Chip>}
            {hot != null && sum.l5.length >= 3 && hot >= 0.15 && <Chip color="var(--green)" title="L5 average is 15%+ above his 17-game baseline">🔥 HOT</Chip>}
            {hot != null && sum.l5.length >= 3 && hot <= -0.15 && <Chip color="var(--orange)" title="L5 average is 15%+ below his 17-game baseline">❄ COLD</Chip>}
          </div>
          <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', lineHeight: 1.6 }}>
            vs {p.oppAbbr} · {sum.vsOpp.length ? `${sum.vsOpp.length} career G vs ${p.oppAbbr}` : careerReady ? `never faced ${p.oppAbbr}` : 'loading career…'}
            {seasons.length ? ` · career ${nflSeasonSpan(seasons)}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap' }}>
          <NflMiniStat label="L5" value={nflFmt(l5v)} color={color}
            sub={l5Hit ? `${l5Hit.hits}/${l5Hit.n} over` : `${sum.l5.length}G`}
            extra={<NflDeltaChip delta={hot} title="L5 vs 17-game baseline" />} />
          <NflMiniStat label={`VS ${p.oppAbbr}`} value={sum.vsOpp.length ? nflFmt(vsv) : careerReady ? '—' : '…'}
            color={sum.vsOpp.length ? 'var(--text)' : 'var(--dim)'}
            sub={vsHit ? `${vsHit.hits}/${vsHit.n} over` : `${sum.vsOpp.length}G`}
            extra={<NflDeltaChip delta={nflDelta(vsv, base)} title={`career vs ${p.oppAbbr} vs 17-game baseline`} />} />
          <NflMiniStat label="L17" value={nflFmt(base)} color="var(--muted)"
            sub={baseHit ? `${baseHit.hits}/${baseHit.n} over` : `${sum.baselineN}G`} />
        </div>
        <button className="piq-btn piq-btn-ghost" onClick={() => setOpen(v => !v)} aria-expanded={open}
          style={{ fontSize: 'var(--fs-micro)', padding: '6px 10px' }}>
          {open ? 'HIDE ▴' : 'TIMELINE ▾'}
        </button>
      </div>

      {/* Stat + prop line. Both drive the summary, the bar colours and the
          hit rates, so they sit above everything they affect. */}
      <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap', marginTop: 'var(--s3)' }}>
        <div className="piq-seg" role="group" aria-label={`${p.name} stat`} style={{ flexWrap: 'wrap', maxWidth: '100%' }}>
          {stats.map(s => (
            <button key={s.key} onClick={() => onStat(s.key)} aria-pressed={s.key === stat.key}>{s.label}</button>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginLeft: 'auto' }}>
          LINE
          <input type="number" inputMode="decimal" step="0.5" min="0" placeholder="e.g. 64.5"
            value={line ?? ''} onChange={e => onLine(e.target.value === '' ? null : parseFloat(e.target.value))}
            aria-label={`${p.name} ${stat.label} prop line`}
            style={{ width: 84, background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text)',
              fontFamily: 'Space Mono, monospace', fontSize: 'var(--fs-xs)', padding: '5px 8px', borderRadius: 3 }} />
        </label>
      </div>

      {/* Bar charts — always visible, no expand needed. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--s4)',
        marginTop: 'var(--s4)', paddingTop: 'var(--s3)', borderTop: '1px solid var(--line)' }}>
        <NflBarStrip accent={color} line={line}
          title="LAST 5"
          sub={`${l5Seasons.length > 1 ? `${nflSeasonSpan(l5Seasons)} · ` : ''}oldest → newest${sum.dnpCount ? ` · ${sum.dnpCount} zero-stat excl.` : ''}`}
          items={nflOldestFirst(sum.l5).map(g => nflGameBar(g, stat.key, colorFor))}
          empty="NO RECENT GAMES" />
        <NflBarStrip accent={color} line={line}
          title={`VS ${p.oppAbbr}`}
          sub={!careerReady && !sum.vsOpp.length ? 'loading every season…'
            : sum.vsOpp.length > NFL_VS_BARS ? `latest ${NFL_VS_BARS} of ${sum.vsOpp.length} · ${nflSeasonSpan(sum.bySeason.map(b => b.season))}`
            : sum.vsOpp.length ? `${sum.vsOpp.length}G · ${nflSeasonSpan(sum.bySeason.map(b => b.season))} · reg + playoffs` : ''}
          items={nflOldestFirst(sum.vsOpp.slice(0, NFL_VS_BARS)).map(g => nflGameBar(g, stat.key, colorFor))}
          empty={careerReady ? `NEVER FACED ${p.oppAbbr}` : 'LOADING CAREER…'} />
      </div>

      {open && (
        <div style={{ marginTop: 'var(--s4)', animation: 'fadeUp 150ms ease' }}>
          <div style={{ paddingTop: 'var(--s3)', borderTop: '1px solid var(--line)' }}>
            {/* One bar per career season: his average vs this opponent that
                year. Seasons without a meeting stay as empty slots so the
                gaps in the timeline are visible. */}
            <NflBarStrip accent={color} line={line} height={80}
              title={`VS ${p.oppAbbr} · AVG BY SEASON`}
              sub={careerReady ? `${stat.label} · every season he has played` : 'loading every season…'}
              items={[...seasons].sort((a, b) => a - b).map(y => {
                const e = sum.bySeason.find(b => b.season === y);
                const v = e ? e.avg[stat.key] : null;
                return {
                  key: y, value: v, color: v == null ? 'var(--dim)' : colorFor(v),
                  top: e ? `${e.n}G` : '', label: e ? `${e.wins}-${e.losses}` : 'none', year: String(y),
                  title: e ? `${y}: ${nflFmt(v)} avg over ${e.n} game${e.n > 1 ? 's' : ''} vs ${p.oppAbbr}` : `${y}: no meeting`,
                };
              })}
              empty="NO SEASONS LOADED" />
            {sum.vsOpp.length > NFL_VS_BARS && (
              <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginTop: 6 }}>
                All {sum.vsOpp.length} meetings are listed game by game below.
              </div>
            )}

            <div className="piq-label" style={{ color: 'var(--muted)', margin: 'var(--s4) 0 2px' }}>TIMELINE · {stat.label} BY SEASON</div>
            {seasons.map(y => (
              <NflSeasonRow key={y} season={y} entry={sum.bySeason.find(b => b.season === y)} statKey={stat.key}
                line={line} currentTeam={p.teamAbbr} color={color} />
            ))}
          </div>
        </div>
      )}
    </HudCard>
  );
}

// Ranks board players by how their career line vs tonight's opponent compares
// to their own 17-game baseline, in each player's headline stat. Additive,
// transparent, sample size on every row — this is triage, not a model.
function NflVsTeamBoard({ players, careers }) {
  const rows = players.map(p => {
    const c = careers[p.id];
    if (!c || c === 'loading') return null;
    const stat = nflEdgeStatsFor(p.pos)[0];
    const sum = summarizeNflPlayerLog(c.games, p.oppTeamId, [stat.key]);
    if (!sum.vsOpp.length) return null;
    return { p, stat, sum, delta: nflDelta(sum.vsOppAvg[stat.key], sum.baselineAvg[stat.key]) };
  }).filter(r => r && r.delta != null).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const pending = players.filter(p => !careers[p.id] || careers[p.id] === 'loading').length;

  return (
    <HudCard style={{ padding: 'var(--s4) var(--s5)', marginBottom: 'var(--s4)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <span className="piq-label" style={{ color: 'var(--accent)' }}>VS-TEAM EDGES</span>
        <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>
          career avg vs tonight's opponent ÷ his last-17 avg{pending ? ` · loading ${pending} career${pending > 1 ? 's' : ''}…` : ''}
        </span>
      </div>
      {!rows.length ? (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', padding: '8px 0' }}>
          {pending ? 'Reading every season of each player…' : 'No board player has faced this opponent before.'}
        </div>
      ) : rows.map(({ p, stat, sum, delta }) => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', padding: '7px 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 150, fontSize: 'var(--fs-xs)', color: 'var(--text)' }}>
            <span style={{ color: NFL_SIDE_COLOR[p.side] }}>{p.teamAbbr}</span> {p.name}
            <span style={{ color: 'var(--muted)' }}> · {stat.label}</span>
          </span>
          <span className="tabular" style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', minWidth: 150 }}>
            {nflFmt(sum.vsOppAvg[stat.key])} vs {p.oppAbbr} · {nflFmt(sum.baselineAvg[stat.key])} L17
          </span>
          <span style={{ minWidth: 64, textAlign: 'right' }}><NflDeltaChip delta={delta} /></span>
          <span style={{ fontSize: 'var(--fs-micro)', color: sum.vsOpp.length < 3 ? 'var(--gold)' : 'var(--muted)', minWidth: 90, textAlign: 'right' }}>
            {sum.vsOpp.length}G · {nflSeasonSpan(sum.bySeason.map(b => b.season))}{sum.vsOpp.length < 3 ? ' · thin' : ''}
          </span>
        </div>
      ))}
    </HudCard>
  );
}

function NflEdgeFinderTab({ gameData }) {
  const { gameInfo, nflEdgeData, awayRoster, homeRoster } = gameData;
  const [filter, setFilter] = React.useState('all');
  const [extra, setExtra] = React.useState([]);          // players added from the roster picker
  const [careers, setCareers] = React.useState({});      // id -> 'loading' | { games, seasons }
  const [lines, setLines] = React.useState({});          // `${id}:${stat}` -> number
  const [statSel, setStatSel] = React.useState({});      // id -> stat key

  const players = React.useMemo(
    () => [...(nflEdgeData?.players || []), ...extra],
    [nflEdgeData, extra]
  );

  // Career logs (every season) load in the background, a few at a time via
  // the data layer's limiter; each card upgrades from its recent log as its
  // own career lands. Guarded on UNMOUNT only — a per-effect cancel would
  // orphan loads already in flight when a player is added to the board.
  const mounted = React.useRef(true);
  React.useEffect(() => () => { mounted.current = false; }, []);
  const requested = React.useRef(new Set());
  React.useEffect(() => {
    for (const p of players) {
      if (requested.current.has(p.id)) continue;
      requested.current.add(p.id);
      setCareers(c => ({ ...c, [p.id]: 'loading' }));
      fetchNflPlayerCareerLog(p.id)
        .then(r => { if (mounted.current) setCareers(c => ({ ...c, [p.id]: r })); })
        .catch(() => { if (mounted.current) setCareers(c => ({ ...c, [p.id]: { games: p.recent?.games || [], seasons: p.recent?.seasons || [] } })); });
    }
  }, [players]);

  if (!nflEdgeData) {
    if (gameData?._loading?.nflEdgeData !== false) return <TabLoader source="ESPN" label="DEPTH CHARTS + GAME LOGS" rows={5} />;
    return <EmptyState title="NO EDGE DATA" hint="ESPN's depth chart and game logs could not be loaded for this game." />;
  }

  const onBoard = new Set(players.map(p => p.id));
  const pickable = [
    ...(awayRoster || []).map(r => ({ ...r, side: 'away' })),
    ...(homeRoster || []).map(r => ({ ...r, side: 'home' })),
  ].filter(r => ['QB', 'RB', 'WR', 'TE', 'FB'].includes(r.pos) && !onBoard.has(String(r.id)));

  const addPlayer = key => {
    const r = pickable.find(x => `${x.side}:${x.id}` === key);
    if (!r) return;
    const isAway = r.side === 'away';
    const base = {
      id: String(r.id), name: r.name, pos: r.pos, depth: r.pos, side: r.side,
      teamAbbr: isAway ? gameInfo.awayAbbr : gameInfo.homeAbbr,
      oppAbbr: isAway ? gameInfo.homeAbbr : gameInfo.awayAbbr,
      oppTeamId: String(isAway ? gameInfo.homeTeamId : gameInfo.awayTeamId),
      jersey: r.jersey, status: r.status, injuryDesc: r.injuryDesc, headshot: r.headshot,
      recent: { games: [], seasons: [] },
    };
    setExtra(x => [...x, base]);
    fetchNflPlayerRecentLog(base.id).then(recent => {
      setExtra(x => x.map(p => p.id === base.id ? { ...p, recent } : p));
    });
  };

  const shown = filter === 'all' ? players : players.filter(p => p.side === filter);

  return (
    <div>
      <SectionHeader label="EDGE FINDER"
        sub={`Last 5 games + every career game vs tonight's opponent, season by season · ESPN game logs${nflEdgeData.depthChart ? ' · starters from ESPN depth chart' : ' · depth chart unavailable, roster order used'}`} />

      <NflVsTeamBoard players={players} careers={careers} />

      <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap', marginBottom: 'var(--s3)' }}>
        <div className="piq-seg" role="group" aria-label="Team filter">
          {[['all', 'ALL'], ['away', gameInfo.awayAbbr], ['home', gameInfo.homeAbbr]].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}>{l}</button>
          ))}
        </div>
        {pickable.length > 0 && (
          <select value="" onChange={e => addPlayer(e.target.value)} aria-label="Add a player to the board"
            style={{ marginLeft: 'auto', maxWidth: '100%', background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text)',
              fontFamily: 'Space Mono, monospace', fontSize: 'var(--fs-xs)', padding: '6px 8px', borderRadius: 3 }}>
            <option value="">+ ADD PLAYER…</option>
            {['away', 'home'].map(sd => (
              <optgroup key={sd} label={sd === 'away' ? gameInfo.awayAbbr : gameInfo.homeAbbr}>
                {pickable.filter(r => r.side === sd).map(r => (
                  <option key={r.id} value={`${sd}:${r.id}`}>{r.pos} · {r.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </div>

      <div className="stagger" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
        {shown.map(p => {
          const sk = statSel[p.id] || nflEdgeStatsFor(p.pos)[0].key;
          return (
            <NflEdgePlayerCard key={p.id} p={p} career={careers[p.id]}
              statKey={sk} onStat={k => setStatSel(s => ({ ...s, [p.id]: k }))}
              line={lines[`${p.id}:${sk}`] ?? null}
              onLine={v => setLines(l => ({ ...l, [`${p.id}:${sk}`]: Number.isFinite(v) ? v : null }))} />
          );
        })}
      </div>

      <div style={{ marginTop: 'var(--s4)', fontSize: 'var(--fs-micro)', color: 'var(--dim)', lineHeight: 1.7 }}>
        Straight from ESPN game logs — no projection model. L5 is his last five games played, across
        the season break when needed; L17 (one season's worth) is the baseline every % compares against.
        vs-team covers every season he has logged, regular season and playoffs, matched on team id so
        relocations (OAK → LV) still count. Games where he recorded no stats at all are excluded from
        averages. Enter a line to see how often he went OVER it.
      </div>
    </div>
  );
}

Object.assign(window, { NflMatchupTab, NflCompareRow, NflEdgeFinderTab });
