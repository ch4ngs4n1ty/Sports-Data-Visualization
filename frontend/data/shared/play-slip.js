/* ============================================================
   PLAYIQ — PLAY SLIP data layer (sport-agnostic)
   ------------------------------------------------------------
   Turns simulated suggestions into selections a person can FIND on
   DraftKings by hand, and re-checks them against the real posted market.

   Sources (browser-side; all answer with CORS `*`, verified Nov 10 2026):
     odds      sports.core.api.espn.com/.../events/{id}/competitions/{id}/odds
               → provider "DraftKings - Live Odds" (in-play) or "DraftKings"
               → `links[]`: ESPN's own DraftKings URLs per outcome + per event
     propBets  that provider's `propBets.$ref` (?limit=1000, one page)
               → player milestones, period markets, each with `lastUpdated`
     summary   site.api.espn.com/.../summary?event=
               → team names/ids, clock, score, athlete names + live box score

   ── RULES THAT ARE LOAD-BEARING. Read before editing. ──
   1. NEVER FABRICATE A LINK. A DraftKings URL is shown only when ESPN's feed
      supplied it, its host is sportsbook.draftkings.com, and — for a
      selection link — the line encoded in DraftKings' own outcome id
      (`0HC…P750_1` = +7.5, `0OU…O22350_1` = Over 223.5, `0ML…_1`) equals the
      line we display. A mismatch falls back to the EVENT link and says why.
   2. NEVER GUESS A SIDE. propBets items do NOT say which of a pair is Over
      or Under, or which side of a period spread is + / −. They arrive as
      unlabeled pairs. So only outcomes the source identifies unambiguously
      are selectable:
        • full-game moneyline / spread / total from the provider row
          (homeTeamOdds / awayTeamOdds / overOdds / underOdds)
        • period moneylines (each item carries a team ref)
        • player milestones ("25+": a single "N or more" outcome)
      Unlabeled pairs (player O/U, team totals, period spreads/totals) are
      skipped, and counted in `skipped` so the UI can say so.
   3. NO FAKE FRESHNESS. The provider row has no timestamp, so a price's age
      is the time since WE first saw that exact price (a lower bound).
      propBets DO carry `lastUpdated`, but it is NOT real UTC despite the `Z`:
      measured Nov 10 2026 23:59 ET (04:59Z) the newest stamp read 07:57Z —
      ~3h in the future. So it is used only as a change fingerprint (a new
      stamp = DraftKings touched the price), never displayed or aged.
   4. "NOT LISTED" ≠ "SUSPENDED". The feed has no suspension flag. An outcome
      missing from the latest feed is reported as exactly that.
   ============================================================ */
