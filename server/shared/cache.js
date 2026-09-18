const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000;
const LIVE_CACHE_TTL = 2 * 60 * 1000;

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data, ttl = CACHE_TTL) {
  cache.set(key, { data, ts: Date.now(), ttl });
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.ts > v.ttl) cache.delete(k);
    }
  }
}

/* ── IN-FLIGHT REQUEST COALESCING ────────────────────────────────────────
   `cacheSet` only runs AFTER a fetch resolves, so N callers that ask for the
   same key while the first fetch is still in the air all miss the cache and
   all fetch. That is not hypothetical: the MLB game detail screen fires
   /api/mlb/game-bvp and /api/mlb/prop-model at the same instant, and both
   call getGameBvp() -> fetchSavantBvP() for the SAME ~18 batter/pitcher
   pairs. Measured cold: 36 Savant CSV downloads for 18 unique pairs.

   `dedupe(key, fn)` returns the promise already running for `key` instead of
   starting a second one. It is a pure de-duplicator, NOT a cache:
     - nothing is retained after settle (the in-flight map is always cleaned
       up in a finally), so the existing TTL cache stays the only thing that
       decides what is fresh;
     - a rejection propagates to every joined caller exactly as it would have
       if each had fetched on its own, so per-call .catch() fallbacks still
       fire. No error is swallowed or shared past settle.
   Callers must keep their normal cacheGet/cacheSet around it. */
const inFlight = new Map();

function dedupe(key, fn) {
  const running = inFlight.get(key);
  if (running) return running;
  // fn() may throw synchronously — wrapping in an async IIFE turns that into a
  // rejection so cleanup still runs.
  // The promise we STORE is the same one we RETURN (cleanup attached first),
  // so every joined caller gets an identical, already-handled promise. Storing
  // the pre-`finally` promise instead would hand late callers a branch with no
  // rejection handler of its own and can surface as an unhandled rejection.
  const p = (async () => fn())().finally(() => {
    // Only clear our own entry; a later call may have re-registered the key.
    if (inFlight.get(key) === p) inFlight.delete(key);
  });
  inFlight.set(key, p);
  return p;
}

module.exports = {
  cache,
  CACHE_TTL,
  LIVE_CACHE_TTL,
  cacheGet,
  cacheSet,
  dedupe,
  inFlight,
};
