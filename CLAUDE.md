# PlayIQ — Project Blueprint for Claude

## What This Project Is
PlayIQ is a dark-mode sports betting intelligence dashboard. The user types a game (e.g. "Lakers vs Warriors"), and the app fetches live ESPN data, renders it across multiple tabs, then uses the Claude API to generate AI betting plays and discuss the user's proposed plays.

It is a **100% frontend project** — no backend, no build step, no framework. The current structure is still lightweight, but sport-specific config now lives in per-sport folders.

---

## File Structure
```
playiq/
├── index.html              — Layout, all HTML sections and tab structure
├── styles.css              — All styling (CSS variables, dark theme, components)
├── app.js                  — Shared app logic (ESPN fetching, rendering, Claude API calls)
├── sports/
│   ├── nba/config.js       — NBA stat and prop config
│   ├── mlb/config.js       — MLB stat and prop config
│   ├── nhl/config.js       — NHL stat and prop config
│   └── ncaab/config.js     — NCAAB stat and prop config
└── CLAUDE.md               — This file
```

---

## Tech Stack
- **Vanilla HTML/CSS/JS** — no React, no bundler, no dependencies to install
- **Chart.js 4.4.0** — loaded via CDN for scoring/trend charts
- **ESPN Public API** — undocumented but free, no key needed
- **Claude API (Haiku)** — called directly from the browser using `anthropic-dangerous-direct-browser-access: true` header
- **Fonts** — Bebas Neue (display), IBM Plex Mono (mono/UI), IBM Plex Sans (body) via Google Fonts

---

## CSS Design System
All colors and fonts are defined as CSS variables in `:root` inside `styles.css`.

```css
--bg, --bg2, --bg3, --bg4   /* background layers, darkest to lightest */
--border, --border2          /* subtle borders */
--text, --text2, --text3     /* text hierarchy */
--lime    #d4f53c            /* PRIMARY accent — used for highlights, CTAs, active states */
--blue    #4d8bff            /* away team color, spread plays */
--red     #ff3d5a            /* losses, injuries OUT */
--orange  #ff8c42            /* doubtful injuries */
--green   #23d18b            /* wins, strong verdicts */
--yellow  #f5c842            /* questionable, lean verdicts */
--font-d  Bebas Neue         /* display/headings */
--font-m  IBM Plex Mono      /* UI text, inputs, tables */
--font-s  IBM Plex Sans      /* body copy, reasoning text */
```

**Never use Inter, Roboto, Arial, or system fonts.** Always use the variables above.

---

## App State (`S` object in app.js)
```js
S.apiKey        // Claude API key, persisted in localStorage as 'piq_key'
S.recentSearches // Array of last 6 searches, persisted as 'piq_recent'
S.gameData      // Full fetched game context object (set after analysis runs)
S.charts        // Chart.js instances keyed by name (destroy before recreating)
```

---

## ESPN API Layer

### Sport definitions
```js
const SPORTS = [
  { key: 'nba',    sport: 'basketball', league: 'nba' },
  { key: 'nfl',    sport: 'football',   league: 'nfl' },
  { key: 'mlb',    sport: 'baseball',   league: 'mlb' },
  { key: 'nhl',    sport: 'hockey',     league: 'nhl' },
  { key: 'ncaamb', sport: 'basketball', league: 'mens-college-basketball' },
  { key: 'ncaafb', sport: 'football',   league: 'college-football' },
]
```

### Key ESPN endpoints used
```
Scoreboard:  https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard
Injuries:    https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/injuries
Team sched:  https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/teams/{teamId}/schedule?season=2025
Roster:      https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/teams/{teamId}/roster
```

### All ESPN calls go through the `espn(url)` helper
```js
async function espn(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
```
**Always use this helper — never call fetch() directly for ESPN.**

---

## Core Flow: `startAnalysis()`
This is the main entry point. It runs sequentially:

1. `parseGameInput(raw)` — splits "Team A vs Team B" into `{ away, home }`
2. `findGame(parsed)` — loops all sports scoreboards, fuzzy-matches team names, returns `gameInfo`
3. `fetchInjuries(gameInfo)` — returns `{ away: [], home: [] }` injury arrays
4. `fetchTeamForm(sportKey, teamId)` — returns last 5 completed games as result objects
5. `fetchH2H(gameInfo)` — searches away team schedule for games vs home team
6. `fetchRoster(sportKey, teamId)` — returns player list with position/jersey/status
7. All data assembled into `S.gameData` then rendered into tabs
8. `generateAIPlays(S.gameData)` — async Claude call, does not block tab rendering

---

