'use strict';
const { CORS_HEADERS, sendError } = require('./http');

// One serial upstream request per topic, regardless of viewer count. Full
// snapshots make reconnects self-contained; no reliance on lost event history.
function createLiveHub({ load, interval = 10000, maxClients = 200, maxPerIp = 8,
  schedule = setTimeout, cancel = clearTimeout } = {}) {
  const topics = new Map(), ips = new Map();
  let clients = 0;
  function attach(req, res, key, ip) {
    if (clients >= maxClients || (ips.get(ip) || 0) >= maxPerIp || (!topics.has(key) && topics.size >= 40)) {
      sendError(res, 'Live connection limit reached. Try again shortly.', 429); return;
    }
    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff', Connection: 'keep-alive' });
    res.flushHeaders?.();
    let topic = topics.get(key);
    if (!topic) { topic = { listeners: new Set(), timer: null, last: null, running: false }; topics.set(key, topic); }
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true; clients--; ips.set(ip, (ips.get(ip) || 1) - 1);
      if (!ips.get(ip)) ips.delete(ip);
      topic.listeners.delete(send);
      if (!topic.listeners.size) { cancel(topic.timer); topics.delete(key); }
    };
    const send = (event, data) => {
      if (closed) return;
      // Disconnect slow readers instead of growing an unbounded socket buffer.
      if (res.destroyed || res.writableLength > 256 * 1024) { close(); res.destroy(); return; }
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    clients++; ips.set(ip, (ips.get(ip) || 0) + 1);
    topic.listeners.add(send);
    res.on('close', close); res.on('error', close);
    res.write('retry: 5000\n\n');
    if (topic.last) send('snapshot', topic.last);
    if (topic.failed) send('stale', { message: 'Waiting for a successful provider update.' });
    async function tick() {
      if (!topic.listeners.size || topic.running) return;
      topic.running = true;
      let delay = interval;
      try {
        const data = await load(key);
        topic.last = data; topic.failed = false;
        delay = Math.max(interval, (data.pollSeconds || 0) * 1000);
        for (const listener of topic.listeners) listener('snapshot', data);
      } catch {
        topic.failed = true;
        delay = Math.min(60000, (topic.retry || interval) * 2);
        for (const listener of topic.listeners) listener('stale', { message: 'Update unavailable; showing the last received data.', checkedAt: new Date().toISOString() });
      } finally {
        topic.retry = delay; topic.running = false;
        if (topic.listeners.size) topic.timer = schedule(tick, delay);
      }
    }
    if (!topic.timer && !topic.running) tick();
  }
  return { attach, topics };
}
module.exports = { createLiveHub };
