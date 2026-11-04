/* ============================================================
   PLAYIQ — NBA / WNBA SINGLE-GAME BREAKDOWN
   "Why did he only grab 2 rebounds that night?"

   Clicking a bar in the Edge Finder's game-log chart opens this. Everything is
   derived from ONE ESPN call (the game summary for the bar's eventId):

   - The player's own line + availability (DNP reason, minutes vs his season
     average, foul trouble, blowout margin).
   - Who was out, on both sides, AS OF THAT GAME. This comes from the box
     score's `didNotPlay` + `reason`. The summary's top-level `injuries` array
     is the team's CURRENT injury report (dated today, not game day), so it is
     deliberately NOT used — it would blame a 2-rebound night in October on an
     injury that happened in November.
   - The opposing PF / C he shared the floor with. There is no free source of
     true defensive assignments (NBA.com's matchup endpoint is Akamai-blocked
     server- and client-side), so this reconstructs every lineup from the
     play-by-play substitutions and measures SHARED FLOOR TIME — i.e. which
     bigs were on the court competing for the same boards, and how many they
     grabbed while he was out there. It is labelled as floor time in the UI,
     never as "guarded by".

   Positions: ESPN only publishes G/F/C, which can't tell a PF from an SF. The
   backend's Basketball-Reference map (`/api/nba/positions`) supplies PG..C.
   If that's unavailable (backend asleep, WNBA, a rookie BR hasn't listed) the
   breakdown falls back to ESPN's coarse C/F and says so (`posSource`).
   ============================================================ */

const _nbaBreakdownCache = new Map();          // `${league}:${eventId}` → summary JSON (finished games are immutable)
const _nbaPositionCache = new Map();           // name → 'PF' | 'C' | … | null

function _bdNum(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }

// "7:15" → 435, "45.2" → 45.2
function _bdClockSec(display) {
  const s = String(display || '0');
  if (s.includes(':')) { const [m, sec] = s.split(':'); return _bdNum(m) * 60 + _bdNum(sec); }
  return _bdNum(s);
}

function _bdPeriodLen(league, period) {
  const reg = league === 'wnba' ? 600 : 720;
  return period <= 4 ? reg : 300;
}
function _bdPeriodStart(league, period) {
  let t = 0;
  for (let p = 1; p < period; p++) t += _bdPeriodLen(league, p);
  return t;
}

// Parse the box score into { teamId → { abbr, players: [{id,name,espnPos,starter,dnp,reason,stats{}}] } }
function _bdParseBox(summary) {
  const teams = {};
  for (const t of (summary?.boxscore?.players || [])) {
    const teamId = String(t.team?.id || '');
    const grp = (t.statistics || [])[0] || {};
    const keys = grp.keys || [];
    const idx = k => keys.indexOf(k);
    const players = (grp.athletes || []).map(a => {
      const st = a.stats || [];
      const get = k => { const i = idx(k); return i < 0 ? 0 : _bdNum(st[i]); };
      const pair = k => { const i = idx(k); const [m, at] = String(i < 0 ? '' : st[i] || '').split('-'); return [_bdNum(m), _bdNum(at)]; };
      const [fgm, fga] = pair('fieldGoalsMade-fieldGoalsAttempted');
      return {
        id: String(a.athlete?.id || ''),
        name: a.athlete?.displayName || '?',
        shortName: a.athlete?.shortName || a.athlete?.displayName || '?',
        headshot: a.athlete?.headshot?.href || null,
        espnPos: a.athlete?.position?.abbreviation || '',
        starter: !!a.starter,
        // ESPN stamps "COACH'S DECISION" on every player as a default, so the
        // reason only means something when the player actually didn't play.
        dnp: !!a.didNotPlay || st.length === 0,
        reason: (a.didNotPlay || st.length === 0) ? (a.reason || null) : null,
        stats: {
          min: get('minutes'), pts: get('points'), reb: get('rebounds'), ast: get('assists'),
          oreb: get('offensiveRebounds'), dreb: get('defensiveRebounds'),
          pf: get('fouls'), pm: get('plusMinus'), blk: get('blocks'), fgm, fga,
        },
      };
    });
    teams[teamId] = { teamId, abbr: t.team?.abbreviation || '?', logo: t.team?.logo || null, players };
  }
  return teams;
}

