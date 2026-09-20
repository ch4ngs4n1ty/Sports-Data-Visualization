/* Pure paper-pricing helpers. No network, paid API, or AI dependency. */
(() => {
  function paperPrice(model, state, market, side, line, odds) {
    if (!model || !state?.isLive || !Number.isFinite(Number(odds)) || Math.abs(Number(odds)) < 100) return null;
    let win, push = 0;
    if (market === 'MONEYLINE') {
      if (!['HOME', 'AWAY'].includes(side)) return null;
      win = side === 'HOME' ? model.homeWinProb : model.awayWinProb;
    } else {
      if (market !== 'TOTAL' || !['OVER', 'UNDER'].includes(side) || String(line).trim() === '' || !Number.isFinite(Number(line)) || Number(line) < 0) return null;
      const dist = model.remainingRunsDistribution;
      if (!Array.isArray(dist) || !dist.length) return null;
      win = 0;
      dist.forEach((p, runs) => {
        const total = state.awayScore + state.homeScore + runs;
        if (total === Number(line)) push += p;
        else if (side === 'OVER' ? total > Number(line) : total < Number(line)) win += p;
      });
    }
    if (!Number.isFinite(win) || win < 0 || win > 1.000001) return null;
    const loss = Math.max(0, 1 - win - push);
    const profit = Number(odds) > 0 ? Number(odds) / 100 : 100 / -Number(odds);
    return { win, push, loss, ev: win * profit - loss,
      // Calibration excludes pushes, so store the probability conditional on a decision.
      modelProb: 1 - push > 1e-8 ? win / (1 - push) : null };
  }
  function paperSnapshot(data, selection, now = Date.now()) {
    const price = paperPrice(data.model, data.state, selection.market, selection.side, selection.line, selection.odds);
    if (!price || !data.revision || !Number.isFinite(Number(selection.stakeUnits)) || Number(selection.stakeUnits) <= 0) return null;
    const s = data.state;
    return { ...selection, mode: 'PAPER', number: Number(selection.odds), modelProb: price.modelProb,
      selectedAt: new Date(now).toISOString(), modelVersion: data.model.version,
      revision: data.revision, feedTimestamp: s.feedTimestamp,
      snapshot: { inning: s.inning, half: s.half, outs: s.outs, bases: s.bases,
        balls: s.balls, strikes: s.strikes, score: `${s.awayScore}-${s.homeScore}`,
        currentPitcher: s.currentPitcher ? { ...s.currentPitcher } : null, currentBatter: s.currentBatter ? { ...s.currentBatter } : null },
      audit: { source: data.source, sourceTimestamp: data.sourceTimestamp,
        feedReceivedAt: data.receivedAt, modelCalculatedAt: data.model.calculatedAt,
        quoteObservedAt: data.market?.live?.observedAt || null,
        quoteSourceUpdatedAt: null, quoteFreshness: 'unknown',
        priceSource: selection.priceSource || 'manual', executable: false,
        winProbability: price.win, pushProbability: price.push, evPerUnit: price.ev },
    };
  }
  // Replay only captured decisions. Never rebuild historical predictions using
  // today's statistics or later plays. Manual settlement remains explicit.
  function paperReplay(records) {
    let profit = 0;
    return records.filter(r => r.mode === 'PAPER').slice().sort((a, b) => a.ts.localeCompare(b.ts)).map(r => {
      const stake = Number(r.stakeUnits), odds = Number(r.odds);
      const delta = r.result === 'WIN' ? stake * (odds > 0 ? odds / 100 : 100 / -odds)
        : r.result === 'LOSS' ? -stake : 0;
      profit += delta;
      return { id: r.id, ts: r.ts, label: r.label, result: r.result, profit, delta,
        revision: r.revision, state: r.state, audit: r.audit };
    });
  }
  Object.assign(window, { paperPrice, paperSnapshot, paperReplay });
})();
