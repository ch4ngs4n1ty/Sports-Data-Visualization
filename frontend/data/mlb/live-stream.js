/* Shared subscriptions: detail header + live panel use one browser connection.
   SSE sends full snapshots. A blocked stream falls back to serial REST polling. */
(() => {
  const channels = new Map();
  function subscribeMlbLive(params, listener) {
    const query = new URLSearchParams(params).toString();
    let channel = channels.get(query);
    if (!channel) {
      const listeners = new Set();
      let source, timer, watchdog, controller, stopped = false, generation = 0, latest = null;
      const emit = value => { latest = value; for (const fn of listeners) fn(value); };
      const stopTransport = () => {
        generation++; source?.close(); source = null; controller?.abort();
        clearTimeout(timer); clearTimeout(watchdog);
      };
      const status = name => emit({ ...(latest || {}), status: name });
      async function poll() {
        if (stopped || document.hidden) return;
        const token = generation;
        const requestController = new AbortController();
        controller = requestController;
        const timeout = setTimeout(() => requestController.abort(), 25000);
        let delay = 15000;
        try {
          const r = await fetch(`${API_BASE}/api/mlb/snapshot?${query}`, { cache: 'no-store', signal: controller.signal });
          if (!r.ok) throw new Error('Live feed unavailable');
          const snapshot = await r.json();
          if (token !== generation || stopped) return;
          emit({ snapshot, status: 'polling', receivedAt: Date.now() });
          delay = Math.max(delay, (snapshot.pollSeconds || 0) * 1000);
        } catch {
          if (token !== generation || stopped) return;
          status('stale'); delay = 30000;
        } finally {
          clearTimeout(timeout);
          if (token === generation && !stopped && !document.hidden) timer = setTimeout(poll, delay);
        }
      }
      function fallback() { stopTransport(); status('reconnecting'); poll(); }
      function start() {
        stopTransport();
        if (stopped || document.hidden) { status('paused'); return; }
        status('connecting');
        if (!window.EventSource) { poll(); return; }
        const token = generation;
        source = new EventSource(`${API_BASE}/api/mlb/stream?${query}`);
        const arm = (delay = 45000) => { clearTimeout(watchdog); watchdog = setTimeout(fallback, delay); };
        arm();
        source.addEventListener('snapshot', event => {
          if (token !== generation || stopped) return;
          try {
            const snapshot = JSON.parse(event.data);
            const fresh = Number.isFinite(Date.parse(snapshot.checkedAt)) && Date.now() - Date.parse(snapshot.checkedAt) < 45000;
            emit({ snapshot, status: fresh ? 'live' : 'stale', receivedAt: Date.now() });
            arm(Math.max(45000, ((snapshot.pollSeconds || 10) + 20) * 1000));
          }
          catch { fallback(); }
        });
        source.addEventListener('stale', () => { if (token === generation) { status('stale'); arm(); } });
        source.onerror = () => { if (token === generation) fallback(); };
      }
      const visibility = () => start();
      document.addEventListener('visibilitychange', visibility);
      channel = { listeners, get latest() { return latest; }, start,
        close() { stopped = true; stopTransport(); document.removeEventListener('visibilitychange', visibility); channels.delete(query); } };
      channels.set(query, channel);
    }
    channel.listeners.add(listener);
    if (channel.latest) listener(channel.latest);
    if (channel.listeners.size === 1) channel.start();
    return () => { channel.listeners.delete(listener); if (!channel.listeners.size) channel.close(); };
  }
  function mergeMlbSlate(games, snapshot) {
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
    return games.map(g => {
      if (g.sportKey !== 'mlb') return g;
      const matches = (snapshot?.games || []).filter(m =>
        norm(m.away) === norm(g.awayFull) && norm(m.home) === norm(g.homeFull));
      const m = matches.find(m => String(m.gamePk) === String(g.gamePk))
        || matches.find(m => Date.parse(m.date) === Date.parse(g.date))
        || (matches.length === 1 ? matches[0] : null);
      return m ? { ...g, gamePk: m.gamePk, awayScore: m.awayScore, homeScore: m.homeScore,
        statusState: m.statusState, statusText: m.statusText, statusDetail: m.statusDetail } : g;
    });
  }
  function applyMlbSnapshot(game, snapshot) {
    if (!snapshot?.state) return game;
    const s = snapshot.state;
    return { ...game, gamePk: snapshot.gamePk, awayScore: s.awayScore, homeScore: s.homeScore,
      statusState: s.isFinal ? 'post' : s.hasStarted ? 'in' : 'pre', statusText: s.status,
      statusDetail: s.isLive ? `${s.betweenInnings ? 'Break · next ' : ''}${s.half === 'top' ? 'Top' : 'Bottom'} ${s.inning}` : s.status };
  }
  Object.assign(window, { subscribeMlbLive, mergeMlbSlate, applyMlbSnapshot });
})();
