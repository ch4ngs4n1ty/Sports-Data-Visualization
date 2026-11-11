/* ============================================================
   PLAYIQ — NBA SLATE SIGNALS (client)
   Thin fetcher for /api/nba/slate-signals — the NBA hot-play triage
   (see server/nba/slate-signals.js). Same cold-start retry shape as
   fetchMlbSlateSignals, and degrades to [] so cards render bare.

   Global-scope note: every script shares one scope, so helpers here are
   prefixed `_nbaSig*` to stay clear of names in frontend/data/nba/index.js.
   ============================================================ */

// Returns the whole payload: { signals, partial?, pendingEventIds?, refreshing? }.
//   partial     — the server is mid-build; `signals` holds the games done so
//                 far and `pendingEventIds` the rest. Poll again shortly.
//   refreshing  — a previous complete result, served instantly while the
//                 server rebuilds behind it.
// Retries ONLY what a retry can fix: a network error (Render cold start) or a
// 5xx. A 4xx — e.g. a backend that predates this route — fails immediately
// instead of burning ~40s of backoff before rendering bare cards.
async function fetchNbaSlateSignals(date, attempt = 0) {
  const BACKOFF = [1500, 3000, 6000, 12000, 18000];
  let r;
  try {
    r = await fetch(`${API_BASE}/api/nba/slate-signals${date ? `?date=${encodeURIComponent(date)}` : ''}`);
  } catch (e) {
    r = null;
  }
  if (r && r.ok) {
    try {
      const d = await r.json();
      return { ...d, signals: d.signals || [] };
    } catch { /* malformed body: treat like a 5xx */ }
  }
  if (r && r.status >= 400 && r.status < 500) return { signals: [] };
  if (attempt < BACKOFF.length) {
    await new Promise(res => setTimeout(res, BACKOFF[attempt]));
    return fetchNbaSlateSignals(date, attempt + 1);
  }
  return { signals: [] };
}

// Match a card to its entry. ESPN event id is exact (both sides read the same
// ESPN scoreboard); full team names are the fallback.
function _nbaSigNorm(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }
function findNbaSignals(list, eventId, awayFull, homeFull) {
  const arr = list || [];
  let e = eventId ? arr.find(g => String(g.eventId) === String(eventId)) : null;
  if (!e) {
    const aq = _nbaSigNorm(awayFull), hq = _nbaSigNorm(homeFull);
    e = arr.find(g => _nbaSigNorm(g.away) === aq && _nbaSigNorm(g.home) === hq) || null;
  }
  return e && e.top ? e : null;
}

Object.assign(window, { fetchNbaSlateSignals, findNbaSignals });
