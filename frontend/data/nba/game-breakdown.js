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
      const [tpm, tpa] = pair('threePointFieldGoalsMade-threePointFieldGoalsAttempted');
      const [ftm, fta] = pair('freeThrowsMade-freeThrowsAttempted');
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
          tpm, tpa, ftm, fta, tov: get('turnovers'), stl: get('steals'),
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
    text: String(p.text || ''),
    shooting: !!p.shootingPlay,
    scoring: !!p.scoringPlay,
    value: _bdNum(p.scoreValue),
    attempted: _bdNum(p.pointsAttempted),
    clock: p.clock?.displayValue || '',
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
// Shot zone from ESPN's play type. The type text is more reliable than the
// court coordinate (absent on some plays, and its axes flip by half).
function _bdShotZone(p) {
  if (p.attempted === 3) return 'three';
  if (/layup|dunk|tip|putback|finger roll|alley/i.test(p.type)) return 'rim';
  return 'mid';
}
const _bdIsFreeThrow = p => /free throw/i.test(p.type);
const _bdIsFieldGoal = p => p.shooting && !_bdIsFreeThrow(p);

/* Scoring + playmaking pass, in the same walk:
   - myShots[]             every shot he took (FG + FT): period, clock, zone, made, pts, assisted-by, blocked-by
   - myAssists[]           every made basket he assisted: who scored, zone, pts
   - mateShots             teammates' FG while he was on the floor (excluding his own)
   - withOpp[oppId]        his pts / FGM / FGA / 3PM / 3PA / AST / TOV while that opponent was on the floor */