## `gameInfo` Object Shape
Returned by `findGame()`, used everywhere:
```js
{
  sportKey,       // 'nba' | 'nfl' | 'mlb' | 'nhl'
  sportLabel,     // 'NBA' | 'NFL' etc
  sport,          // 'basketball' | 'football' etc (ESPN path segment)
  league,         // 'nba' | 'nfl' etc (ESPN path segment)
  eventId,        // ESPN event ID string
  awayFull,       // "Los Angeles Lakers"
  awayAbbr,       // "LAL"
  awayTeamId,     // ESPN internal team ID
  homeFull,       // "Golden State Warriors"
  homeAbbr,       // "GSW"
  homeTeamId,
  spread,         // "LAL -4.5" or null
  overUnder,      // 224.5 or null
  awayMoneyline,  // -185 or null
  homeMoneyline,  // +155 or null
  statusText,     // "Final" | "Scheduled" | "In Progress"
  statusState,    // "post" | "pre" | "in"
  date,           // ISO date string
  venue,          // "Crypto.com Arena"
}
```

---

## Team Name Matching (`findGame`)
The fuzzy match logic checks if the query appears in the ESPN team's full name, abbreviation, or short name. This is the most common source of bugs.

**If a team isn't resolving:**
- Try full city + name: `"Los Angeles Lakers"` not just `"Lakers"`
- Try the ESPN abbreviation: `"LAL"`, `"GSW"`, `"KC"` etc
- The matching logic is in `findGame()` — improve it there, not at the call site

```js
const awayMatch =
  awayName.includes(awayQ) ||
  awayQ.includes(away.team.abbreviation.toLowerCase()) ||
  awayQ.split(' ').some(w => w.length > 3 && awayName.includes(w));
```

---

## Claude API Calls

### Headers required (always include both)
```js
headers: {
  'Content-Type': 'application/json',
  'x-api-key': S.apiKey,
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',  // REQUIRED for browser calls
}
```

### Model
Always use `claude-haiku-4-5-20251001` unless the user explicitly asks for a smarter/more expensive model. Haiku is fast and cheap for this use case.

### Two Claude calls in the app
1. **`generateAIPlays(data)`** — generates spread, total, 2 props, 1 parlay. Returns JSON array of play objects.
2. **`discussUserPlay()`** — evaluates the user's proposed play. Returns confidence %, verdict, for/against arguments.

### Response parsing pattern
```js
const text = d.content?.[0]?.text || '';
let result;
try {
  result = JSON.parse(text.replace(/```json|```/g, '').trim());
} catch {
  // handle parse failure gracefully
}
```

---

## Tab System
Tabs are rendered in HTML with `data-tab` attributes. `switchTab(name)` handles all switching.

```
overview  → #tab-overview   (team comparison, charts)
roster    → #tab-roster      (player tables)
form      → #tab-form        (last 5 games)
h2h       → #tab-h2h         (head to head history)
injuries  → #tab-injuries    (injury report)
plays     → #tab-plays       (AI plays + user play discussion)
```

---

## Chart.js Usage
- All chart instances are stored in `S.charts` by key
- **Always destroy before recreating:** `if (S.charts.score) S.charts.score.destroy();`
- Use `chartOpts()` helper for consistent dark theme defaults
- Current charts: `score` (line), `trend` (bar) in Overview tab

---

## Known Limitations / Common Issues

| Issue | Cause | Fix |
|---|---|---|
| Team not found | Name fuzzy match too loose/strict | Edit `findGame()` match logic |
| ESPN returns null | Game not on today's scoreboard | Game may be in the past or future |
| No H2H data | Teams haven't played this season | Expected — show empty state |
| Roster empty | ESPN API structure varies by sport | Check `data.athletes` shape |
| Claude parse error | Model returned non-JSON | Improve prompt or add retry |
| API key error | Missing header | Ensure `anthropic-dangerous-direct-browser-access: true` is set |

---

## How to Add a New Feature

### Add a new tab
1. Add button in `.tab-bar` in `index.html` with `data-tab="newtab"`
2. Add `<div class="tab-pane hidden" id="tab-newtab">` in `.tab-content`
3. Add render function `renderNewTab(data)` in `app.js`
4. Call it inside `startAnalysis()` after data is fetched

### Add a new ESPN data source
1. Add the URL pattern to the `ESPN` const block or inline in a new fetch function
2. Follow the `async function fetchXxx(gameInfo)` pattern
3. Add to `S.gameData` object
4. Pass through to render and Claude context via `buildGameContext()`

### Improve Claude's play quality
- Edit the prompt string inside `generateAIPlays()` 
- The JSON schema in the prompt defines exactly what gets rendered
- Adding more game context to `buildGameContext()` directly improves output quality

---

## Style Guide
- CSS variables only — no hardcoded hex colors in new code
- New components follow existing card pattern: `background: var(--bg2); border: 1px solid var(--border); border-radius: 8px`
- Accent color for interactive/highlighted elements: `var(--lime)`
- All new text uses `var(--font-m)` by default, `var(--font-d)` for display headings only
- Animations: use existing `fadeIn` and `slideUp` keyframes, don't add new ones unless necessary