/* ── Lineup reconstruction ─────────────────────────────────
   ESPN doesn't publish who starts each period after Q1, so it's inferred the
   standard way: a player whose FIRST event in a period is anything other than
   checking in (a shot, a rebound, being subbed OUT) was on the floor when the
   period began. Q1 uses the box score's starters. If a team still has <5
   (someone played a whole quarter without touching the play log), the gap is
   filled from that team's end-of-previous-period five. */
function _bdReconstruct(summary, league, teams) {
  const teamOf = {};
  for (const t of Object.values(teams)) for (const p of t.players) teamOf[p.id] = t.teamId;
  const teamIds = Object.keys(teams);

  const plays = (summary?.plays || []).map(p => ({
    period: p.period?.number || 1,
    t: _bdPeriodStart(league, p.period?.number || 1)
      + (_bdPeriodLen(league, p.period?.number || 1) - _bdClockSec(p.clock?.displayValue)),
    type: String(p.type?.text || ''),
    isSub: /substitution/i.test(p.type?.text || ''),
    teamId: String(p.team?.id || ''),
    ids: (p.participants || []).map(x => String(x.athlete?.id || '')).filter(id => teamOf[id]),
  }));
  if (!plays.length) return null;

  const periods = [...new Set(plays.map(p => p.period))].sort((a, b) => a - b);
  const startSets = {};
  let prevEnd = null;
  for (const per of periods) {
    const seen = new Set();
    const starters = Object.fromEntries(teamIds.map(id => [id, []]));
    const enteredFirst = new Set();
    const mark = id => {
      if (seen.has(id)) return;
      seen.add(id);
      const tm = teamOf[id];
      if (tm && starters[tm].length < 5) starters[tm].push(id);
    };
    for (const p of plays.filter(x => x.period === per)) {
      if (p.isSub) {
        const [inId, outId] = p.ids;
        if (outId) mark(outId);
        if (inId && !seen.has(inId)) { seen.add(inId); enteredFirst.add(inId); }
      } else if (!/technical|ejection/i.test(p.type)) {
        p.ids.forEach(mark);
      }
    }
    if (per === 1) {
      for (const tm of teamIds) {
        const box = teams[tm].players.filter(p => p.starter).map(p => p.id);
        if (box.length === 5) starters[tm] = box;
      }
    }
    for (const tm of teamIds) {
      if (starters[tm].length >= 5) continue;
      const pool = [
        ...((prevEnd && prevEnd[tm]) || []),
        ...teams[tm].players.slice().sort((a, b) => b.stats.min - a.stats.min).map(p => p.id),
      ];
      for (const id of pool) {
        if (starters[tm].length >= 5) break;
        if (!starters[tm].includes(id) && !enteredFirst.has(id)) starters[tm].push(id);
      }
    }
    startSets[per] = starters;

    // End-of-period five, for the next period's fallback.
    const on = Object.fromEntries(teamIds.map(id => [id, new Set(starters[id])]));
    for (const p of plays.filter(x => x.period === per && x.isSub)) {
      const [inId, outId] = p.ids;
      const tm = teamOf[inId] || teamOf[outId];
      if (!tm) continue;
      if (outId) on[tm].delete(outId);
      if (inId) on[tm].add(inId);
    }
    prevEnd = Object.fromEntries(teamIds.map(id => [id, [...on[id]]]));
  }

  return { plays, periods, startSets, teamOf, teamIds };
}

/* Walk the game once, tracking who is on the floor. For the target player:
   - shared[oppId]          seconds both were on the court
   - oppReb[oppId]          rebounds that opponent grabbed in that time (+ oreb)
   - myRebWith[oppId]       rebounds the target grabbed while that opponent was out there
   - onFloorReb[teamId]     all rebounds each team grabbed while the target played
   Also returns simulated minutes per player, used to sanity-check the
   reconstruction against the box score (`lineupCheck`). */
