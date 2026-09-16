// NFL-specific tabs.
//
// Scope note: this is the first NFL cut. It ships a season-profile MATCHUP tab
// on top of the five sport-agnostic tabs. There is deliberately NO props model
// or edge finder yet — those are per-sport analytical builds (see the MLB and
// NBA tabs for how much surface that takes) and should be scoped on their own
// rather than half-built here.

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
      <SectionHeader title="SEASON MATCHUP" sub="ESPN team statistics · brighter value is the better side" />

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

Object.assign(window, { NflMatchupTab, NflCompareRow });
