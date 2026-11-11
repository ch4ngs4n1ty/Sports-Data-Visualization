/* ============================================================
   PLAYIQ — NBA LIVE (in-play) data layer + projection model
   ------------------------------------------------------------
   Browser-side, like the NFL live tab: every source below answers with
   CORS `*`, so there is no backend route and nothing to restart.

     summary   site.api.espn.com/.../nba/summary?event=      (score, clock,
               box score, on-court flags, play-by-play with shot x/y,
               ESPN's own per-play win probability, pregame DK line)
     live odds sports.core.api.espn.com/.../competitions/{id}/odds
               → provider "DraftKings - Live Odds"
     season    site.web.api.espn.com/.../athletes/{id}/gamelog (Totals row)

   ── WHAT "PLAYER TRACKING" CAN AND CANNOT BE HERE. Read before editing. ──
   NBA optical tracking (Second Spectrum: x/y of all ten players, 25 fps) is
   NOT public. Nothing free carries it, and the sportsbook "trackers" mostly
   animate EVENTS too. What ESPN does give us, verified on live games
   (Nov 10 2026, ORL @ SAC, OKC @ POR):
     • `boxscore…athletes[].active === true` for EXACTLY five players per team
       — the real on-floor five, updated with substitutions.
     • every shot / rebound / block carries `coordinate {x, y}` in FEET:
       x = 0..50 across the court, y = feet out from the rim, basket at
       (25, 0.25). Calibrated against the "N-foot" distance in the play text
       over 75 shots: mean squared error 0.37 ft².
     • sentinel coordinates (≈ -2.1e8) on non-located plays → ignore.
   So the court shows the REAL five per side, the ball and the acting player
   at the REAL event location, and everyone else at a formation spot. The UI
   says exactly that; never label formation spots as tracked positions.

   ── THE MODEL. Transparent, no ML (same rule as the rest of the app). ──
   Score margin as a Brownian motion (Stern 1994, "A Brownian Motion Model for
   the Progress of Sports Scores", JASA): remaining home margin over m
   minutes ~ Normal(drift·m, σ²·m/48). The drift is the PREGAME market spread
   spread over 48 minutes, and σ is CALIBRATED PER GAME so the model
   reproduces DraftKings' own pregame spread → moneyline conversion (e.g.
   -5.5 ↔ -217/+180 ⇒ σ ≈ 12.9). That is checkable, not a remembered constant.
   Totals: remaining points ~ Normal(rate·m, σT²·m/48), rate blends the
   pregame total with the live pace, weighted by elapsed time.
   ============================================================ */