function _bdSimulate(rec, league, targetId) {
  const { plays, periods, startSets, teamOf, teamIds } = rec;
  const shared = {}, oppReb = {}, oppOreb = {}, myRebWith = {}, simSec = {};
  const onFloorReb = Object.fromEntries(teamIds.map(id => [id, 0]));
  const targetTeam = teamOf[targetId];

  for (const per of periods) {
    const on = Object.fromEntries(teamIds.map(id => [id, new Set(startSets[per][id])]));
    let prevT = _bdPeriodStart(league, per);
    const endT = prevT + _bdPeriodLen(league, per);
    const advance = t => {
      const dt = Math.max(0, Math.min(t, endT) - prevT);
      if (dt > 0) {
        for (const tm of teamIds) for (const id of on[tm]) simSec[id] = (simSec[id] || 0) + dt;
        if (targetTeam && on[targetTeam].has(targetId)) {
          for (const tm of teamIds) {
            if (tm === targetTeam) continue;
            for (const id of on[tm]) shared[id] = (shared[id] || 0) + dt;
          }
        }
        prevT = Math.min(t, endT);
      }
    };
    for (const p of plays.filter(x => x.period === per)) {
      advance(p.t);
      if (p.isSub) {
        const [inId, outId] = p.ids;
        const tm = teamOf[inId] || teamOf[outId];
        if (!tm) continue;
        if (outId) on[tm].delete(outId);
        if (inId) on[tm].add(inId);
        continue;
      }
      if (/rebound/i.test(p.type) && p.ids[0]) {
        const rebId = p.ids[0];
        const rebTeam = teamOf[rebId];
        const targetOn = targetTeam && on[targetTeam].has(targetId);
        if (!targetOn || !rebTeam) continue;
        onFloorReb[rebTeam] = (onFloorReb[rebTeam] || 0) + 1;
        for (const tm of teamIds) {
          if (tm === targetTeam) continue;
          for (const oppId of on[tm]) {
            if (rebId === oppId) {
              oppReb[oppId] = (oppReb[oppId] || 0) + 1;
              if (/offensive/i.test(p.type)) oppOreb[oppId] = (oppOreb[oppId] || 0) + 1;
            }
            if (rebId === targetId) myRebWith[oppId] = (myRebWith[oppId] || 0) + 1;
          }
        }
      }
    }
    advance(endT);
  }
  return { shared, oppReb, oppOreb, myRebWith, onFloorReb, simSec };
}

// Bigs only: PF/C from Basketball-Reference, else ESPN's coarse C/F.
function _bdIsBig(pos) { return pos === 'PF' || pos === 'C' || pos === 'F'; }

/**
 * Pure: summary JSON + player id → breakdown object. `positions` maps a
 * player's display name to PG/SG/SF/PF/C (may be empty).
 */