(function (root) {
  'use strict';

  const CORE = 'https://sports.core.api.espn.com/v2/sports';
  const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
  const SPORT_PATH = {
    mlb: ['baseball', 'mlb'], nba: ['basketball', 'nba'], wnba: ['basketball', 'wnba'],
    nfl: ['football', 'nfl'], nhl: ['hockey', 'nhl'], ncaamb: ['basketball', 'mens-college-basketball'],
  };
  const SPORT_LABEL = { mlb: 'MLB', nba: 'NBA', wnba: 'WNBA', nfl: 'NFL', nhl: 'NHL', ncaamb: 'NCAAB' };
  const SCORE_UNIT = { mlb: 'runs', nhl: 'goals' };          // everything else: points
  /* A game line whose price hasn't moved in this long during live play may be
     frozen rather than current (same threshold the live models use). */
  const STALE_LINE_SEC = 150;
  /* propBets stamps are minute-precision; allow more slack before flagging. */
  const STALE_PROP_SEC = 6 * 60;
  const DK_HOST = 'sportsbook.draftkings.com';

  /* ── fetch ────────────────────────────────────────────────────────── */
  async function getJson(url, timeoutMs = 9000) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const r = await root.fetch(url, { cache: 'no-store', signal: ctl?.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { if (t) clearTimeout(t); }
  }
  const https = u => String(u || '').replace(/^http:\/\//, 'https://');

  /* ── formatting ───────────────────────────────────────────────────── */
  const num = v => { const n = Number(v); return v === null || v === '' || v === undefined || !Number.isFinite(n) ? null : n; };
  const fmtOdds = o => (o == null ? '—' : o > 0 ? `+${o}` : `${o}`);
  const fmtLine = l => (l == null ? '' : l === 0 ? 'PK' : l > 0 ? `+${l}` : `${l}`);

  /* ── DraftKings links (rule 1) ────────────────────────────────────── */
  /* ESPN wraps DK URLs in a DK gateway: ...gateway?...&preurl=<encoded DK url>.
     The destination is `preurl`; we keep it only if it is DK's own host. */
  function dkUrlFrom(href) {
    try {
      const u = new URL(href);
      let dest = u;
      const pre = u.searchParams.get('preurl');
      if (pre) dest = new URL(pre);
      if (dest.hostname !== DK_HOST) return null;
      dest.protocol = 'https:';
      return dest.toString();
    } catch { return null; }
  }
  /* DK outcome id → what it encodes. `0HC87179952P750_1` → spread +7.5. */
  function decodeDkOutcome(url) {
    try {
      const id = new URL(url).searchParams.get('outcomes') || '';
      const m = id.match(/^0(ML|HC|OU)\d+(?:([PNOU])(\d+))?_\d+$/);
      if (!m) return null;
      const [, kind, letter, digits] = m;
      if (kind === 'ML') return { kind: 'moneyline' };
      if (!letter || !digits) return null;
      const v = Number(digits) / 100;
      if (kind === 'HC' && (letter === 'P' || letter === 'N')) return { kind: 'spread', line: letter === 'P' ? v : -v };
      if (kind === 'OU' && (letter === 'O' || letter === 'U')) return { kind: 'total', side: letter === 'O' ? 'over' : 'under', line: v };
      return null;
    } catch { return null; }
  }
  /* Does a DK selection link point at exactly this outcome? */
  function linkMatches(url, outcome) {
    const d = decodeDkOutcome(url);
    if (!d || d.kind !== outcome.kind) return false;
    if (d.kind === 'moneyline') return true;
    if (d.kind === 'spread') return Math.abs(d.line - outcome.line) < 1e-6;
    return d.side === outcome.side && Math.abs(d.line - outcome.line) < 1e-6;
  }

  /* ── summary: teams, clock, athletes, live box score ──────────────── */
  function parseSummary(json) {
    const comp = json?.header?.competitions?.[0];
    if (!comp) return null;
    const teams = {};
    let home = null, away = null;
    for (const c of comp.competitors || []) {
      const t = { id: String(c.id || c.team?.id), abbr: c.team?.abbreviation || '?',
        name: c.team?.displayName || c.team?.name || c.team?.abbreviation || '?',
        score: num(c.score), side: c.homeAway };
      teams[t.id] = t;
      if (c.homeAway === 'home') home = t; else away = t;
    }
    const st = comp.status || {};
    const athletes = {};   // id → { name, team, stats: { group: { LABEL: raw } } }
    for (const tp of json?.boxscore?.players || []) {
      const teamId = String(tp.team?.id || '');
      for (const grp of tp.statistics || []) {
        const labels = grp.labels || [];
        const gname = String(grp.name || grp.type || 'main').toLowerCase();
        for (const a of grp.athletes || []) {
          const id = String(a.athlete?.id || '');
          if (!id) continue;
          const rec = athletes[id] || (athletes[id] = { name: a.athlete?.displayName || a.athlete?.shortName || '', teamId, stats: {} });
          const row = rec.stats[gname] || (rec.stats[gname] = {});
          labels.forEach((l, i) => { if (a.stats?.[i] != null) row[l] = a.stats[i]; });
        }
      }
    }
    return {
      state: st.type?.state || 'pre',                       // pre | in | post
      detail: st.type?.shortDetail || st.type?.detail || '',
      clock: st.displayClock || '', period: st.period ?? null,
      home, away, teams, athletes,
    };
  }

  /* Milestone stat name (source wording) → where its live value is in the box
     score. Basketball has one stat group; football/baseball split into groups.
     Unmapped stats simply show no "Current". */
  const LIVE_STAT = [
    [/^points$/i, ['*', 'PTS'], 'pts'], [/^rebounds$/i, ['*', 'REB'], 'reb'],
    [/^assists$/i, ['*', 'AST'], 'ast'], [/^3-?point field goals( made)?$/i, ['*', '3PT'], '3PM'],
    [/^steals$/i, ['*', 'STL'], 'stl'], [/^blocks$/i, ['*', 'BLK'], 'blk'],
    [/^passing yards$/i, ['passing', 'YDS'], 'pass yds'], [/^rushing yards$/i, ['rushing', 'YDS'], 'rush yds'],
    [/^receiving yards$/i, ['receiving', 'YDS'], 'rec yds'], [/^receptions$/i, ['receiving', 'REC'], 'rec'],
    [/^hits$/i, ['batting', 'H'], 'H'], [/^strikeouts$/i, ['pitching', 'K'], 'K'],
    [/^shots on goal$/i, ['*', 'SOG'], 'SOG'],
  ];
  function liveStat(summary, athleteId, statName) {
    const a = summary?.athletes?.[athleteId];
    if (!a) return null;
    const hit = LIVE_STAT.find(([re]) => re.test(statName));
    if (!hit) return null;
    const [, [group, label], unit] = hit;
    const groups = group === '*' ? Object.values(a.stats) : [a.stats[group]].filter(Boolean);
    for (const g of groups) {
      if (g[label] == null) continue;
      const v = num(String(g[label]).split('-')[0]);   // "2-7" (made-att) → 2
      if (v != null) return { value: v, unit };
    }
    return null;
  }

  /* ── outcome parsing ──────────────────────────────────────────────── */
  const _seen = new Map();   // outcome key → { fp, since }  (rule 3)
  function stampSeen(key, fp, now) {
    const prev = _seen.get(key);
    if (!prev || prev.fp !== fp) _seen.set(key, { fp, since: now });
    return _seen.get(key).since;
  }
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const refId = ref => (String(ref || '').match(/\/(?:athletes|teams)\/(\d+)/) || [])[1] || null;

  function chooseProvider(items) {
    const dk = (items || []).filter(i => /draftkings/i.test(i.provider?.name || ''));
    return dk.find(i => /live/i.test(i.provider?.name || '')) || dk[0] || null;
  }

  function gameLineOutcomes(item, summary, now) {
    const out = [];
    if (!item) return out;
    const links = {};
    for (const l of item.links || []) {
      const rel = (l.rel || [])[0];
      const url = dkUrlFrom(l.href);
      if (rel && url) links[rel] = { url, text: l.text || rel };
    }
    const h = summary?.home, a = summary?.away;
    const ho = item.homeTeamOdds || {}, ao = item.awayTeamOdds || {};
    const push = o => {
      if (o.odds == null) return;
      const rel = o.rel, link = links[rel];
      o.sourceSelection = link?.text || o.sourceSelection;
      if (link && linkMatches(link.url, o)) o.link = { url: link.url, scope: 'selection' };
      else if (link) o.linkNote = 'ESPN\'s DraftKings link for this outcome encodes a different line than the one shown, so only the game page is linked.';
      delete o.rel;
      o.period = 'Full game'; o.periodKey = 'full';
      o.sourceMarket = { moneyline: 'Moneyline', spread: 'Spread', total: 'Total' }[o.kind];
      o.lookIn = 'Game Lines';
      o.fp = `${o.odds}|${o.line ?? ''}`;
      o.observedAt = stampSeen(o.key, o.fp, now);
      out.push(o);
    };
    push({ key: 'ml:full:home', kind: 'moneyline', side: 'home', teamId: h?.id, odds: num(ho.moneyLine), rel: 'home', sourceSelection: 'Home Bet' });
    push({ key: 'ml:full:away', kind: 'moneyline', side: 'away', teamId: a?.id, odds: num(ao.moneyLine), rel: 'away', sourceSelection: 'Away Bet' });
    /* Spread sign: prefer DK's own outcome id (the link encodes the signed home
       line); fall back to ESPN's favorite flag on the unsigned `spread`. */
    let homeLine = null;
    const hl = links.homeSpread && decodeDkOutcome(links.homeSpread.url);
    if (hl?.kind === 'spread' && Math.abs(Math.abs(hl.line) - Math.abs(num(item.spread) ?? hl.line)) < 1e-6) homeLine = hl.line;
    else {
      const s = Math.abs(num(item.spread) ?? NaN);
      const homeFav = ho.favorite === true || ao.favorite === false;
      if (Number.isFinite(s) && (ho.favorite != null || ao.favorite != null)) homeLine = homeFav ? -s : s;
    }
    if (homeLine != null) {
      push({ key: 'spread:full:home', kind: 'spread', side: 'home', teamId: h?.id, line: homeLine, odds: num(ho.spreadOdds), rel: 'homeSpread', sourceSelection: 'Home Point Spread' });
      push({ key: 'spread:full:away', kind: 'spread', side: 'away', teamId: a?.id, line: homeLine === 0 ? 0 : -homeLine, odds: num(ao.spreadOdds), rel: 'awaySpread', sourceSelection: 'Away Point Spread' });
    }
    const total = num(item.overUnder);
    if (total != null) {
      push({ key: 'total:full:over', kind: 'total', side: 'over', line: total, odds: num(item.overOdds), rel: 'over', sourceSelection: 'Over' });
      push({ key: 'total:full:under', kind: 'total', side: 'under', line: total, odds: num(item.underOdds), rel: 'under', sourceSelection: 'Under' });
    }
    return out;
  }

  function propOutcomes(items, summary, now) {
    const out = [], skipped = {};
    const skip = name => { skipped[name] = (skipped[name] || 0) + 1; };
    for (const it of items || []) {
      const name = it.type?.name || '';
      const odds = num(String(it.odds?.american?.value ?? '').replace('+', ''));
      if (odds == null) { skip(name || 'unpriced'); continue; }
      let m;
      if ((m = name.match(/^(.+?)\s+Milestones$/i)) && it.athlete) {
        const athleteId = refId(it.athlete.$ref);
        const threshold = num(it.current?.target?.value);
        if (!athleteId || threshold == null) { skip(name); continue; }
        const stat = m[1];
        const key = `ms:${slug(stat)}:${athleteId}:${threshold}`;
        const fp = `${odds}|${it.lastUpdated || ''}`;
        out.push({ key, kind: 'milestone', stat, athleteId, threshold,
          thresholdText: it.current?.target?.displayValue || `${threshold}+`,
          odds, period: 'Full game', periodKey: 'full', sourceMarket: name,
          sourceSelection: it.current?.target?.displayValue || `${threshold}+`,
          lookIn: 'Player props', propMarket: true, fp, observedAt: stampSeen(key, fp, now) });
        continue;
      }
      if ((m = name.match(/^(.+?)\s+Moneyline$/i)) && it.team) {
        const teamId = refId(it.team.$ref);
        const t = teamId && summary?.teams?.[teamId];
        if (!t) { skip(name); continue; }
        const period = m[1];
        const key = `ml:${slug(period)}:${teamId}`;
        const fp = `${odds}|${it.lastUpdated || ''}`;
        out.push({ key, kind: 'moneyline', side: t.side, teamId, odds, period, periodKey: slug(period),
          sourceMarket: name, sourceSelection: t.name, lookIn: `${period} markets`,
          propMarket: true, fp, observedAt: stampSeen(key, fp, now) });
        continue;
      }
      skip(name);   // rule 2: side not identified by the source
    }
    /* Duplicate keys would mean the source posted two prices for one outcome —
       we can't tell which DraftKings shows, so drop both rather than pick. */
    const count = {};
    for (const o of out) count[o.key] = (count[o.key] || 0) + 1;
    const clean = out.filter(o => count[o.key] === 1);
    for (const o of out) if (count[o.key] > 1) skip(`${o.sourceMarket} (duplicate)`);
    return { outcomes: clean, skipped };
  }

  /* ── one snapshot of the market ───────────────────────────────────── */
  async function fetchMarketSnapshot(sportKey, eventId, { withProps = true } = {}) {
    const path = SPORT_PATH[sportKey];
    const now = Date.now();
    const snap = { sportKey, eventId: String(eventId), fetchedAt: now, provider: null, isLiveProvider: false,
      game: null, outcomes: {}, eventLink: null, skipped: {}, errors: [] };
    if (!path || !eventId) { snap.errors.push('This sport or game has no DraftKings feed mapping.'); return snap; }
    const [sport, league] = path;
    const [sumR, oddsR] = await Promise.allSettled([
      getJson(`${SITE}/${sport}/${league}/summary?event=${eventId}`),
      getJson(`${CORE}/${sport}/leagues/${league}/events/${eventId}/competitions/${eventId}/odds?lang=en&region=us`),
    ]);
    snap.game = sumR.status === 'fulfilled' ? parseSummary(sumR.value) : null;
    if (!snap.game) snap.errors.push('Game state unavailable (ESPN summary did not load).');
    const item = oddsR.status === 'fulfilled' ? chooseProvider(oddsR.value?.items) : null;
    if (oddsR.status !== 'fulfilled') snap.errors.push('DraftKings prices unavailable (ESPN odds did not load).');
    else if (!item) snap.errors.push('No DraftKings market is posted for this game in the feed.');
    if (item) {
      snap.provider = item.provider?.name || 'DraftKings';
      snap.isLiveProvider = /live/i.test(snap.provider);
      const game = (item.links || []).find(l => (l.rel || [])[0] === 'game');
      const url = game && dkUrlFrom(game.href);
      if (url && !/[?&]outcomes=/.test(url)) snap.eventLink = url;
      for (const o of gameLineOutcomes(item, snap.game, now)) snap.outcomes[o.key] = o;
      if (withProps && item.propBets?.$ref) {
        try {
          const ref = https(item.propBets.$ref);
          const pb = await getJson(`${ref}${ref.includes('?') ? '&' : '?'}limit=1000`);
          const pages = [pb];
          for (let p = 2; p <= Math.min(pb.pageCount || 1, 4); p++) pages.push(await getJson(`${ref}${ref.includes('?') ? '&' : '?'}limit=1000&page=${p}`));
          const { outcomes, skipped } = propOutcomes(pages.flatMap(x => x.items || []), snap.game, now);
          for (const o of outcomes) snap.outcomes[o.key] = o;
          snap.skipped = skipped;
        } catch { snap.errors.push('Player and period markets unavailable (ESPN propBets did not load).'); }
      }
    }
    for (const o of Object.values(snap.outcomes)) decorate(o, snap);
    return snap;
  }

  /* Display wording for an outcome, from the snapshot it came from. */
  function decorate(o, snap) {
    const g = snap.game || {};
    const team = o.teamId && g.teams?.[o.teamId];
    const unit = SCORE_UNIT[snap.sportKey] || 'points';
    if (o.kind === 'milestone') {
      const a = g.athletes?.[o.athleteId];
      o.subject = a?.name || `Player #${o.athleteId}`;
      o.selectionText = `${o.thresholdText} ${o.stat}`;
      o.headline = `${o.subject} — ${o.thresholdText} ${o.stat}`;
      o.sideBadge = `${o.thresholdText} · ${o.threshold} OR MORE`;
    } else if (o.kind === 'moneyline') {
      o.subject = team?.name || (o.side === 'home' ? 'Home' : 'Away');
      o.selectionText = `${o.subject} to win`;
      o.headline = `${o.subject} — ${o.periodKey === 'full' ? 'Moneyline' : o.sourceMarket}`;   // period in the headline, not just a chip
      o.sideBadge = 'TO WIN';
    } else if (o.kind === 'spread') {
      o.subject = team?.name || (o.side === 'home' ? 'Home' : 'Away');
      o.selectionText = `${o.subject} ${fmtLine(o.line)}`;
      o.headline = `${o.subject} ${fmtLine(o.line)} — Spread`;
      o.sideBadge = o.line === 0 ? 'PICK’EM' : o.line > 0 ? `${fmtLine(o.line)} · GETS ${o.line}` : `${fmtLine(o.line)} · GIVES ${-o.line}`;
    } else if (o.kind === 'total') {
      o.subject = g.away && g.home ? `${g.away.abbr} @ ${g.home.abbr}` : 'Game total';
      o.selectionText = `${o.side === 'over' ? 'Over' : 'Under'} ${o.line}`;
      o.headline = `${o.side === 'over' ? 'Over' : 'Under'} ${o.line} total ${unit}`;
      o.sideBadge = o.side === 'over' ? `OVER ${o.line}` : `UNDER ${o.line}`;
    }
    o.provider = snap.provider;
  }

  /* Live context for a selection at the time of a snapshot. */
  function gameContext(snap, outcome) {
    const g = snap?.game;
    if (!g) return null;
    const ctx = { state: g.state, detail: g.detail, clock: g.clock, period: g.period,
      score: g.away && g.home ? `${g.away.abbr} ${g.away.score ?? '—'} – ${g.home.abbr} ${g.home.score ?? '—'}` : '' };
    if (outcome?.kind === 'milestone') ctx.current = liveStat(g, outcome.athleteId, outcome.stat);
    return ctx;
  }

  /* ── selections (slip entries) ────────────────────────────────────── */
  /* A selection freezes the outcome as it was when added (`original`). The
     working values the user is looking for start equal to it and change ONLY
     when the user accepts an update. */
  function makeSelection(outcome, snap, suggestion, now = Date.now()) {
    const frozen = freezeOutcome(outcome, snap);
    return {
      id: outcome.key, sportKey: snap.sportKey, eventId: snap.eventId,
      matchup: matchupOf(snap), addedAt: now,
      why: suggestion?.why || null, detail: suggestion?.detail || null,
      source: suggestion ? (suggestion.source || 'PlayIQ model') : 'Added from posted lines',
      original: frozen, working: frozen, acceptedAt: null,
      found: false, addedManually: false,
    };
  }
  function freezeOutcome(o, snap) {
    const { fp, ...rest } = o;
    return JSON.parse(JSON.stringify({ ...rest, context: gameContext(snap, o), seenAt: snap.fetchedAt,
      eventLink: snap.eventLink, isLiveProvider: snap.isLiveProvider }));
  }
  function matchupOf(snap) {
    const g = snap.game;
    return { sport: SPORT_LABEL[snap.sportKey] || snap.sportKey.toUpperCase(),
      away: g?.away?.abbr || '?', home: g?.home?.abbr || '?',
      awayName: g?.away?.name || '', homeName: g?.home?.name || '' };
  }

  /* What changed between what the user is looking for and the latest feed. */
  function compare(sel, snap, now = Date.now()) {
    const w = sel.working;
    const cur = snap?.outcomes?.[sel.id] || null;
    const flags = [];
    if (!snap) return { current: null, flags: [{ type: 'UNCHECKED', text: 'Not checked against the feed yet.' }] };
    if (snap.game?.state === 'post') flags.push({ type: 'FINAL', text: 'Game is final — markets are closed.' });
    if (!cur) {
      const isGameLine = /^(ml:full|spread:full|total:full):/.test(sel.id);
      const feedDown = !snap.provider || (!isGameLine && snap.errors.some(e => /propBets/.test(e)));
      flags.push(feedDown
        ? { type: 'UNCHECKED', text: 'Could not check — this part of the feed did not load.' }
        : { type: 'NOT_LISTED', text: 'Not in the latest DraftKings feed. It may be suspended, settled or removed — the feed does not say which.' });
      return { current: null, flags };
    }
    if (cur.line != null && w.line != null && Math.abs(cur.line - w.line) > 1e-6) {
      flags.push({ type: 'LINE', from: w.line, to: cur.line,
        text: `Line moved ${w.kind === 'spread' ? fmtLine(w.line) : w.line} → ${w.kind === 'spread' ? fmtLine(cur.line) : cur.line}` });
    }
    if (cur.odds !== w.odds) flags.push({ type: 'ODDS', from: w.odds, to: cur.odds, text: `Odds ${fmtOdds(w.odds)} → ${fmtOdds(cur.odds)}` });
    if (snap.game?.state === 'in') {
      const age = (now - cur.observedAt) / 1000;
      if (age > (cur.propMarket ? STALE_PROP_SEC : STALE_LINE_SEC)) flags.push({ type: 'STALE', ageSec: Math.round(age),
        text: `Price unchanged for at least ${fmtAge(age)} during play — it may be frozen or paused rather than current.` });
    }
    return { current: cur, flags };
  }
  const CHANGE_TYPES = new Set(['LINE', 'ODDS', 'NOT_LISTED', 'FINAL']);
  const hasChange = r => r.flags.some(f => CHANGE_TYPES.has(f.type));

  function acceptCurrent(sel, snap, now = Date.now()) {
    const cur = snap?.outcomes?.[sel.id];
    if (!cur) return sel;
    return { ...sel, working: freezeOutcome(cur, snap), acceptedAt: now };
  }

  function fmtAge(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  }
  function fmtClock(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  }

  /* ── copy text (concise, searchable: name first) ──────────────────── */
  function copyLine(sel, i) {
    const w = sel.working, m = sel.matchup;
    const parts = [
      w.kind === 'milestone' ? `${w.subject} ${w.thresholdText} ${w.stat}` : w.selectionText,
      w.kind === 'milestone' ? w.sourceMarket : w.period === 'Full game' ? `${w.sourceMarket} (full game)` : w.sourceMarket,
      fmtOdds(w.odds),
      `${m.sport} ${m.away} @ ${m.home}`,
    ];
    return `${i != null ? `${i + 1}. ` : ''}${parts.join(' | ')}`;
  }
  function copySlip(sels, { label = 'PlayIQ simulated slip', at = Date.now() } = {}) {
    if (!sels.length) return '';
    const m = sels[0].matchup;
    return [`${label} · ${m.sport} ${m.away} @ ${m.home} · ${new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
      ...sels.map((s, i) => copyLine(s, i)),
      'Simulation only. Confirm each price on DraftKings.'].join('\n');
  }

  /* ── suggestion matching ──────────────────────────────────────────── */
  /* A suggestion names an outcome in source-neutral terms; it only becomes
     addable when the feed has that exact outcome (same line for spreads and
     totals — a model pick on Over 8.5 is NOT the posted Over 9). */
  function outcomeKeyFor(s, snap) {
    const g = snap?.game;
    if (s.kind === 'moneyline') {
      if (!s.period || s.period === 'full') return `ml:full:${s.side}`;
      const team = s.side === 'home' ? g?.home : g?.away;
      return team ? `ml:${slug(s.period)}:${team.id}` : null;
    }
    if (s.kind === 'spread') return `spread:full:${s.side}`;
    if (s.kind === 'total') return `total:full:${s.side}`;
    if (s.kind === 'milestone') return `ms:${slug(s.stat)}:${s.athleteId}:${s.threshold}`;
    return null;
  }
  function matchSuggestion(s, snap) {
    const key = outcomeKeyFor(s, snap);
    const o = key && snap?.outcomes?.[key];
    if (!o) return { outcome: null, reason: 'No matching DraftKings outcome in the feed.' };
    if (s.line != null && o.line != null && Math.abs(o.line - s.line) > 1e-6) {
      return { outcome: null, reason: `DraftKings posts ${o.kind === 'spread' ? fmtLine(o.line) : o.line}, not ${o.kind === 'spread' ? fmtLine(s.line) : s.line}.` };
    }
    return { outcome: o, reason: null };
  }

  /* ── adapter: NBA/WNBA live moves (frontend/data/nba/live.js buildMoves) ──
     Those moves are full-game ML / SPREAD / TOTAL (the Brownian model includes
     OT), i.e. the same markets as DraftKings' game lines. They carry `side` /
     `line` if the producer adds them; otherwise the side is read from the
     producer's fixed label templates: "<ABBR> moneyline", "<ABBR> +4.5",
     "Over 213.5". Anything that doesn't parse is dropped, never guessed.
     Milestone suggestions can be passed straight through as
     { kind:'milestone', athleteId, stat:'Points'|'Rebounds'|'Assists'|'3-Point Field Goals', threshold, why }
     — `stat` is DraftKings' wording minus " Milestones". */
  function fromHoopsMoves(moves, data) {
    const out = [];
    const sideOf = abbr => abbr === data?.home?.abbr ? 'home' : abbr === data?.away?.abbr ? 'away' : null;
    for (const m of moves || []) {
      const label = String(m.label || '');
      let kind = null, side = m.side ? String(m.side).toLowerCase() : null, line = m.line ?? null, mm;
      if (m.market === 'ML') { kind = 'moneyline'; if (!side && (mm = label.match(/^(\S+)\s+moneyline$/i))) side = sideOf(mm[1]); }
      else if (m.market === 'SPREAD') { kind = 'spread'; if ((!side || line == null) && (mm = label.match(/^(\S+)\s+([+-]?\d+(?:\.\d+)?)$/))) { side = side || sideOf(mm[1]); line = line ?? Number(mm[2]); } }
      else if (m.market === 'TOTAL') { kind = 'total'; if ((!side || line == null) && (mm = label.match(/^(Over|Under)\s+(\d+(?:\.\d+)?)$/i))) { side = side || mm[1].toLowerCase(); line = line ?? Number(mm[2]); } }
      if (!kind || !side || (kind !== 'moneyline' && line == null)) continue;
      out.push({ kind, side, line: kind === 'moneyline' ? undefined : line, label, why: m.why,
        detail: { modelProb: m.model ?? m.modelProb, fairOdds: m.fairOdds, edgePts: m.edgePts, caveats: m.caveats } });
    }
    return out;
  }

  /* ── persistence (per browser, per game; every access guarded) ────── */
  const storeKey = (sportKey, eventId) => `piq_play_slip_v1_${sportKey}_${eventId}`;
  function loadSlip(sportKey, eventId) {
    try {
      const raw = JSON.parse(root.localStorage.getItem(storeKey(sportKey, eventId)) || 'null');
      if (raw && Array.isArray(raw.items) && Array.isArray(raw.original)) return raw;
    } catch { /* storage blocked or corrupt */ }
    return { v: 1, items: [], original: [], createdAt: null };
  }
  function saveSlip(sportKey, eventId, slip) {
    try { root.localStorage.setItem(storeKey(sportKey, eventId), JSON.stringify(slip)); return true; }
    catch { return false; }
  }

  root.PlaySlipData = {
    SPORT_PATH, fetchMarketSnapshot, parseSummary, gameLineOutcomes, propOutcomes, chooseProvider,
    dkUrlFrom, decodeDkOutcome, linkMatches, liveStat, gameContext,
    makeSelection, compare, hasChange, acceptCurrent, matchSuggestion, outcomeKeyFor, fromHoopsMoves,
    copyLine, copySlip, loadSlip, saveSlip, fmtOdds, fmtLine, fmtAge, fmtClock,
    STALE_LINE_SEC, STALE_PROP_SEC,
  };
})(typeof window !== 'undefined' ? window : globalThis);