(function (root) {
  'use strict';

  const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball';
  const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues';
  const ESPN_WEB = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball';

  /* ── constants (each one is explained where it is used) ───────────── */
  const REG_MIN = 48, Q_MIN = 12, OT_MIN = 5;
  const DEFAULT_SIGMA = 13.0;      // used only when no pregame ML+spread to calibrate from
  const SIGMA_MIN = 10, SIGMA_MAX = 17;
  const TOTAL_SIGMA = 18.0;        // sd of a full game's total around the closing number
  const DEFAULT_TOTAL = 228;       // fallback when no pregame total is posted
  const DEFAULT_HOME_EDGE = 2.5;   // fallback home-court margin
  const PACE_PRIOR_MIN = 48;       // live pace weight = elapsed / (elapsed + 48)
  const RATE_PRIOR_MIN = 36;       // player live per-minute weight = min / (min + 36)
  const MIN_EDGE_PTS = 3;          // below this, no move is shown
  const ABSURD_EDGE_PTS = 20;      // a bug/stale detector, not a filter (see buildMoves)
  const STALE_SEC = 150;
  const PTS_VAR_FACTOR = 2.1;      // points come in 1/2/3s: scaled-Poisson variance ≈ 2.1·μ

  /* ── small math ───────────────────────────────────────────────────── */
  function phi(x) {   // standard normal CDF (Abramowitz–Stegun 26.2.17, |err| < 7.5e-8)
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989422804014327 * Math.exp(-x * x / 2);
    const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x >= 0 ? 1 - p : p;
  }
  function invPhi(p) {   // Acklam's rational approximation
    if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    const q = p - 0.5, r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  function poissonSf(k, mu) {   // P(X >= k), X ~ Poisson(mu)
    if (k <= 0) return 1;
    if (mu <= 0) return 0;
    let term = Math.exp(-mu), cdf = term;
    for (let i = 1; i < k; i++) { term *= mu / i; cdf += term; }
    return Math.max(0, Math.min(1, 1 - cdf));
  }
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  /* ── odds helpers ─────────────────────────────────────────────────── */
  function americanToProb(a) { a = num(a); if (a == null || a === 0) return null; return a < 0 ? -a / (-a + 100) : 100 / (a + 100); }
  function americanToDecimal(a) { a = num(a); if (a == null || a === 0) return null; return a < 0 ? 1 + 100 / -a : 1 + a / 100; }
  function probToAmerican(p) {
    if (!(p > 0 && p < 1)) return null;
    return p >= 0.5 ? -Math.round(100 * p / (1 - p)) : Math.round(100 * (1 - p) / p);
  }
  /* Two-way proportional de-vig. NEVER compare a model probability to a raw
     implied price — the hold alone looks like 2-4 points of "edge". */
  function devig(aOdds, bOdds) {
    const pa = americanToProb(aOdds), pb = americanToProb(bOdds);
    if (pa == null || pb == null) return null;
    const s = pa + pb;
    return { a: pa / s, b: pb / s, hold: s - 1 };
  }

  /* ── clock ────────────────────────────────────────────────────────── */
  function clockSec(display) {
    const s = String(display || '').trim();
    if (!s) return 0;
    if (s.includes(':')) { const [m, sec] = s.split(':'); return (parseInt(m, 10) || 0) * 60 + (parseFloat(sec) || 0); }
    return parseFloat(s) || 0;   // ESPN shows "19.4" under a minute
  }
  /* Minutes left in REGULATION (0 once in OT) and in the current period. */
  function timeLeft(period, secLeft) {
    const per = Math.max(1, period || 1);
    const periodMin = secLeft / 60;
    if (per <= 4) return { regMin: (4 - per) * Q_MIN + periodMin, periodMin, ot: false };
    return { regMin: 0, periodMin, ot: true };
  }
  /* What the model treats as "time remaining": regulation, or the OT period. */
  function modelMinutesLeft(period, secLeft) {
    const t = timeLeft(period, secLeft);
    return t.ot ? t.periodMin : t.regMin;
  }

  /* ── normalize the ESPN summary ───────────────────────────────────── */
  const STAT_KEYS = { minutes: 'min', points: 'pts', rebounds: 'reb', assists: 'ast', turnovers: 'to', steals: 'stl', blocks: 'blk', fouls: 'pf', plusMinus: 'pm', offensiveRebounds: 'oreb', defensiveRebounds: 'dreb' };
  function parseAthlete(a, keys) {
    const st = {};
    (a.stats || []).forEach((v, i) => {
      const k = keys[i];
      if (!k) return;
      if (k.includes('-')) {   // 'fieldGoalsMade-fieldGoalsAttempted' → "7-14"
        const [m, att] = String(v).split('-').map(x => parseInt(x, 10) || 0);
        const tag = k.startsWith('threePoint') ? 'tp' : k.startsWith('freeThrow') ? 'ft' : 'fg';
        st[tag + 'm'] = m; st[tag + 'a'] = att;
      } else if (STAT_KEYS[k]) st[STAT_KEYS[k]] = num(v) ?? 0;
    });
    const ath = a.athlete || {};
    return {
      id: String(ath.id), name: ath.displayName || ath.shortName || '?', short: ath.shortName || ath.displayName || '?',
      jersey: ath.jersey ?? '', pos: ath.position?.abbreviation || '', headshot: ath.headshot?.href || null,
      starter: !!a.starter, onCourt: !!a.active, dnp: !!a.didNotPlay, ejected: !!a.ejected, stats: st,
    };
  }

  function parsePregameLine(summary, homeId, awayId) {
    const pc = (summary.pickcenter || [])[0];
    if (!pc) return null;
    const homeFav = pc.homeTeamOdds?.favorite === true || (pc.awayTeamOdds?.favorite === false && pc.homeTeamOdds?.favorite !== false);
    const s = Math.abs(num(pc.spread) ?? NaN);
    return {
      provider: pc.provider?.name || 'Pregame',
      details: pc.details || '',
      homeMargin: Number.isFinite(s) ? (homeFav ? s : -s) : null,  // expected home margin
      total: num(pc.overUnder),
      homeML: num(pc.homeTeamOdds?.moneyLine), awayML: num(pc.awayTeamOdds?.moneyLine),
    };
  }

  function normalize(summary, league = 'nba') {
    const comp = summary?.header?.competitions?.[0];
    if (!comp) return null;
    const st = comp.status || {};
    const period = st.period || 0;
    const secLeft = clockSec(st.displayClock);
    const state = st.type?.state;   // 'pre' | 'in' | 'post'
    const teams = {};
    for (const c of comp.competitors || []) {
      teams[c.homeAway] = {
        id: String(c.team?.id), abbr: c.team?.abbreviation || '?', name: c.team?.displayName || c.team?.name || '',
        color: c.team?.color ? `#${c.team.color}` : null, alt: c.team?.alternateColor ? `#${c.team.alternateColor}` : null,
        logo: c.team?.logos?.[0]?.href || c.team?.logo || null,
        score: num(c.score) ?? 0, record: c.record?.[0]?.summary || '',
        linescores: (c.linescores || []).map(l => num(l.displayValue) ?? 0),
        timeouts: c.timeoutsRemaining ?? null, fouls: c.fouls || null, possession: c.possession === true,
        players: [],
      };
    }
    if (!teams.home || !teams.away) return null;
    const byTeamId = { [teams.home.id]: 'home', [teams.away.id]: 'away' };
    const playerIndex = {};
    for (const t of summary.boxscore?.players || []) {
      const side = byTeamId[String(t.team?.id)];
      const block = t.statistics?.[0];
      if (!side || !block) continue;
      teams[side].players = (block.athletes || []).map(a => parseAthlete(a, block.keys || []));
      for (const p of teams[side].players) playerIndex[p.id] = { ...p, side };
    }
    const plays = (summary.plays || []).map(p => normalizePlay(p, byTeamId, playerIndex));
    fixOnCourt(teams, plays, playerIndex);
    const wp = (summary.winprobability || []).map(w => num(w.homeWinPercentage)).filter(v => v != null);
    return {
      league, eventId: String(comp.id), state, live: state === 'in', final: state === 'post',
      period, clock: st.displayClock || '', secLeft, detail: st.type?.shortDetail || st.type?.detail || '',
      halftime: /half/i.test(st.type?.detail || '') || st.type?.name === 'STATUS_HALFTIME',
      endOfPeriod: st.type?.name === 'STATUS_END_PERIOD' || (state === 'in' && secLeft === 0),
      tipoff: comp.date || null, venue: summary.gameInfo?.venue?.fullName || '',
      home: teams.home, away: teams.away, players: playerIndex, plays,
      espnWinProb: wp, pregame: parsePregameLine(summary, teams.home.id, teams.away.id),
      receivedAt: Date.now(),
    };
  }

  /* ESPN's `active` flag lags a substitution for a poll or two, so a team can
     briefly show SIX on the floor (seen live, ORL @ SAC Q4). Resolve it with
     the play-by-play: "X enters the game for Y" → participants [X in, Y out];
     the most recent sub decides. Still too many → keep most minutes. */
  function fixOnCourt(teams, plays, playerIndex) {
    for (const side of ['home', 'away']) {
      const on = teams[side].players.filter(p => p.onCourt);
      if (on.length <= 5) continue;
      const last = {};
      for (let i = plays.length - 1; i >= 0; i--) {
        const p = plays[i];
        if (p.kind !== 'sub' || p.ids.length < 2) continue;
        if (!(p.ids[0] in last)) last[p.ids[0]] = 'in';
        if (!(p.ids[1] in last)) last[p.ids[1]] = 'out';
      }
      let extra = on.length - 5;
      for (const p of on) if (extra > 0 && last[p.id] === 'out') { p.onCourt = false; extra--; }
      if (extra > 0) on.filter(p => p.onCourt).sort((a, b) => (a.stats.min || 0) - (b.stats.min || 0)).slice(0, extra).forEach(p => { p.onCourt = false; });
      for (const p of teams[side].players) if (playerIndex[p.id]) playerIndex[p.id].onCourt = p.onCourt;
    }
  }

  const SENTINEL = c => !c || !Number.isFinite(c.x) || !Number.isFinite(c.y) || Math.abs(c.x) > 200 || Math.abs(c.y) > 200;
  function normalizePlay(p, byTeamId, playerIndex) {
    const typeText = String(p.type?.text || '').replace(/\s+/g, ' ').trim();
    const ids = (p.participants || []).map(x => String(x.athlete?.id));
    return {
      id: String(p.id), text: p.text || typeText, type: typeText,
      period: p.period?.number || 0, clock: p.clock?.displayValue || '',
      side: byTeamId[String(p.team?.id)] || null,
      scoring: !!p.scoringPlay, shooting: !!p.shootingPlay, value: num(p.scoreValue) ?? 0,
      awayScore: num(p.awayScore), homeScore: num(p.homeScore),
      coord: SENTINEL(p.coordinate) ? null : { x: p.coordinate.x, y: p.coordinate.y },
      ids, actorId: ids[0] || null, wallclock: p.wallclock || null,
      kind: classifyPlay(typeText, p),
    };
  }
  function classifyPlay(t, p) {
    if (/free throw/i.test(t)) return 'ft';
    if (p.shootingPlay) return 'shot';
    if (/rebound/i.test(t)) return /offensive/i.test(t) ? 'oreb' : 'dreb';
    if (/turnover|traveling|offensive foul|offensive charge|charge/i.test(t)) return 'to';
    if (/foul/i.test(t)) return 'foul';
    if (/substitution/i.test(t)) return 'sub';
    if (/timeout/i.test(t)) return 'timeout';
    if (/jump ?ball/i.test(t)) return 'jump';
    if (/end (period|game)|end of/i.test(t)) return 'end';
    return 'other';
  }
  const otherSide = s => s === 'home' ? 'away' : s === 'away' ? 'home' : null;

  /* Who has the ball. ESPN's header `possession` flag is authoritative when
     either side has it set; it is FALSE for both during timeouts and breaks,
     so we fall back to reading the latest decisive play. `team.id` on a play
     is the ACTING team (shooter, fouler, the one turning it over) — verified. */
  function inferPossession(data) {
    if (data.home.possession) return { side: 'home', source: 'espn' };
    if (data.away.possession) return { side: 'away', source: 'espn' };
    const plays = data.plays;
    for (let i = plays.length - 1; i >= 0; i--) {
      const p = plays[i];
      if (p.kind === 'end') return { side: null, source: 'period-break' };
      if (!p.side) continue;
      switch (p.kind) {
        case 'shot': return { side: p.scoring ? otherSide(p.side) : p.side, source: 'play' };
        case 'ft': {
          if (/technical|flagrant/i.test(p.type)) continue;   // ball stays with whoever had it
          const last = /(\d) of \1/.test(p.type);
          return { side: last && p.scoring ? otherSide(p.side) : p.side, source: 'play' };
        }
        case 'dreb': case 'oreb': return { side: p.side, source: 'play' };
        case 'to': return { side: otherSide(p.side), source: 'play' };
        case 'foul': return { side: otherSide(p.side), source: 'play' };
        case 'jump': return { side: p.side, source: 'play' };
        default: continue;   // subs, timeouts, reviews don't change possession
      }
    }
    return { side: null, source: 'none' };
  }

  /* ── court geometry ───────────────────────────────────────────────────
     Display frame: full court 94 × 50 ft, X along the length, Y across.
     Baskets at X = 5.25 (left) and 88.75 (right). Fixed convention: AWAY
     attacks the LEFT basket, HOME the RIGHT, every period. (ESPN does not
     say which end a team starts at; a fixed convention is honest and stable,
     and the UI labels it.) */
  const COURT = { L: 94, W: 50, leftHoop: 5.25, rightHoop: 88.75 };
  function attackEnd(side) { return side === 'home' ? 'right' : 'left'; }
  /* ESPN half-court coordinate (x across, y = ft out from the rim) → display. */
  function toCourt(c, end) {
    if (!c) return null;
    const out = clamp(c.y - 0.25, -5, 47);
    return end === 'right'
      ? { X: COURT.rightHoop - out, Y: clamp(c.x, 0, 50) }
      : { X: COURT.leftHoop + out, Y: clamp(50 - c.x, 0, 50) };
  }

  /* Formation spots in ESPN half-court coords (x across, y out from rim).
     Interior-first assignment with a G/F/C preference chain — same idea as
     the WNBA court (positions are coarse; small-ball fives would otherwise
     strand a guard at the rim). */
  const OFFENSE_SLOTS = [
    { key: 'dunker', at: { x: 31, y: 3 },  pref: ['C', 'F', 'G'] },
    { key: 'corner', at: { x: 3, y: 2 },   pref: ['F', 'G', 'C'] },
    { key: 'wingL',  at: { x: 8, y: 18 },  pref: ['F', 'G', 'C'] },
    { key: 'wingR',  at: { x: 42, y: 19 }, pref: ['G', 'F', 'C'] },
    { key: 'top',    at: { x: 25, y: 25 }, pref: ['G', 'F', 'C'] },
  ];
  const posGroup = pos => /C/.test(pos) ? 'C' : /F/.test(pos) ? 'F' : 'G';
  function assignSlots(five) {
    const left = five.slice();
    const out = {};
    for (const slot of OFFENSE_SLOTS) {
      let idx = -1;
      for (const g of slot.pref) { idx = left.findIndex(p => posGroup(p.pos) === g); if (idx >= 0) break; }
      if (idx < 0) idx = left.length ? 0 : -1;
      if (idx >= 0) out[left.splice(idx, 1)[0].id] = slot;
    }
    return out;
  }

  /* Place all ten players. Offense spreads in the half it attacks; each
     defender sits between his matched man (same slot) and the basket. The
     acting player of the latest located event is moved to the REAL spot.
     Returns [{ id, side, X, Y, role: 'off'|'def'|'actor', tracked }]. */
  function layout(data, poss, lastEvent) {
    const offense = poss?.side || null;
    const fives = { home: data.home.players.filter(p => p.onCourt), away: data.away.players.filter(p => p.onCourt) };
    const out = [];
    const slotsBy = { home: assignSlots(fives.home), away: assignSlots(fives.away) };
    // With no possession (period break / pre-tip) each team sets up in the
    // half it attacks, no defenders — a neutral "both fives" picture.
    for (const side of ['away', 'home']) {
      const attacking = offense == null || offense === side;
      const end = attackEnd(offense == null ? side : offense);
      for (const p of fives[side]) {
        const slot = slotsBy[side][p.id] || OFFENSE_SLOTS[4];
        let spot = slot.at;
        if (!attacking) {   // defender: 30% of the way from his man toward the rim
          spot = { x: slot.at.x + (25 - slot.at.x) * 0.3, y: slot.at.y * 0.7 + 0.6 };
        }
        const pos = toCourt(spot, end);
        out.push({ id: p.id, side, X: pos.X, Y: pos.Y, role: attacking ? 'off' : 'def', tracked: false });
      }
    }
    // Move the acting player of the newest located event to its real spot.
    if (lastEvent?.court && lastEvent.actorId) {
      const tok = out.find(t => t.id === lastEvent.actorId);
      if (tok) { tok.X = lastEvent.court.X; tok.Y = lastEvent.court.Y; tok.role = 'actor'; tok.tracked = true; }
    }
    // Separate tokens that collide (formation spot under a real event spot).
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j], dx = b.X - a.X, dy = b.Y - a.Y, d = Math.hypot(dx, dy);
      if (d < 4.6) {
        const push = (4.6 - d) / 2, ux = d ? dx / d : 1, uy = d ? dy / d : 0;
        const mv = t => !t.tracked;
        if (mv(a)) { a.X -= ux * push * (mv(b) ? 1 : 2); a.Y -= uy * push * (mv(b) ? 1 : 2); }
        if (mv(b)) { b.X += ux * push * (mv(a) ? 1 : 2); b.Y += uy * push * (mv(a) ? 1 : 2); }
      }
    }
    for (const t of out) { t.X = clamp(t.X, 1.5, COURT.L - 1.5); t.Y = clamp(t.Y, 1.5, COURT.W - 1.5); }
    return out;
  }

  /* Which team to draw as the offense. Usually whoever has the ball — but
     right after a made basket or a defensive rebound every player is still
     at the end where it happened, so the court shows THAT moment (the old
     offense still set up there) and glides to the other end on the next
     play. The scoreboard's possession arrow keeps showing the true owner. */
  function layoutPossession(poss, lastEvent) {
    if (lastEvent?.court && lastEvent.side) {
      if (lastEvent.kind === 'dreb') return { side: otherSide(lastEvent.side), source: 'event-moment' };
      if (lastEvent.kind === 'shot' || lastEvent.kind === 'oreb' || lastEvent.kind === 'ft') return { side: lastEvent.side, source: 'event-moment' };
    }
    return poss;
  }

  /* The newest play worth drawing on the floor, mapped to display coords. */
  function lastLocatedEvent(data) {
    for (let i = data.plays.length - 1; i >= 0; i--) {
      const p = data.plays[i];
      if (p.kind === 'end') return null;
      if (!p.side || !p.actorId) continue;
      if (p.kind === 'shot' && p.coord) return { ...p, court: toCourt(p.coord, attackEnd(p.side)) };
      if (p.kind === 'ft') return { ...p, court: toCourt({ x: 25, y: 13.9 }, attackEnd(p.side)) };
      if ((p.kind === 'dreb' || p.kind === 'oreb') && p.coord) {
        // ESPN stamps the rebound with the MISSED SHOT's location, not where
        // the board was grabbed. Put the rebounder ~35% of the way from the
        // rim toward that spot — an estimate, flagged `estimated`.
        const shooterSide = p.kind === 'dreb' ? otherSide(p.side) : p.side;
        const c = { x: 25 + (p.coord.x - 25) * 0.35, y: 0.25 + (p.coord.y - 0.25) * 0.35 + 2 };
        return { ...p, estimated: true, court: toCourt(c, attackEnd(shooterSide)) };
      }
      if (p.kind === 'to' || p.kind === 'foul' || p.kind === 'sub' || p.kind === 'timeout') return { ...p, court: null };
    }
    return null;
  }

  /* Recent located shots for the trail on the floor. */
  function shotTrail(data, n = 14) {
    const out = [];
    for (let i = data.plays.length - 1; i >= 0 && out.length < n; i--) {
      const p = data.plays[i];
      if (p.kind === 'shot' && p.coord && p.side) out.push({ id: p.id, side: p.side, made: p.scoring, value: p.value, court: toCourt(p.coord, attackEnd(p.side)), text: p.text });
    }
    return out.reverse();
  }

  /* ── GAME MODEL ───────────────────────────────────────────────────── */

  /* σ that makes Normal(spread, σ) reproduce the pregame de-vigged ML.
     P(home win) = Φ(homeMargin / σ)  ⇒  σ = homeMargin / Φ⁻¹(P). */
  function calibrateSigma(pregame) {
    if (!pregame || pregame.homeMargin == null) return { sigma: DEFAULT_SIGMA, source: 'default' };
    const fair = devig(pregame.homeML, pregame.awayML);
    // Near pick'em the ratio margin / Φ⁻¹(p) divides by ~0 and explodes
    // (OKC -1.5 at -117/-101 calibrated to σ≈26). Only calibrate on 3+ point lines.
    if (!fair || Math.abs(pregame.homeMargin) < 3) return { sigma: DEFAULT_SIGMA, source: 'default' };
    const z = invPhi(fair.a);
    if (!Number.isFinite(z) || Math.abs(z) < 0.03 || Math.sign(z) !== Math.sign(pregame.homeMargin)) return { sigma: DEFAULT_SIGMA, source: 'default' };
    return { sigma: clamp(pregame.homeMargin / z, SIGMA_MIN, SIGMA_MAX), source: 'pregame' };
  }

  /* Price the current game state. Returns everything the UI and the move
     builder need, plus `inputs` so every number on screen is reproducible. */
  function priceGame(data) {
    const pre = data.pregame || {};
    const { sigma, source: sigmaSource } = calibrateSigma(pre);
    const homeMarginPre = pre.homeMargin ?? DEFAULT_HOME_EDGE;
    const totalPre = pre.total ?? DEFAULT_TOTAL;
    const t = timeLeft(data.period, data.secLeft);
    const final = data.final;
    const minLeft = final ? 0 : (data.state === 'pre' ? REG_MIN : modelMinutesLeft(data.period, data.secLeft));
    const elapsed = data.state === 'pre' ? 0 : t.ot ? REG_MIN + (data.period - 5) * OT_MIN + (OT_MIN - t.periodMin) : REG_MIN - t.regMin;
    const margin = data.home.score - data.away.score;           // home perspective
    const total = data.home.score + data.away.score;
    const fullGameMin = t.ot ? OT_MIN : REG_MIN;                 // strength drift is per regulation minute
    const driftPerMin = homeMarginPre / REG_MIN;
    const remMarginMean = driftPerMin * minLeft;
    const remMarginSd = sigma * Math.sqrt(minLeft / REG_MIN);

    const preRate = totalPre / REG_MIN;
    const livePace = elapsed > 0.5 ? total / elapsed : preRate;
    const w = elapsed / (elapsed + PACE_PRIOR_MIN);
    const rate = w * livePace + (1 - w) * preRate;
    const remTotalMean = rate * minLeft;
    const remTotalSd = TOTAL_SIGMA * Math.sqrt(minLeft / REG_MIN);

    // P(home wins). A regulation tie goes to OT, modelled as a 5-minute
    // game with the same drift — Φ handles the ±0.5 continuity both ways.
    let pHome;
    if (final) pHome = margin > 0 ? 1 : 0;
    else if (minLeft <= 0.001) pHome = margin > 0 ? 1 : margin < 0 ? 0 : phi(driftPerMin * OT_MIN / (sigma * Math.sqrt(OT_MIN / REG_MIN)));
    else {
      const sd = remMarginSd;
      const pWinReg = 1 - phi((-margin + 0.5 - remMarginMean) / sd);
      const pTie = phi((-margin + 0.5 - remMarginMean) / sd) - phi((-margin - 0.5 - remMarginMean) / sd);
      const pOT = phi(driftPerMin * OT_MIN / (sigma * Math.sqrt(OT_MIN / REG_MIN)));
      pHome = pWinReg + pTie * pOT;
    }

    // Final home margin > -line  (home covering `homeLine`, e.g. -5.5)
    const pHomeCover = homeLine => {
      if (final) return margin + homeLine > 0 ? 1 : 0;
      if (minLeft <= 0.001) return margin + homeLine > 0 ? 1 : 0;
      return 1 - phi((-homeLine - margin - remMarginMean) / remMarginSd);
    };
    const pOver = line => {
      if (final || minLeft <= 0.001) return total > line ? 1 : 0;
      return 1 - phi((line - total - remTotalMean) / remTotalSd);
    };

    return {
      pHome, pAway: 1 - pHome, pHomeCover, pOver,
      projMargin: margin + remMarginMean, projTotal: total + remTotalMean,
      projHome: data.home.score + (remTotalMean + remMarginMean) / 2,
      projAway: data.away.score + (remTotalMean - remMarginMean) / 2,
      inputs: {
        minLeft, elapsed, margin, total, sigma, sigmaSource, homeMarginPre, totalPre,
        preRate, livePace, paceWeight: w, rate, remMarginMean, remMarginSd, remTotalMean, remTotalSd, fullGameMin,
      },
    };
  }

  /* ── live market (DraftKings via ESPN core) ───────────────────────── */
  function parseLiveOdds(json) {
    const items = json?.items || [];
    const pick = items.find(i => /live/i.test(i.provider?.name || '')) || null;
    const pre = items.find(i => !/live/i.test(i.provider?.name || '')) || null;
    const shape = it => it && {
      provider: it.provider?.name || '?',
      details: it.details || '',
      total: num(it.overUnder), overOdds: num(it.overOdds), underOdds: num(it.underOdds),
      homeML: num(it.homeTeamOdds?.moneyLine), awayML: num(it.awayTeamOdds?.moneyLine),
      homeSpread: (() => {   // home line, e.g. -7.5 when home is favoured
        const s = Math.abs(num(it.spread) ?? NaN);
        if (!Number.isFinite(s)) return null;
        const hf = it.homeTeamOdds?.favorite, af = it.awayTeamOdds?.favorite;
        const homeFav = hf === true || af === false ? true : hf === false || af === true ? false
          : (num(it.homeTeamOdds?.moneyLine) ?? 0) < (num(it.awayTeamOdds?.moneyLine) ?? 0);
        return homeFav ? -s : s;
      })(),
      homeSpreadOdds: num(it.homeTeamOdds?.spreadOdds) ?? -110,
      awaySpreadOdds: num(it.awayTeamOdds?.spreadOdds) ?? -110,
    };
    return { live: shape(pick), pregame: shape(pre) };
  }

  /* ── HOW OFTEN THE LINE MOVES — measured, not assumed ──────────────
     ESPN's "DraftKings - Live Odds" row for the NBA refreshes at QUARTER
     BREAKS, not continuously. 15s poll, Nov 10 2026:
       OKC @ POR  2:35 Q1 (21-22) → End of 1st (27-26): -1.5 / 226.5 / -120 +(-110)
                  ~4 min into the break:               -2.5 / 223.5 / -145 / +110  ← the ONLY move
       ORL @ SAC  6:28 Q3 ORL +3 → 2:38 Q3 ORL +9 (a 9-0 run): -7.5 / 213.5 / -425, unchanged
     DraftKings' real price certainly moved during that run; ESPN's copy did
     not. So mid-quarter, model-vs-this-number is mostly the model pricing a
     run the printed line hasn't caught up with — ~15 points of FAKE edge
     after every run. That is why a move is only shown when the line is
     known to describe the current state (see `lineIsCurrent`).

     ESPN's row carries no lastModified, so we fingerprint it and record the
     GAME STATE at the moment we saw it change. A line first seen on page
     load has unknown age (`seenChange: false`). */
  const _oddsSeen = new Map();   // eventId → { fp, since, seenChange, state }
  const _stateOf = d => d ? { period: d.period, secLeft: d.secLeft, home: d.home.score, away: d.away.score } : null;
  function stampOdds(eventId, live, data, now = Date.now()) {
    if (!live) return null;
    const fp = [live.details, live.total, live.homeML, live.awayML, live.overOdds, live.underOdds].join('|');
    const prev = _oddsSeen.get(eventId);
    if (!prev) _oddsSeen.set(eventId, { fp, since: now, seenChange: false, state: _stateOf(data) });
    else if (prev.fp !== fp) _oddsSeen.set(eventId, { fp, since: now, seenChange: true, state: _stateOf(data) });
    const cur = _oddsSeen.get(eventId);
    return { ...live, ageSec: Math.round((now - cur.since) / 1000), seenChange: cur.seenChange, postedState: cur.state };
  }
  /* Is the printed line a price for the game AS IT IS NOW? True at a break
     (that is when it reprices), or when we watched it change and neither
     the score nor more than ~30s of clock has moved since. */
  function lineIsCurrent(data, live) {
    if (!live) return { current: false, reason: 'no-line' };
    const atBreak = data.halftime || data.endOfPeriod;
    const s = live.postedState;
    const sameState = s && s.home === data.home.score && s.away === data.away.score && s.period === data.period && Math.abs(s.secLeft - data.secLeft) <= 30;
    if (live.seenChange && sameState) return { current: true, reason: 'fresh' };
    if (atBreak && live.seenChange) return { current: true, reason: 'break' };
    if (atBreak) return { current: false, reason: 'break-unconfirmed' };
    return { current: false, reason: live.seenChange ? 'lagging' : 'unknown-age' };
  }
  /* Fair prices from the model right now, at the market's own numbers, so a
     user can compare against the line in their sportsbook app. */
  function fairBoard(data, price, live) {
    const h = data.home.abbr, a = data.away.abbr, rows = [];
    rows.push({ label: `${a} moneyline`, p: price.pAway }, { label: `${h} moneyline`, p: price.pHome });
    const sp = live?.homeSpread ?? (data.pregame?.homeMargin != null ? -Math.round(data.pregame.homeMargin * 2) / 2 : null);
    if (sp != null) {
      const pH = price.pHomeCover(sp);
      rows.push({ label: `${a} ${fmtLine(-sp)}`, p: 1 - pH }, { label: `${h} ${fmtLine(sp)}`, p: pH });
    }
    const tl = live?.total ?? data.pregame?.total;
    if (tl != null) { const pO = price.pOver(tl); rows.push({ label: `Over ${tl}`, p: pO }, { label: `Under ${tl}`, p: 1 - pO }); }
    return rows.map(r => ({ ...r, fair: probToAmerican(clamp(r.p, 0.005, 0.995)) }));
  }

  /* ── MOVES — model vs the de-vigged live line ─────────────────────── */
  function kellyQuarter(p, american) {
    const dec = americanToDecimal(american);
    if (!dec || !(p > 0)) return 0;
    const b = dec - 1, f = (b * p - (1 - p)) / b;
    return Math.max(0, f / 4);
  }
  function buildMoves(data, price, market) {
    const out = [], notes = [];
    if (!market || data.state !== 'in') return { moves: out, notes };
    const { minLeft } = price.inputs;
    const status = lineIsCurrent(data, market);
    // A line we can't tie to the current game state is not compared at all —
    // the "edge" would be the model pricing a run the number hasn't seen.
    if (!status.current) return { moves: out, notes, lineStatus: status };
    const stale = market.ageSec != null && market.ageSec > STALE_SEC && !(data.halftime || data.endOfPeriod);
    const deadBall = data.halftime || data.endOfPeriod || /timeout/.test(data.plays.at(-1)?.kind || '');
    const push = (m) => {
      const edgePts = (m.model - m.fair) * 100;
      if (Math.abs(edgePts) >= ABSURD_EDGE_PTS) {   // no live market is 20 points wrong — something upstream is
        notes.push(`${m.label}: model ${(m.model * 100).toFixed(0)}% vs market ${(m.fair * 100).toFixed(0)}% is too large to be real — likely a stale or mis-parsed line. Not shown as a play.`);
        return;
      }
      if (edgePts < MIN_EDGE_PTS) return;
      const dec = americanToDecimal(m.price);
      const ev = m.model * dec - 1;
      if (ev <= 0) return;
      let confidence = edgePts >= 7 ? 'HIGH' : edgePts >= 4.5 ? 'MED' : 'LOW';
      const caveats = [];
      if (stale) { confidence = 'LOW'; caveats.push(`This line has not changed in ${Math.round(market.ageSec / 60)}+ min — it may be frozen, not mispriced.`); }
      if (minLeft < 2) { confidence = 'LOW'; caveats.push('Under 2 minutes: intentional fouls and timeouts make the last minutes swingier than a smooth model assumes.'); }
      if (!deadBall && confidence === 'HIGH') { confidence = 'MED'; caveats.push('Ball is live — the book reprices faster than this feed. Best checked at a timeout or quarter break.'); }
      out.push({ ...m, edgePts, ev, kelly: kellyQuarter(m.model, m.price), confidence, caveats, fairOdds: probToAmerican(m.model) });
    };

    const h = data.home.abbr, a = data.away.abbr;
    const ml = devig(market.homeML, market.awayML);
    if (ml) {
      push({ market: 'ML', side: 'home', label: `${h} moneyline`, price: market.homeML, model: price.pHome, fair: ml.a, hold: ml.hold,
        why: `Model ${pct(price.pHome)} vs DraftKings ${pct(ml.a)} after removing the ${(ml.hold * 100).toFixed(1)}% hold.` });
      push({ market: 'ML', side: 'away', label: `${a} moneyline`, price: market.awayML, model: price.pAway, fair: ml.b, hold: ml.hold,
        why: `Model ${pct(price.pAway)} vs DraftKings ${pct(ml.b)} after removing the ${(ml.hold * 100).toFixed(1)}% hold.` });
    }
    if (market.homeSpread != null) {
      const sp = devig(market.homeSpreadOdds, market.awaySpreadOdds);
      if (sp) {
        const pH = price.pHomeCover(market.homeSpread);
        const line = market.homeSpread;
        push({ market: 'SPREAD', side: 'home', line, label: `${h} ${fmtLine(line)}`, price: market.homeSpreadOdds, model: pH, fair: sp.a, hold: sp.hold,
          why: `Projected final margin ${h} ${fmtSigned(price.projMargin)}; ${h} covers ${fmtLine(line)} ${pct(pH)} of the time.` });
        push({ market: 'SPREAD', side: 'away', line: -line, label: `${a} ${fmtLine(-line)}`, price: market.awaySpreadOdds, model: 1 - pH, fair: sp.b, hold: sp.hold,
          why: `Projected final margin ${h} ${fmtSigned(price.projMargin)}; ${a} covers ${fmtLine(-line)} ${pct(1 - pH)} of the time.` });
      }
    }
    if (market.total != null) {
      const tt = devig(market.overOdds ?? -110, market.underOdds ?? -110);
      if (tt) {
        const pO = price.pOver(market.total);
        push({ market: 'TOTAL', side: 'over', line: market.total, label: `Over ${market.total}`, price: market.overOdds ?? -110, model: pO, fair: tt.a, hold: tt.hold,
          why: `Projected final total ${price.projTotal.toFixed(1)} (pace ${(price.inputs.livePace * 48).toFixed(0)}/48 live, ${price.inputs.totalPre} pregame).` });
        push({ market: 'TOTAL', side: 'under', line: market.total, label: `Under ${market.total}`, price: market.underOdds ?? -110, model: 1 - pO, fair: tt.b, hold: tt.hold,
          why: `Projected final total ${price.projTotal.toFixed(1)} (pace ${(price.inputs.livePace * 48).toFixed(0)}/48 live, ${price.inputs.totalPre} pregame).` });
      }
    }
    out.sort((x, y) => y.ev - x.ev);
    return { moves: out, notes, stale, deadBall, lineStatus: status };
  }
  const pct = p => `${(p * 100).toFixed(1)}%`;
  const fmtLine = l => (l > 0 ? `+${l}` : `${l}`);
  const fmtSigned = v => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1));

  /* ── PLAYER PROJECTIONS ───────────────────────────────────────────── */
  const PROP_STATS = [
    { key: 'pts', label: 'PTS' }, { key: 'reb', label: 'REB' }, { key: 'ast', label: 'AST' },
    { key: 'tpm', label: '3PM' }, { key: 'pra', label: 'PRA' },
  ];
  function statOf(stats, key) {
    if (key === 'pra') return (stats.pts || 0) + (stats.reb || 0) + (stats.ast || 0);
    return stats[key] || 0;
  }
  /* Expected minutes still to come for one player, and why. */
  function remainingMinutes(player, season, data, price) {
    const minLeft = price.inputs.minLeft;
    if (data.final || minLeft <= 0) return { min: 0, reasons: [] };
    if (player.ejected) return { min: 0, reasons: ['Ejected'] };
    const mpg = season?.mpg ?? (player.starter ? 30 : 16);
    const t = timeLeft(data.period, data.secLeft);
    const gameLen = t.ot ? OT_MIN : REG_MIN;
    let min = (mpg / REG_MIN) * (t.ot ? minLeft * (player.onCourt ? 1.4 : 0.6) : minLeft);   // OT: rotation tightens
    min = Math.min(min, minLeft);
    const reasons = [];
    const pf = player.stats.pf || 0;
    if (pf >= 6) return { min: 0, reasons: ['Fouled out'] };
    if (pf >= 5) { min *= 0.6; reasons.push('5 fouls — playing carefully'); }
    else if (pf >= 4 && data.period <= 3) { min *= 0.85; reasons.push('4 fouls before the 4th'); }
    const blowout = Math.abs(price.inputs.margin);
    if ((data.period >= 4 && blowout >= 20) || (data.period === 3 && blowout >= 28)) {
      if (mpg >= 24) { min *= 0.4; reasons.push(`Blowout (${blowout} pts) — starters likely to sit`); }
      else { min *= 1.3; reasons.push(`Blowout (${blowout} pts) — bench minutes go up`); }
    }
    return { min: Math.max(0, Math.min(min, minLeft)), reasons, gameLen };
  }

  /* Project one stat. Rate = season per-minute rate blended with tonight's,
     tonight weighted min/(min+36) — one game is very noisy. */
  function projectStat(player, season, key, data, price) {
    const cur = statOf(player.stats, key);
    const curMin = player.stats.min || 0;
    const rem = remainingMinutes(player, season, data, price);
    const seasonRate = season?.rates ? statOf(season.rates, key) : null;
    const liveRate = curMin > 0 ? cur / curMin : null;
    let rate;
    if (seasonRate != null && liveRate != null) { const w = curMin / (curMin + RATE_PRIOR_MIN); rate = w * liveRate + (1 - w) * seasonRate; }
    else rate = seasonRate ?? liveRate ?? 0;
    const remMean = rate * rem.min;
    return { key, cur, curMin, remMin: rem.min, minReasons: rem.reasons, seasonRate, liveRate, rate, remMean, proj: cur + remMean, seasonAvg: season?.avg ? statOf(season.avg, key) : null };
  }
  /* P(final ≥ ceil(line)) for an over/under line like 24.5. */
  function probOver(proj, line) {
    const need = Math.floor(line) + 1 - proj.cur;   // more needed to clear the line
    if (need <= 0) return 1;
    const mu = proj.remMean;
    if (mu <= 0) return 0;
    if (proj.key === 'pts' || proj.key === 'pra') {
      const v = (proj.key === 'pts' ? PTS_VAR_FACTOR : 1.6) * mu;
      return 1 - phi((need - 0.5 - mu) / Math.sqrt(v));
    }
    return poissonSf(need, mu);
  }
  /* A sensible default line: floor of his season average + .5. */
  function defaultLine(proj) {
    const base = proj.seasonAvg ?? proj.proj;
    return Math.max(0.5, Math.floor(base) + 0.5);
  }

  /* ── season rates (gamelog Totals row; one call per player, cached) ── */
  const _seasonCache = new Map();
  function seasonYear(d = new Date()) { return d.getMonth() >= 9 ? d.getFullYear() + 1 : d.getFullYear(); }
  function parseTotals(json) {
    const names = json?.names || [];
    const st = (json?.seasonTypes || []).find(s => /regular/i.test(s.displayName || '')) || null;
    const tot = st?.summary?.stats?.find(s => s.type === 'total')?.stats;
    if (!tot) return null;
    const v = {};
    names.forEach((n, i) => {
      if (n.includes('-')) { const [m, a] = String(tot[i]).split('-').map(x => parseFloat(x) || 0); v[n.split('-')[0]] = m; v[n.split('-')[1]] = a; }
      else v[n] = parseFloat(tot[i]) || 0;
    });
    const games = (st.categories || []).reduce((s, c) => s + (c.events || []).length, 0);
    return { min: v.minutes || 0, pts: v.points || 0, reb: v.totalRebounds || 0, ast: v.assists || 0, tpm: v.threePointFieldGoalsMade || 0, games };
  }
  async function fetchSeason(playerId, league = 'nba', fetcher = root.fetch) {
    const key = `${league}:${playerId}`;
    if (_seasonCache.has(key)) return _seasonCache.get(key);
    const job = (async () => {
      const get = async yr => {
        try { const r = await fetcher(`${ESPN_WEB}/${league}/athletes/${playerId}/gamelog?season=${yr}`); return r.ok ? parseTotals(await r.json()) : null; }
        catch { return null; }
      };
      const yr = seasonYear();
      let cur = await get(yr);
      let used = 'this season';
      // Early season: a few games is a noisy rate. Pool with last season.
      if (!cur || cur.min < 150) {
        const prev = await get(yr - 1);
        if (prev && prev.min > 0) { cur = cur ? { min: cur.min + prev.min, pts: cur.pts + prev.pts, reb: cur.reb + prev.reb, ast: cur.ast + prev.ast, tpm: cur.tpm + prev.tpm, games: cur.games + prev.games } : prev; used = 'this + last season'; }
      }
      if (!cur || cur.min <= 0 || !cur.games) return null;
      const per = k => cur[k] / cur.min, avg = k => cur[k] / cur.games;
      return { mpg: cur.min / cur.games, games: cur.games, sample: used,
        rates: { pts: per('pts'), reb: per('reb'), ast: per('ast'), tpm: per('tpm') },
        avg: { pts: avg('pts'), reb: avg('reb'), ast: avg('ast'), tpm: avg('tpm') } };
    })();
    _seasonCache.set(key, job);
    job.then(v => { if (!v) _seasonCache.delete(key); });
    return job;
  }
  async function fetchSeasons(ids, league = 'nba', onEach) {
    const queue = ids.slice(); const out = {};
    const worker = async () => { while (queue.length) { const id = queue.shift(); out[id] = await fetchSeason(id, league); onEach?.(id, out[id]); } };
    await Promise.all(Array.from({ length: 6 }, worker));
    return out;
  }

  /* ── poller: one serial request chain per game per page ───────────── */
  const _channels = new Map();
  function subscribe(eventId, league, listener) {
    const id = String(eventId);
    if (!/^\d+$/.test(id)) throw new Error('Invalid NBA event id');
    const key = `${league}:${id}`;
    let ch = _channels.get(key);
    if (!ch) {
      const listeners = new Set();
      let timer, latest = {}, stopped = false, busy = false, failures = 0, lastOddsAt = 0;
      const emit = u => { latest = { ...latest, ...u }; listeners.forEach(fn => fn(latest)); };
      const fetchJson = async (url, ms = 10000) => {
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), ms);
        try { const r = await root.fetch(url, { cache: 'no-store', signal: ctl.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
        finally { clearTimeout(to); }
      };
      async function load() {
        if (stopped || busy) return;
        if (root.document?.hidden) { timer = setTimeout(load, 2000); return; }
        busy = true; clearTimeout(timer);
        let interval = 5000;
        try {
          const wantOdds = Date.now() - lastOddsAt > 12000;
          const [summary, oddsJson] = await Promise.all([
            fetchJson(`${ESPN_SITE}/${league}/summary?event=${id}`),
            wantOdds ? fetchJson(`${ESPN_CORE}/${league}/events/${id}/competitions/${id}/odds`).catch(() => null) : Promise.resolve(undefined),
          ]);
          const data = normalize(summary, league);
          if (!data) throw new Error('Empty summary');
          let market = latest.market || null;
          if (oddsJson !== undefined) {
            lastOddsAt = Date.now();
            const parsed = oddsJson ? parseLiveOdds(oddsJson) : null;
            market = parsed ? { live: stampOdds(id, parsed.live, data), pregame: parsed.pregame } : market;
          } else if (market?.live) market = { ...market, live: stampOdds(id, market.live, data) };
          failures = 0;
          interval = data.final ? 120000 : data.live ? 5000 : 30000;
          emit({ data, market, status: 'connected', interval, checkedAt: Date.now() });
        } catch (e) {
          interval = Math.min(60000, 5000 * 2 ** Math.min(++failures, 4));
          emit({ status: 'reconnecting', interval, error: String(e?.message || e) });
        } finally {
          busy = false;
          if (!stopped) timer = setTimeout(load, interval);
        }
      }
      const onVis = () => { if (!root.document?.hidden) { clearTimeout(timer); load(); } };
      ch = {
        listeners, latest: () => latest,
        start() { root.document?.addEventListener?.('visibilitychange', onVis); load(); },
        stop() { stopped = true; clearTimeout(timer); root.document?.removeEventListener?.('visibilitychange', onVis); _channels.delete(key); },
        refresh() { clearTimeout(timer); lastOddsAt = 0; load(); },
      };
      _channels.set(key, ch);
      ch.start();
    }
    ch.listeners.add(listener);
    if (ch.latest().data || ch.latest().status) listener(ch.latest());
    return {
      unsubscribe() { ch.listeners.delete(listener); if (!ch.listeners.size) ch.stop(); },
      refresh() { ch.refresh(); },
    };
  }

  /* ── self-test: properties that must hold, not remembered numbers ─── */
  function selfTest() {
    const results = [];
    const ok = (name, cond, detail = '') => results.push({ name, pass: !!cond, detail });
    const mk = (o = {}) => ({
      state: 'in', final: false, period: o.period ?? 1, secLeft: o.sec ?? 720,
      home: { score: o.h ?? 0, abbr: 'HOM', players: [] }, away: { score: o.a ?? 0, abbr: 'AWY', players: [] },
      pregame: o.pre === undefined ? { homeMargin: 5.5, total: 222.5, homeML: -217, awayML: 180 } : o.pre, plays: [],
    });
    // 1. σ calibration reproduces DK's own pregame conversion
    const cal = calibrateSigma({ homeMargin: 5.5, homeML: -217, awayML: 180 });
    const pTip = priceGame({ ...mk(), state: 'pre' }).pHome;
    const fairTip = devig(-217, 180).a;
    ok('tip-off P(home) equals de-vigged pregame ML', Math.abs(pTip - fairTip) < 0.01, `${pTip.toFixed(4)} vs ${fairTip.toFixed(4)} (σ=${cal.sigma.toFixed(2)})`);
    ok('σ in plausible NBA range', cal.sigma > 11 && cal.sigma < 15, cal.sigma.toFixed(2));
    // 2. pick'em with no time left and tied → OT favourite only by drift
    const even = priceGame(mk({ pre: { homeMargin: 0, total: 220, homeML: -110, awayML: -110 }, period: 2, sec: 0, h: 50, a: 50 }));
    ok('pick-em tied at half ≈ 50%', Math.abs(even.pHome - 0.5) < 0.005, even.pHome.toFixed(4));
    // 3. monotonic in lead
    const p = [0, 3, 6, 10].map(l => priceGame(mk({ period: 3, sec: 300, h: 70 + l, a: 70 })).pHome);
    ok('P(home) rises with the lead', p.every((v, i) => i === 0 || v > p[i - 1]), p.map(v => v.toFixed(3)).join(' < '));
    // 4. same lead is worth more with less time
    const early = priceGame(mk({ period: 1, sec: 600, h: 10, a: 4 })).pHome;
    const late = priceGame(mk({ period: 4, sec: 60, h: 100, a: 94 })).pHome;
    ok('6-pt lead worth more late than early', late > early && late > 0.95, `${early.toFixed(3)} → ${late.toFixed(3)}`);
    // 5. trailing by 3 with 1 sec, no possession model → near-certain loss
    const lost = priceGame(mk({ period: 4, sec: 1, h: 97, a: 100 })).pHome;
    ok('down 3 with 1s left < 2%', lost < 0.02, lost.toFixed(4));
    // 6. totals: projection ≈ pregame total at tip, current total when final
    const pt = priceGame({ ...mk(), state: 'pre' });
    ok('tip projected total = pregame total', Math.abs(pt.projTotal - 222.5) < 1e-9, pt.projTotal.toFixed(2));
    ok('P(over pregame total) at tip = 50%', Math.abs(pt.pOver(222.5) - 0.5) < 1e-9, pt.pOver(222.5).toFixed(4));
    const fin = priceGame({ ...mk({ h: 110, a: 104 }), state: 'post', final: true });
    ok('final settles ML/total exactly', fin.pHome === 1 && fin.pOver(213.5) === 1 && fin.pOver(214.5) === 0, '');
    // 7. home cover + away cover = 1; spread at the projected margin ≈ 50%
    const mid = priceGame(mk({ period: 3, sec: 400, h: 60, a: 55 }));
    const line = -Math.round(mid.projMargin * 2) / 2;
    const c = mid.pHomeCover(line);
    ok('cover prob near 50% at the projected margin', Math.abs(c - 0.5) < 0.05, `${line} → ${c.toFixed(3)}`);
    // 8. de-vig sums to 1 and removes hold
    const dv = devig(-425, 310);
    ok('de-vig sums to 1', Math.abs(dv.a + dv.b - 1) < 1e-12, `hold ${(dv.hold * 100).toFixed(2)}%`);
    ok('american ↔ prob round trip', Math.abs(americanToProb(probToAmerican(0.7)) - 0.7) < 0.002 && Math.abs(americanToProb(probToAmerican(0.3)) - 0.3) < 0.002, '');
    // 9. coordinate mapping: rim → hoop, 3-pt top → 23.75 ft out
    const rimL = toCourt({ x: 25, y: 0.25 }, 'left'), rimR = toCourt({ x: 25, y: 0.25 }, 'right');
    ok('rim maps to the hoop on each end', Math.abs(rimL.X - COURT.leftHoop) < 1e-9 && Math.abs(rimR.X - COURT.rightHoop) < 1e-9, '');
    // 10. props
    const pl = { stats: { pts: 20, reb: 4, ast: 3, tpm: 2, min: 30, pf: 1 }, starter: true, onCourt: true };
    const season = { mpg: 34, rates: { pts: 0.7, reb: 0.15, ast: 0.12, tpm: 0.08 }, avg: { pts: 24, reb: 5, ast: 4, tpm: 2.7 } };
    const g = mk({ period: 4, sec: 360, h: 90, a: 88 });
    const pr = priceGame(g);
    const prj = projectStat(pl, season, 'pts', g, pr);
    ok('prop: already over → P=1', probOver(prj, 19.5) === 1, '');
    ok('prop: P(over) falls as the line rises', probOver(prj, 22.5) > probOver(prj, 25.5) && probOver(prj, 25.5) > probOver(prj, 30.5), [22.5, 25.5, 30.5].map(l => probOver(prj, l).toFixed(3)).join(' > '));
    const fouled = projectStat({ ...pl, stats: { ...pl.stats, pf: 6 } }, season, 'pts', g, pr);
    ok('prop: fouled out → no remaining minutes', fouled.remMin === 0 && probOver(fouled, 20.5) === 0, '');
    ok('poisson sf sane', Math.abs(poissonSf(1, 1) - (1 - Math.exp(-1))) < 1e-12, '');
    // 11. line freshness gate — the defence against the quarter-break refresh
    const ev = 'selftest-' + Math.random();
    const st = (o) => ({ ...mk({ period: 2, sec: 400, h: 50, a: 48, ...o }), halftime: false, endOfPeriod: !!o.brk });
    const L1 = { details: 'HOM -3.5', total: 220.5, homeML: -160, awayML: 135 };
    const s1 = stampOdds(ev, L1, st({}), 0);
    ok('line first seen mid-quarter is NOT treated as current', !lineIsCurrent(st({}), s1).current, lineIsCurrent(st({}), s1).reason);
    const s2 = stampOdds(ev, { ...L1, homeML: -175 }, st({ sec: 395 }), 5000);
    ok('line seen changing, same state → current', lineIsCurrent(st({ sec: 390 }), s2).current, '');
    ok('…then a basket → lagging, no moves', !lineIsCurrent(st({ sec: 380, h: 52 }), s2).current && buildMoves(st({ sec: 380, h: 52 }), priceGame(st({ sec: 380, h: 52 })), s2).moves.length === 0, lineIsCurrent(st({ sec: 380, h: 52 }), s2).reason);
    ok('changed line at a break → current', lineIsCurrent(st({ sec: 0, brk: true, h: 52 }), stampOdds(ev, { ...L1, homeML: -190 }, st({ sec: 0, brk: true, h: 52 }), 9000)).current, '');
    _oddsSeen.delete(ev);
    // 12. six flagged on court → the player subbed out most recently is dropped
    const mkP = (id, on) => ({ id, onCourt: on, stats: { min: 10 } });
    const tm = { home: { players: ['1', '2', '3', '4', '5', '6'].map(i => mkP(i, true)) }, away: { players: [] } };
    fixOnCourt(tm, [{ kind: 'sub', ids: ['6', '3'] }], {});
    ok('six on court resolved by the last substitution', tm.home.players.filter(p => p.onCourt).length === 5 && !tm.home.players[2].onCourt, '');
    return { passed: results.filter(r => r.pass).length, total: results.length, results };
  }

  const api = {
    subscribe, normalize, inferPossession, layoutPossession, layout, lastLocatedEvent, shotTrail, toCourt, attackEnd, COURT,
    priceGame, calibrateSigma, parseLiveOdds, stampOdds, lineIsCurrent, fairBoard, buildMoves, devig, americanToProb, probToAmerican, kellyQuarter,
    PROP_STATS, statOf, projectStat, probOver, defaultLine, fetchSeason, fetchSeasons, parseTotals, clockSec, selfTest,
  };
  root.NbaLive = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