function buildNbaGameBreakdown(summary, playerId, { league = 'nba', positions = {}, seasonMpg = null } = {}) {
  const pid = String(playerId);
  const teams = _bdParseBox(summary);
  const teamIds = Object.keys(teams);
  const myTeamId = teamIds.find(tm => teams[tm].players.some(p => p.id === pid));
  if (!myTeamId) return { error: 'PLAYER_NOT_IN_BOX', message: 'Player is not in this game\'s box score.' };
  const oppTeamId = teamIds.find(tm => tm !== myTeamId);
  const me = teams[myTeamId].players.find(p => p.id === pid);
  const myTeam = teams[myTeamId], oppTeam = teams[oppTeamId];

  // Final score + margin, from the header (works for any completed game).
  const comps = summary?.header?.competitions?.[0]?.competitors || [];
  const scoreOf = tm => _bdNum(comps.find(c => String(c.team?.id || c.id) === tm)?.score);
  const myScore = scoreOf(myTeamId), oppScore = scoreOf(oppTeamId);
  const margin = myScore - oppScore;
  const status = summary?.header?.competitions?.[0]?.status?.type || {};

  const teamTotals = tm => teams[tm].players.reduce((s, p) => ({
    reb: s.reb + p.stats.reb, oreb: s.oreb + p.stats.oreb, dreb: s.dreb + p.stats.dreb,
  }), { reb: 0, oreb: 0, dreb: 0 });

  const posOf = p => {
    const br = positions[p.name];
    if (br) return { pos: br, posSource: 'bref' };
    if (p.espnPos === 'C') return { pos: 'C', posSource: 'espn' };
    if (p.espnPos === 'F') return { pos: 'F', posSource: 'espn' };
    return { pos: p.espnPos || '?', posSource: 'espn' };
  };

  // Lineups from the play-by-play.
  const rec = _bdReconstruct(summary, league, teams);
  const sim = rec ? _bdSimulate(rec, league, pid) : null;

  // Reconstruction health: mean absolute error vs box-score minutes over
  // players who played. Shown in the UI so a bad parse can't hide.
  let lineupCheck = null;
  if (sim) {
    const played = Object.values(teams).flatMap(t => t.players).filter(p => p.stats.min > 0);
    const errs = played.map(p => Math.abs((sim.simSec[p.id] || 0) / 60 - p.stats.min));
    const mae = errs.reduce((a, b) => a + b, 0) / (errs.length || 1);
    lineupCheck = { maeMinutes: +mae.toFixed(2), reliable: mae <= 2.5 };
  }

  const bigs = oppTeam.players
    .filter(p => !p.dnp && p.stats.min > 0)
    .map(p => ({ ...p, ...posOf(p) }))
    .filter(p => _bdIsBig(p.pos))
    .map(p => ({
      id: p.id, name: p.name, shortName: p.shortName, headshot: p.headshot,
      pos: p.pos, posSource: p.posSource, starter: p.starter,
      min: p.stats.min, reb: p.stats.reb, oreb: p.stats.oreb, dreb: p.stats.dreb, blk: p.stats.blk, pf: p.stats.pf,
      sharedMin: sim ? +((sim.shared[p.id] || 0) / 60).toFixed(1) : null,
      rebWhileShared: sim ? (sim.oppReb[p.id] || 0) : null,
      orebWhileShared: sim ? (sim.oppOreb[p.id] || 0) : null,
      myRebWhileShared: sim ? (sim.myRebWith[p.id] || 0) : null,
    }))
    .sort((a, b) => (b.sharedMin ?? b.min) - (a.sharedMin ?? a.min));

  // The "primary" PF and C: whoever of each spent the most time on the floor
  // with him. ESPN-only positions can't split PF from SF, so 'F' rows are
  // shown but only an explicit PF/C is crowned.
  const primaryPF = bigs.find(b => b.pos === 'PF') || null;
  const primaryC = bigs.find(b => b.pos === 'C') || null;

  const outList = tm => teams[tm].players
    .filter(p => p.dnp && p.reason && !/coach/i.test(p.reason))
    .map(p => ({ name: p.name, pos: posOf(p).pos, reason: p.reason }));
  const oppBigsOut = oppTeam.players
    .filter(p => p.dnp && p.reason && !/coach/i.test(p.reason))
    .map(p => ({ name: p.name, ...posOf(p), reason: p.reason }))
    .filter(p => _bdIsBig(p.pos));

  // Context flags — each a plain, checkable sentence.
  const flags = [];
  if (me.dnp) {
    flags.push({ tone: 'bad', text: `Did not play${me.reason ? ` — ${me.reason}` : ''}.` });
  } else {
    if (seasonMpg && me.stats.min < seasonMpg - 6) {
      flags.push({ tone: 'warn', text: `Played ${me.stats.min} min — ${(seasonMpg - me.stats.min).toFixed(0)} below his ${seasonMpg.toFixed(1)} season average.` });
    }
    if (me.stats.pf >= 5) flags.push({ tone: 'warn', text: `Foul trouble: ${me.stats.pf} personal fouls${me.stats.pf >= 6 ? ' (fouled out)' : ''}.` });
    if (status.completed && Math.abs(margin) >= 20) {
      flags.push({ tone: 'warn', text: `Blowout (${margin > 0 ? 'won' : 'lost'} by ${Math.abs(margin)}) — starters often sit the 4th quarter.` });
    }
  }
  const myTot = teamTotals(myTeamId), oppTot = teamTotals(oppTeamId);
  if (oppTot.reb - myTot.reb >= 8) {
    flags.push({ tone: 'warn', text: `${oppTeam.abbr} won the glass ${oppTot.reb}–${myTot.reb} (${oppTot.oreb} offensive boards).` });
  }
  if (oppBigsOut.length) {
    flags.push({ tone: 'info', text: `${oppTeam.abbr} bigs out: ${oppBigsOut.map(b => `${b.name} (${b.reason.toLowerCase()})`).join(', ')}.` });
  }

  return {
    eventId: summary?.header?.id || null,
    league,
    final: !!status.completed,
    statusText: status.shortDetail || status.detail || '',
    me: {
      id: me.id, name: me.name, dnp: me.dnp, reason: me.reason, starter: me.starter, ...me.stats,
      rebShare: myTot.reb ? me.stats.reb / myTot.reb : null,
    },
    myTeam: { id: myTeamId, abbr: myTeam.abbr, logo: myTeam.logo, score: myScore, ...myTot },
    oppTeam: { id: oppTeamId, abbr: oppTeam.abbr, logo: oppTeam.logo, score: oppScore, ...oppTot },
    margin,
    onFloorReb: sim ? { mine: sim.onFloorReb[myTeamId] || 0, opp: sim.onFloorReb[oppTeamId] || 0 } : null,
    bigs,
    primaryPF, primaryC,
    out: { mine: outList(myTeamId), opp: outList(oppTeamId) },
    flags,
    lineupCheck,
    posSource: Object.keys(positions).length ? 'bref' : 'espn',
  };
}