function _bdSimulate(rec, league, targetId) {
  const { plays, periods, startSets, teamOf, teamIds } = rec;
  const shared = {}, oppReb = {}, oppOreb = {}, myRebWith = {}, simSec = {};
  const onFloorReb = Object.fromEntries(teamIds.map(id => [id, 0]));
  const targetTeam = teamOf[targetId];
  const myShots = [], myAssists = [], withOpp = {};
  let myTov = 0;
  const mateShots = { fgm: 0, fga: 0, tpm: 0, tpa: 0, assisted: 0, astByMe: 0 };
  const forOpps = (on, fn) => {
    for (const tm of teamIds) {
      if (tm === targetTeam) continue;
      for (const oppId of on[tm]) {
        const w = withOpp[oppId] || (withOpp[oppId] = { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ast: 0, tov: 0 });
        fn(w, oppId);
      }
    }
  };

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
      const targetOnNow = targetTeam && on[targetTeam].has(targetId);
      if (p.shooting && p.ids[0]) {
        const [shooter, second] = p.ids;
        const fg = _bdIsFieldGoal(p);
        const made = p.scoring && p.value > 0;
        // Made shot → second participant is the assister. Missed shot →
        // second participant is the blocker (other team). Never both.
        const assister = made && second && teamOf[second] === teamOf[shooter] ? second : null;
        const blocker = !made && second && teamOf[second] !== teamOf[shooter] ? second : null;
        if (shooter === targetId) {
          myShots.push({ period: p.period, clock: p.clock, ft: !fg, zone: fg ? _bdShotZone(p) : 'ft',
            made, pts: made ? p.value : 0, attempted: p.attempted, assister, blocker, text: p.text });
          // He took the shot, so he was on the floor — credit whoever was out
          // there with him even if a sub was logged between free throws.
          forOpps(on, w => {
            if (made) w.pts += p.value;
            if (fg) { w.fga++; if (made) w.fgm++; if (p.attempted === 3) { w.tpa++; if (made) w.tpm++; } }
          });
        } else if (targetOnNow && fg && teamOf[shooter] === targetTeam) {
          mateShots.fga++; if (made) mateShots.fgm++;
          if (p.attempted === 3) { mateShots.tpa++; if (made) mateShots.tpm++; }
          if (assister) mateShots.assisted++;
          if (assister === targetId) mateShots.astByMe++;
        }
        if (assister === targetId) {
          myAssists.push({ period: p.period, clock: p.clock, scorerId: shooter, zone: _bdShotZone(p), pts: p.value, text: p.text });
          forOpps(on, w => { w.ast++; });
        }
        continue;
      }
      if (/turnover/i.test(p.type) && p.ids[0] === targetId) {
        myTov++;
        forOpps(on, w => { w.tov++; });
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
  return { shared, oppReb, oppOreb, myRebWith, onFloorReb, simSec, myShots, myAssists, mateShots, withOpp, myTov };
}

// Bigs only: PF/C from Basketball-Reference, else ESPN's coarse C/F.
function _bdIsBig(pos) { return pos === 'PF' || pos === 'C' || pos === 'F'; }

// Coarse position bucket, so a Basketball-Reference "SG" and an ESPN "G" land
// in the same group when picking the opponents at HIS position.
function _bdPosBucket(pos) {
  if (pos === 'PG' || pos === 'SG' || pos === 'G') return 'G';
  if (pos === 'SF' || pos === 'PF' || pos === 'F') return 'F';
  if (pos === 'C') return 'C';
  return '?';
}

const _bdPct = (m, a) => a ? m / a : null;
const _bdFmtPct = (m, a) => a ? `${Math.round((m / a) * 100)}%` : '—';

/**
 * Pure: summary JSON + player id → breakdown object. `positions` maps a
 * player's display name to PG/SG/SF/PF/C (may be empty).
 */
function buildNbaGameBreakdown(summary, playerId, { league = 'nba', positions = {}, seasonMpg = null, seasonAvg = {} } = {}) {
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
    pts: s.pts + p.stats.pts, ast: s.ast + p.stats.ast,
    fgm: s.fgm + p.stats.fgm, fga: s.fga + p.stats.fga, tpm: s.tpm + p.stats.tpm, tpa: s.tpa + p.stats.tpa,
    fta: s.fta + p.stats.fta, tov: s.tov + p.stats.tov,
  }), { reb: 0, oreb: 0, dreb: 0, pts: 0, ast: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, fta: 0, tov: 0 });

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

  const myTot = teamTotals(myTeamId), oppTot = teamTotals(oppTeamId);
  const nameOf = id => Object.values(teams).flatMap(t => t.players).find(p => p.id === id)?.name || '?';
  const myBucket = _bdPosBucket(posOf(me).pos);

  // Opponents at HIS position, ranked by shared floor time, with what he did
  // while each was out there. Falls back to every opponent when the position
  // is unknown or the bucket is too thin to mean anything.
  // Each opponent row SPLITS his whole game into "that opponent on" vs "off",
  // so every row sums to his total on its own. Rows overlap with each other
  // (two guards are usually on the floor together), so they must never be
  // presented as adding up across — that was the original confusion.
  const matchups = () => {
    if (!sim) return [];
    const fgs = sim.myShots.filter(x => !x.ft);
    const tot = {
      pts: sim.myShots.reduce((a, x) => a + x.pts, 0),
      fgm: fgs.filter(x => x.made).length, fga: fgs.length,
      tpm: fgs.filter(x => x.made && x.attempted === 3).length, tpa: fgs.filter(x => x.attempted === 3).length,
      ast: sim.myAssists.length, tov: sim.myTov,
    };
    const myMinSim = (sim.simSec[pid] || 0) / 60;
    const opp = oppTeam.players.filter(p => !p.dnp && p.stats.min > 0).map(p => ({ ...p, ...posOf(p) }));
    let pool = opp.filter(p => _bdPosBucket(p.pos) === myBucket);
    if (myBucket === '?' || pool.length < 2) pool = opp;
    return pool.map(p => {
      const w = sim.withOpp[p.id] || { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ast: 0, tov: 0 };
      const onMin = (sim.shared[p.id] || 0) / 60;
      const offMin = Math.max(0, myMinSim - onMin);
      const off = Object.fromEntries(Object.keys(tot).map(k => [k, Math.max(0, tot[k] - w[k])]));
      const per36 = (v, m) => m >= 3 ? +(v * 36 / m).toFixed(1) : null;   // <3 min: too small to rate
      return {
        id: p.id, name: p.name, shortName: p.shortName, pos: p.pos, posSource: p.posSource, starter: p.starter,
        min: p.stats.min, pts: p.stats.pts, stl: p.stats.stl, blk: p.stats.blk, pf: p.stats.pf,
        sharedMin: +((sim.shared[p.id] || 0) / 60).toFixed(1),
        my: w,                                   // kept for compatibility: = on
        on: { ...w, min: +onMin.toFixed(1), pts36: per36(w.pts, onMin), ast36: per36(w.ast, onMin) },
        off: { ...off, min: +offMin.toFixed(1), pts36: per36(off.pts, offMin), ast36: per36(off.ast, offMin) },
        total: tot,
      };
    }).filter(m => m.sharedMin > 0).sort((a, b) => b.sharedMin - a.sharedMin).slice(0, 6);
  };
  const matchupList = matchups();

  // ── Scoring: where the points came from ──
  let scoring = null;
  if (!me.dnp) {
    const shots = sim ? sim.myShots : [];
    const fgShots = shots.filter(x => !x.ft);
    const zone = z => {
      const list = fgShots.filter(x => x.zone === z);
      return { fgm: list.filter(x => x.made).length, fga: list.length, pts: list.reduce((a, x) => a + x.pts, 0) };
    };
    const byPeriod = {};
    for (const x of shots) byPeriod[x.period] = (byPeriod[x.period] || 0) + x.pts;
    const ts = (me.stats.fga + 0.44 * me.stats.fta) ? me.stats.pts / (2 * (me.stats.fga + 0.44 * me.stats.fta)) : null;
    scoring = {
      pts: me.stats.pts, fgm: me.stats.fgm, fga: me.stats.fga, tpm: me.stats.tpm, tpa: me.stats.tpa,
      ftm: me.stats.ftm, fta: me.stats.fta, ts,
      split: { three: me.stats.tpm * 3, ft: me.stats.ftm, two: me.stats.pts - me.stats.tpm * 3 - me.stats.ftm },
      zones: sim ? { rim: zone('rim'), mid: zone('mid'), three: zone('three') } : null,
      assistedMakes: fgShots.filter(x => x.made && x.assister).length,
      blocked: fgShots.filter(x => x.blocker).map(x => nameOf(x.blocker)),
      byPeriod: Object.entries(byPeriod).map(([per, pts]) => ({ period: +per, pts })).sort((a, b) => a.period - b.period),
      fgaShare: myTot.fga ? me.stats.fga / myTot.fga : null,
      ptsShare: myTot.pts ? me.stats.pts / myTot.pts : null,
      matchups: matchupList,
    };
  }

  // ── Playmaking: who he set up, and whether they finished ──
  let playmaking = null;
  if (!me.dnp) {
    const assists = sim ? sim.myAssists : [];
    const byMate = {};
    for (const a of assists) {
      const r = byMate[a.scorerId] || (byMate[a.scorerId] = { id: a.scorerId, name: nameOf(a.scorerId), ast: 0, threes: 0, rim: 0, pts: 0 });
      r.ast++; r.pts += a.pts;
      if (a.zone === 'three') r.threes++;
      if (a.zone === 'rim') r.rim++;
    }
    const mates = sim ? sim.mateShots : null;
    playmaking = {
      ast: me.stats.ast, tov: me.stats.tov,
      astTo: me.stats.tov ? me.stats.ast / me.stats.tov : null,
      astShare: myTot.ast ? me.stats.ast / myTot.ast : null,
      teamAst: myTot.ast,
      pointsCreated: assists.reduce((a, x) => a + x.pts, 0),
      byZone: { rim: assists.filter(a => a.zone === 'rim').length, mid: assists.filter(a => a.zone === 'mid').length, three: assists.filter(a => a.zone === 'three').length },
      recipients: Object.values(byMate).sort((a, b) => b.ast - a.ast || b.pts - a.pts),
      // Teammates' own field goals while he was on the floor (his shots excluded):
      // assists need a make, so a cold-shooting supporting cast caps the number.
      matesOnFloor: mates ? { ...mates, fgPct: _bdPct(mates.fgm, mates.fga), tpPct: _bdPct(mates.tpm, mates.tpa) } : null,
      matchups: matchupList,
    };
  }

  // Context flags — each a plain, checkable sentence.
  const flags = [];
  if (me.dnp) {
    flags.push({ tone: 'bad', text: `Did not play${me.reason ? ` — ${me.reason}` : ''}.` });
  } else {
    if (seasonMpg && me.stats.min < seasonMpg - 6) {
      flags.push({ tone: 'warn', text: `Only played ${me.stats.min} minutes — he usually plays about ${Math.round(seasonMpg)}.` });
    }
    if (me.stats.pf >= 5) flags.push({ tone: 'warn', text: `Foul trouble: ${me.stats.pf} fouls${me.stats.pf >= 6 ? ' — he fouled out' : ', which usually means time on the bench'}.` });
    if (status.completed && Math.abs(margin) >= 20) {
      flags.push({ tone: 'warn', text: `Blowout: ${margin > 0 ? 'won' : 'lost'} by ${Math.abs(margin)}. Starters often sit out the 4th quarter of games like this.` });
    }
  }
  const rebFlags = [];
  if (oppTot.reb - myTot.reb >= 8) {
    rebFlags.push({ tone: 'warn', text: `${oppTeam.abbr} out-rebounded ${myTeam.abbr} ${oppTot.reb} to ${myTot.reb}, including ${oppTot.oreb} on the offensive end.` });
  }
  if (oppBigsOut.length) {
    rebFlags.push({ tone: 'info', text: `${oppTeam.abbr} was missing ${oppBigsOut.map(b => `${b.name} (${b.reason.toLowerCase()})`).join(', ')} — fewer big men fighting for rebounds.` });
  }

  // Stat-lens flags. Kept separate so the panel shows the ones for the stat
  // being looked at, not a wall of every sentence at once.
  const ptsFlags = [], astFlags = [];
  const vsAvg = (val, avg, label) => {
    if (!Number.isFinite(avg) || avg <= 0) return null;
    const diff = val - avg;
    if (Math.abs(diff) < Math.max(2, avg * 0.25)) return null;
    return { tone: diff < 0 ? 'warn' : 'good', text: `${val} ${label} — ${diff < 0 ? 'below' : 'above'} his usual ${avg.toFixed(1)}.` };
  };
  const mineOut = outList(myTeamId);
  if (scoring) {
    const f = vsAvg(me.stats.pts, seasonAvg.pts, 'points'); if (f) ptsFlags.push(f);
    if (me.stats.fga >= 8) {
      const fg = me.stats.fgm / me.stats.fga;
      if (fg < 0.40) ptsFlags.push({ tone: 'warn', text: `Cold shooting night: made just ${me.stats.fgm} of ${me.stats.fga} shots (${Math.round(fg * 100)}%).` });
      else if (fg >= 0.55) ptsFlags.push({ tone: 'good', text: `Hot shooting night: made ${me.stats.fgm} of ${me.stats.fga} shots (${Math.round(fg * 100)}%).` });
    } else if (me.stats.min >= 20 && me.stats.fga <= 6) {
      ptsFlags.push({ tone: 'warn', text: `Barely shot: only ${me.stats.fga} shots in ${me.stats.min} minutes.` });
    }
    if (me.stats.tpa >= 5 && me.stats.tpm / me.stats.tpa <= 0.25) ptsFlags.push({ tone: 'warn', text: `Struggled from three: made ${me.stats.tpm} of ${me.stats.tpa}.` });
    if (me.stats.tpm >= 4) ptsFlags.push({ tone: 'good', text: `Hit ${me.stats.tpm} threes — ${me.stats.tpm * 3} of his ${me.stats.pts} points.` });
    if (me.stats.fta >= 8) ptsFlags.push({ tone: 'good', text: `Got to the free-throw line a lot: ${me.stats.fta} attempts, made ${me.stats.ftm}.` });
    if (scoring.blocked.length >= 2) ptsFlags.push({ tone: 'warn', text: `Got blocked ${scoring.blocked.length} times (by ${[...new Set(scoring.blocked)].join(', ')}).` });
    const bigQ = scoring.byPeriod.slice().sort((a, b) => b.pts - a.pts)[0];
    if (bigQ && me.stats.pts >= 12 && bigQ.pts >= me.stats.pts * 0.45) {
      const ql = bigQ.period <= 4 ? ['1st', '2nd', '3rd', '4th'][bigQ.period - 1] + ' quarter' : 'overtime';
      ptsFlags.push({ tone: 'info', text: `Most of it came in one stretch: ${bigQ.pts} of his ${me.stats.pts} points in the ${ql}.` });
    }
    if (mineOut.length) ptsFlags.push({ tone: 'info', text: `${myTeam.abbr} was without ${mineOut.map(o => o.name).join(', ')}, which leaves more shots for him.` });
  }
  if (!me.dnp) { const f = vsAvg(me.stats.reb, seasonAvg.reb, 'rebounds'); if (f) rebFlags.unshift(f); }
  if (playmaking) {
    const f = vsAvg(me.stats.ast, seasonAvg.ast, 'assists'); if (f) astFlags.push(f);
    const m = playmaking.matesOnFloor;
    if (m && m.fga >= 20) {
      if (m.fgPct < 0.42) astFlags.push({ tone: 'warn', text: `His teammates shot poorly with him on the court (made ${m.fgm} of ${m.fga}) — fewer made baskets means fewer assists.` });
      else if (m.fgPct >= 0.52) astFlags.push({ tone: 'good', text: `His teammates shot well with him on the court (made ${m.fgm} of ${m.fga}).` });
      if (m.tpa >= 12 && m.tpPct < 0.30) astFlags.push({ tone: 'warn', text: `His teammates made only ${m.tpm} of ${m.tpa} threes with him on the court.` });
    }
    if (me.stats.tov >= 5) astFlags.push({ tone: 'warn', text: `Turned the ball over ${me.stats.tov} times.` });
    if (playmaking.astShare != null && myTot.ast >= 10 && playmaking.astShare >= 0.40) {
      astFlags.push({ tone: 'good', text: `Ran the offense: ${me.stats.ast} of ${myTeam.abbr}'s ${myTot.ast} assists were his.` });
    }
    if (mineOut.length) astFlags.push({ tone: 'info', text: `${myTeam.abbr} was without ${mineOut.map(o => o.name).join(', ')}.` });
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
    scoring, playmaking,
    statFlags: { pts: ptsFlags, reb: rebFlags, ast: astFlags },
    myPos: posOf(me).pos,
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
async function fetchNbaGameBreakdown(eventId, playerId, { league = 'nba', seasonMpg = null, seasonAvg = {} } = {}) {
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
  return buildNbaGameBreakdown(summary, playerId, { league, positions, seasonMpg, seasonAvg });
}

if (typeof window !== 'undefined') {
  Object.assign(window, { fetchNbaGameBreakdown, buildNbaGameBreakdown });
}
if (typeof module !== 'undefined') module.exports = { buildNbaGameBreakdown };
