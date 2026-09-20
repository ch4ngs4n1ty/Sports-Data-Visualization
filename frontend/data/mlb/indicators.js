/* Live predictions are probabilities, not executable prices. A followed line is
   immutable; recompute its chance against each new matching model revision. */
(() => {
  const indicatorKey = pick => [pick.market, pick.side || '', pick.playerId || '', pick.line ?? ''].join(':');
  function hitTail(needed, mean) {
    if (needed <= 0) return 1;
    let under = 0, term = Math.exp(-mean);
    for (let k = 0; k < needed; k++) {
      if (k) term *= mean / k;
      under += term;
    }
    return Math.max(0, Math.min(1, 1 - under));
  }
  function liveIndicator(data, pick) {
    const s = data?.state;
    if (!s || (!s.isLive && !s.isFinal)) return null;
    let win = 0, push = 0, approximate = false, note = '', progress = null;
    if (pick.market === 'HITS') {
      const player = data.players?.find(p => String(p.id) === String(pick.playerId));
      if (!player || !Number.isFinite(Number(pick.line)) || Number(pick.line) < 0) return null;
      const hits = Number(player.batting.hits || 0), target = Math.floor(Number(pick.line)) + 1;
      progress = `${hits} / ${target} hits`;
      if (hits >= target) win = 1;
      else if (s.isFinal || !player.active) win = 0;
      else {
        if (!data.model) return null;
        const pa = Number(player.seasonBatting?.plateAppearances), seasonHits = Number(player.seasonBatting?.hits);
        if (!Number.isFinite(pa) || pa < 50 || !Number.isFinite(seasonHits)) return null;
        const rate = Math.min(.6, Math.max(.02, (seasonHits + 12) / (pa + 50)));
        const reg = s.scheduledInnings || 9;
        let innings = Math.max(0, reg - s.inning);
        if (player.side === 'home' && s.half === 'top') innings += 1;
        else if (player.side === s.battingTeam) innings += (3 - s.outs) / 3;
        // Extra-inning continuation and batting-order effects are deliberately
        // not fabricated. Only project opportunities in the current/regulation innings.
        if (innings <= 0) return null; // Further extra-inning opportunities are unknown.
        const opportunities = innings * 4.3 / 9;
        win = hitTail(target - hits, opportunities * rate);
        approximate = true;
        note = 'Rough Poisson estimate from season hits per plate appearance and remaining regulation opportunities. No count, matchup, batting-order or future-extra-inning adjustment.';
      }
      if (!note) note = hits >= target ? 'Hit threshold reached in the current box score; official corrections can still apply.' : 'No projected opportunities remain for this player.';
    } else {
      if (!['MONEYLINE', 'RUNLINE', 'TOTAL'].includes(pick.market)) return null;
      if (pick.market !== 'MONEYLINE' && (!Number.isFinite(Number(pick.line)) || String(pick.line).trim() === '')) return null;
      if (pick.market === 'TOTAL' ? !['OVER', 'UNDER'].includes(pick.side) : !['HOME', 'AWAY'].includes(pick.side)) return null;
      const dist = s.isFinal ? { outcomes: [{ away: s.awayScore, home: s.homeScore, p: 1 }], unresolved: 0 } : data.model?.finalScores;
      if (!dist?.outcomes?.length || dist.unresolved > .005) return null;
      for (const o of dist.outcomes) {
        let margin;
        if (pick.market === 'TOTAL') margin = (o.away + o.home - Number(pick.line)) * (pick.side === 'OVER' ? 1 : -1);
        else margin = (pick.side === 'HOME' ? o.home - o.away : o.away - o.home) + (pick.market === 'RUNLINE' ? Number(pick.line) : 0);
        if (margin > 0) win += o.p; else if (margin === 0) push += o.p;
      }
      const mass = dist.outcomes.reduce((n, o) => n + o.p, 0);
      win /= mass; push /= mass;
      approximate = !s.isFinal;
      note = 'Estimated from inning, runners, outs and pitching environment, including game-ending rules and extra innings. Walk-off home-run excess and pitch-count effects on the current at-bat are not modeled.';
      if (s.isFinal) note = 'Final scoreboard result; sportsbook settlement rules and official corrections may differ.';
    }
    win = Math.max(0, Math.min(1, win)); push = Math.max(0, Math.min(1 - win, push));
    const conditional = 1 - push > 1e-8 ? win / (1 - push) : null;
    const fairOdds = conditional == null || conditional <= 0 || conditional >= 1 ? null
      : Math.round(conditional >= .5 ? -100 * conditional / (1 - conditional) : 100 * (1 - conditional) / conditional);
    return { win, push, fairOdds, approximate, note, progress,
      status: s.isFinal ? (push === 1 ? 'PUSH' : win === 1 ? 'HIT' : 'MISSED')
        : pick.market === 'HITS' && win === 1 ? 'REACHED' : 'LIVE' };
  }
  function indicatorLabel(pick, state, players = []) {
    if (pick.market === 'HITS') return `${players.find(p => String(p.id) === String(pick.playerId))?.name || pick.playerName || 'Player'} · over ${pick.line} hits`;
    if (pick.market === 'TOTAL') return `${pick.side === 'OVER' ? 'Over' : 'Under'} ${pick.line} runs`;
    const team = state[pick.side.toLowerCase()]?.abbr || pick.side;
    return pick.market === 'MONEYLINE' ? `${team} to win` : `${team} ${Number(pick.line) > 0 ? '+' : ''}${pick.line}`;
  }
  Object.assign(window, { liveIndicator, indicatorKey, indicatorLabel });
})();