async function _bdFetchPositions(names) {
  const missing = names.filter(n => !_nbaPositionCache.has(n));
  if (missing.length) {
    try {
      const r = await fetch(`${API_BASE}/api/nba/positions?names=${encodeURIComponent(missing.join('|'))}`);
      const j = r.ok ? await r.json() : null;
      for (const n of missing) _nbaPositionCache.set(n, j?.positions?.[n] || null);
    } catch { /* backend asleep/down — ESPN fallback */ }
  }
  const out = {};
  for (const n of names) { const v = _nbaPositionCache.get(n); if (v) out[n] = v; }
  return out;
}

/**
 * Fetch + build. `league` is 'nba' or 'wnba'. Positions are NBA-only
 * (Basketball-Reference's map is NBA); WNBA runs on ESPN's G/F/C.
 */
async function fetchNbaGameBreakdown(eventId, playerId, { league = 'nba', seasonMpg = null } = {}) {
  if (!eventId) return { error: 'NO_EVENT', message: 'This game has no ESPN event id.' };
  const key = `${league}:${eventId}`;
  let summary = _nbaBreakdownCache.get(key);
  if (!summary) {
    summary = await espnFetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/${league}/summary?event=${eventId}`);
    if (!summary) return { error: 'FETCH_FAILED', message: 'Could not load the box score from ESPN.' };
    if (summary?.header?.competitions?.[0]?.status?.type?.completed) _nbaBreakdownCache.set(key, summary);
  }
  let positions = {};
  if (league === 'nba') {
    const names = (summary.boxscore?.players || [])
      .flatMap(t => ((t.statistics || [])[0]?.athletes || []).map(a => a.athlete?.displayName))
      .filter(Boolean);
    positions = await _bdFetchPositions(names);
  }
  return buildNbaGameBreakdown(summary, playerId, { league, positions, seasonMpg });
}

if (typeof window !== 'undefined') {
  Object.assign(window, { fetchNbaGameBreakdown, buildNbaGameBreakdown });
}
if (typeof module !== 'undefined') module.exports = { buildNbaGameBreakdown };
