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

module.exports = {
  cache,
  CACHE_TTL,
  LIVE_CACHE_TTL,
  cacheGet,
  cacheSet,
};
