# PlayIQ — Project Blueprint for Claude

## What This Project Is
PlayIQ is a dark-mode sports betting intelligence dashboard with an HUD / sci-fi aesthetic. The user picks a sport → browses today's games → drills into a game for deep analysis across multiple tabs (Overview, H2H, Last 5, Rosters, MLB Edge Finder, Pitching, Low HR Model, High Contact, AI Plays).

It is a **full-stack app** with a vanilla-JS Node backend and a React-via-CDN browser frontend (no build step).

---

## File Structure
```
playiq/
├── index.html                                  — Shell: React + Babel CDN, nav, API-key input, global CSS
├── frontend/
│   ├── data/
│   │   ├── shared/core.js                      — ESPN helpers, SPORTS_CONFIG, fetchAllGames, fetchTeamForm, fetchH2H, fetchInjuries, fetchRoster, Claude API, AI plays
│   │   ├── mlb/index.js                        — MLB-only helpers: fetchGameBvp, fetchHighContactReport, fetchWeather, fetchMlbStarters, fetchPlayerGameLog, buildMlbEdgeData
│   │   ├── nba/index.js                        — NBA-only helpers: fetchHoopsPlayerGameLog (shared w/ WNBA), buildNbaEdgeData (incl. per-player `proj` distribution), lineup + positional-defense fetchers, threshold projection model (nbaThresholdProbability + buckets)
│   │   ├── nfl/index.js                        — NFL-only helpers: fetchNflCurrentWeek + fetchNflWeek (WEEKLY slate — a date-keyed query is empty ~4 days a week), enrichNflFormWithPlayerStats (football box scores are split into stat GROUPS, so the shared statistics[0] reader sees passing only), fetchNflTeamProfile (offense from results.stats, defense from results.opponent)
│   │   └── wnba/index.js                       — WNBA: buildWnbaEdgeData + buildWnbaLineupData (starters from ESPN boxscore once live; top-5-by-minutes projection pre-game). Reuses the basketball gamelog parser + the (sport-agnostic) threshold model; NO Rotowire lineups / defense-vs-position (NBA-only backends), so boards run without a matchup adjustment. `NbaEdgeFinderTab` is reused for WNBA (gated on `gameInfo.sportKey === 'wnba'`); the LINEUPS tab instead dispatches to `WnbaCourtLineupTab` (3D court view) rather than `NbaLineupTab`
│   ├── shared/
│   │   ├── ui-atoms.jsx                        — Primitive UI components (HudCard, PlayerCard, Sparkline, OpsGauge, WeatherPill, TabLoader, etc.). `GameLogChart` renders bars in ARRAY ORDER (callers decide chronology — hoops passes `nbaOldestFirst()` so time runs left→right) and labels each bar with the opponent's **team logo** when the game object carries `oppLogo`, falling back to the `vs/@ABBR` text when it doesn't (MLB logs currently fall back)
│   │   ├── tabs/common-tabs.jsx                — Sport-agnostic tabs: OverviewTab, H2HTab, FormTab, RosterTab, AIPlaysTab
│   │   └── screens/
│   │       ├── home-screen.jsx                 — HomeScreen (sport picker)
│   │       ├── games-screen.jsx                — GamesScreen (today's games; MLB cards show a research-readiness strip: SP + LINEUP pills + ● READY, from /api/mlb/games readiness flags, plus a `SignalBadge` hot-play indicator — 🔥 HOT PLAY / ▲ LEAN / • LOOK, ⚠ FADE SP for a vulnerable starter, or ◐ CHECK MATCHUP when a streak's matchup argues against it — from /api/mlb/slate-signals. The badge leads with the streak + the `market` it points at, then renders `AngleChip`s (VS SP / VS TEAM / ORDER) that name the angle AND the tab to verify it in; a "🔥 N WITH PLAYS" toolbar toggle filters the slate down to games that have one)
│   │       └── game-detail-screen.jsx          — GameDetailScreen + TABS_MLB / TABS_NBA / TABS_OTHER + Phase 1 / Phase 2 loading
│   └── sports/
│       ├── mlb/tabs.jsx                        — MLB-specific tabs: MlbDataLoader + useMlbLoadGate (baseball pitch-loop loader with progress bar; on data arrival the bat connects and the ball leaves the park — keyframes injected at runtime, not in index.html), EdgeFinderTab (incl. PROP PROJECTION MODEL board: transparent Log5 P(Hits/RBI/K≥line)), PitchingEdgeTab (incl. PITCHER PROJECTION MODEL board: P(K/Outs/ER/HR≥line) + per-start bar charts), MlbLineupFieldTab (3D CSS-perspective diamond: each starter's card at their fielding position; field rotateX + cards counter-rotated so text stays crisp — no WebGL), LowHrModelTab, HighContactTab, MlbPlayerLookupTab (this IS the MLB `roster` tab — search/type-ahead + one hitter vs today's starter WITHOUT a posted lineup, with `RosterTab`'s 40-man grids embedded underneath; a card click runs the lookup in place)
│       ├── nfl/tabs.jsx                        — NFL-specific tabs: NflMatchupTab (season OFFENSE/DEFENSE comparison board; brighter value = better side, direction-aware so "fewer yards allowed" wins). NflEdgeFinderTab (Last 5 + every career game vs tonight's opponent, season-by-season timeline; real game logs + hit rates vs a typed line, NO projection model).
│       └── nba/tabs.jsx                        — NBA-specific tabs: NbaEdgeFinderTab (incl. PROJECTION MODEL board: P(stat≥line) per player), NbaLineupTab, NbaDefenseVsPositionTab, WnbaCourtLineupTab (WNBA LINEUPS tab: 3D CSS-perspective court, both fives placed at the spot they play — court plane rotateX + cards counter-rotated so text stays crisp, no WebGL; same technique as `MlbLineupFieldTab`. Slots are resolved interior-first with a G/F/C preference chain, because WNBA positions are coarse and small-ball fives would otherwise strand a guard at the rim)
├── manifest.json                               — PWA manifest
├── icon.svg                                    — PWA icon
├── server/
│   ├── index.js                                — Node HTTP server (port 3001): routes to mlb/ and nba/ services
│   ├── shared/{cache.js,http.js}               — In-memory cache + fetch helpers
│   ├── index.js                                — Node HTTP server (also loads + scores the F5 model)
│   ├── mlb/service.js                          — MLB Stats API + Baseball Savant: games, lineups, BvP, weather, high-contact report (pitcher stats + arsenal + splits + bullpen + scoring, each sub-score carries a `methodology` entry: source + exact endpoint + inputs + formula for verifiability), low-HR model, F5 money-line model (buildF5Features + scoreF5 zero-dep XGBoost tree-walker; folded into the high-contact report as `f5`), batter-prop model (`getBatterPropModel`: transparent Log5 + Binomial/Poisson, served at `/api/mlb/prop-model` — no ML, computed live), pitcher-prop model (`getPitcherPropModel`: P(K/Outs/ER/HR ≥ line) via Log5 K-matchup + Binomial/Normal/Poisson + per-start log, served at `/api/mlb/pitcher-props`), manual player lookup (`getPlayerLookup` / `getGamePlayerDirectory`, served at `/api/mlb/player-lookup` + `/api/mlb/game-players`: resolves a typed/clicked name against both 40-man rosters and runs the SAME BvP + Log5 projection for one batter, so research works before a batting order posts)
│   ├── mlb/slate-signals.js                    — Slate-wide "is there a play here, and WHICH point do I look at?" triage (`getSlateSignals`, served at `/api/mlb/slate-signals`). A signal is a STREAK + at least one MATCHUP ANGLE: a consecutive-game run read off the real game log (multi-hit / hits / RBI / HR / total bases / on-base; for SP: 6+K, QS, ≤2ER, or 5+ER as a fade) is the entry ticket — a merely-hot rate line no longer badges anything — and `angles[]` carries the reasons to look, each tagged `kind: 'streak'|'bvp'|'vsteam'|'order'|'form'` with a `direction`. NOT HR-centric: `market` names the prop the streak actually points at. Hitters are scored only if they're in the posted lineup (else `confirmed:false` and discounted 25%); a starter with a ≥6.00 ERA surfaces as `direction:'fade'`, and a hot bat that owns a bad career line vs tonight's arm surfaces as `direction:'caution'`. Transparent additive scoring — NOT ML, and every signal carries a `why` string.
│   ├── data/{f5_model.json,f5_feature_spec.json}  — F5 XGBoost model + feature contract (committed by CI; see ml/)
│   ├── nba/{service.js,positional-defense.js,positions.js}  — NBA endpoints (lineups, def-vs-position)
│   ├── package.json
│   ├── start.sh                                — Kills any existing :3001 process, starts server in background, logs to server.log
│   └── server.log
├── ml/                                         — OFFLINE XGBoost pipeline for the F5 model (Python; runs in CI, not in the app)
│   ├── f5_common.py                            — shared feature order + park table + fallbacks (parity contract)
│   ├── collect_mlb_f5.py                       — builds leak-free dataset from MLB schedule + pitcher game logs
│   ├── train_f5.py                             — trains XGBoost multi:softprob, exports full-precision trees + parity samples
│   └── README.md                               — how the pipeline + CI automation work
├── .github/workflows/train-f5.yml             — weekly retrain → commit model → Render autoDeploy
└── CLAUDE.md                                   — This file
```

**IMPORTANT** — `data-layer.js`, `tabs.jsx`, `screens-v2.jsx`, `ui-atoms.jsx` in the repo root are dead legacy files NOT loaded by `index.html` (leftovers from before the `frontend/` reorg). Always edit the `frontend/` paths above; editing the root files will compile fine but nothing will change in the browser.

---

## Tech Stack
### Frontend (browser, no build step)
- **React 18 + Babel Standalone** via unpkg CDN — `.jsx` files are Babel-transpiled in the browser (`<script type="text/babel" src="…">`)
- **ESPN public API** — undocumented but free, no key
- **Claude API (Haiku)** — called directly from browser using `anthropic-dangerous-direct-browser-access: true`. API key is entered in the top nav and persisted to `localStorage` as `piq_key`.
- **Fonts** — Orbitron (display, Bebas-like caps) + Space Mono (all UI / body) via Google Fonts

### Backend (Node, zero dependencies)
- Pure `http` + `https` — no npm deps, run with `node server/index.js` (or `./server/start.sh` to daemonize)
- Serves MLB Stats API data (schedule, lineups, weather, probable pitchers) and Baseball Savant BvP analytics at `http://localhost:3001`
- In-memory cache with 2-min TTL for live data, 15-min TTL for BvP

---

## CSS Design System
All colors are CSS variables in `:root` in `index.html`.

```css
--bg        #05080f   /* page background (near-black navy) */
--surface   #090d1a   /* subtle panel bg */
--card      #0d1524   /* card bg */
--cyan      #00d4ff   /* PRIMARY accent — links, highlights, away team */
--green     #00ff88   /* wins, live pulse, positive edges */
--orange    #ff6b35   /* losses, injuries OUT, negative edges */
--gold      #ffd060   /* home team, lean verdicts, warnings */
--text      #c0d4e8   /* primary text */
--muted     #4a6080   /* secondary text */
--dim       #2a3a50   /* dividers, placeholders, disabled */
```

**Fonts:** always `'Orbitron, monospace'` for display headings/numbers, `'Space Mono, monospace'` for everything else. Never use Inter, Roboto, Arial, or system fonts.

**Card pattern:** `HudCard` atom (corner brackets that brighten on hover) — use it everywhere instead of plain divs.

---

## Frontend Architecture

### Script load order (matters — later scripts depend on earlier)
1. `data-layer.js` — regular `<script>`, exports helpers to `window`
2. `ui-atoms.jsx` — `<script type="text/babel">`, defines primitives, exports to `window`
3. `tabs.jsx` — defines tab components, uses atoms
4. `screens-v2.jsx` — defines HomeScreen / GamesScreen / GameDetailScreen, uses atoms + tabs
5. Inline `<script type="text/babel">` in `index.html` — defines `<App>` + `ApiKeyInput` and mounts to `#root`

Because there is no bundler, components communicate by attaching to `window` (`Object.assign(window, { HudCard, … })`). Always remember to export new components this way.

### App state (React)
- Top-level `view` state: `'home' | 'games' | 'detail'` — persisted in `sessionStorage.piq_view`
- `selectedSport` (for games view), `selectedGame` (for detail view) — `sessionStorage.piq_game`
- `tab` state inside `GameDetailScreen` — persisted in `sessionStorage.piq_tab`
- Claude API key — `localStorage.piq_key` (typed into `ApiKeyInput` in the top nav)

### Screens
- **HomeScreen** (`screens-v2.jsx`) — sport picker grid (MLB/NBA/NHL/NCAAB)
- **GamesScreen** (`screens-v2.jsx`) — today's games from all active sports, date picker, sport filter tabs
- **GameDetailScreen** (`screens-v2.jsx`) — orchestrates the tab bar + per-tab data loading. Loads form/injuries/rosters/H2H in parallel, then (MLB only) fetches BvP and builds edge data. MLB gets extra tabs: `edges` and `pitching`.

### Tabs (all in `tabs.jsx`)
- `OverviewTab` — side-by-side team stats (W/L, streak, avg PF/PA, FormDots) + injury blocks
- `H2HTab` — last 5 matchups with stat leaders per game
- `FormTab` — last N games with best player per stat (PTS/REB/AST for NBA, H/RBI/R for MLB)
- `RosterTab` — grid of PlayerCards with status pills
- `EdgeFinderTab` (MLB only) — per-batter BvP vs. today's starter: AVG/OBP/SLG/OPS gauge + bar chart + sparkline
- `PitchingEdgeTab` (MLB only) — starting pitcher cards: ERA/WHIP/record
- `AIPlaysTab` — generate plays via Claude + free-form "discuss your play" box

---

## Data Layer (`data-layer.js`)

Everything attaches to `window` for cross-script access. Exports include:

| Function | Purpose |
|---|---|
| `fetchAllGames(date)` | ESPN scoreboards for all `SPORTS_CONFIG` sports on a given date |
| `fetchTeamForm(sportKey, teamId)` | Last 10 completed games, W/L, scores |
| `enrichFormWithPlayerStats(sportKey, teamId, formGames)` | Attaches top player (PTS/H/etc.) per game via ESPN box scores |
| `fetchH2H(gameInfo)` | Last 5 head-to-head across last 3 seasons, with stat leaders |
| `fetchInjuries(gameInfo)` | ESPN injuries for both teams |
| `fetchRoster(sportKey, teamId)` | Full roster with status + headshot |
| `fetchTeamStats(sportKey, teamId)` | Team season stats |
| `fetchMlbStarters(gameInfo)` | ESPN probable pitchers + lineups for an MLB game |
| `fetchGameBvp(gameInfo, lineups, pitchers)` | Calls **our backend** `/api/mlb/game-bvp` for Savant BvP |
| `fetchWeather(gamePk)` | Calls **our backend** `/api/mlb/weather` |
| `buildMlbEdgeData(gameInfo, bvpData)` | Shapes BvP output for `EdgeFinderTab` |
| `generateAIPlays(gameData)` | Claude call for 3 recommended plays (returns `{error:'NO_API_KEY'}` when key missing) |
| `claudeComplete(prompt, opts)` | Low-level Claude call — used by `AIPlaysTab` discuss flow |

`SPORTS_CONFIG` is the single source of truth for which sports/leagues are wired up: `mlb`, `nba`, `wnba`, `nhl`, `ncaamb`. Add a new sport by appending here.

**Gotcha when adding a sport:** `teamLogoUrl` has a `pro` allowlist — leagues NOT in it fall through to the NCAA *team-id* logo path and render no logo. Add the league there too (this is why `wnba` is listed).

### ESPN fetch helper
```js
async function espnFetch(url) {
  try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : null; }
  catch { return null; }
}
```
Always use this (never bare `fetch`) for ESPN calls.

---

## Claude API Integration

### Direct browser → Anthropic (requires user-supplied key)
The `ApiKeyInput` atom in the top nav writes `sk-ant-…` keys to `localStorage.piq_key`. `claudeComplete()` reads it and POSTs directly to `https://api.anthropic.com/v1/messages`.

### Required headers
```js
'Content-Type': 'application/json',
'x-api-key': getApiKey(),
'anthropic-version': '2023-06-01',
'anthropic-dangerous-direct-browser-access': 'true',  // REQUIRED for browser calls
```

### Model
Always `claude-haiku-4-5-20251001` unless the user explicitly asks for a smarter/more expensive model.

### Response parsing pattern
```js
const text = data.content?.[0]?.text || '';
const match = text.match(/\[[\s\S]*\]/);   // for JSON-array responses
if (match) return JSON.parse(match[0]);
```

### Compatibility shim
For any legacy code that calls `window.claude.complete(prompt)`, `data-layer.js` installs a shim pointing at `claudeComplete` so it just works.

---

## Backend (`server/index.js`)

- Port **3001**, zero npm deps, pure Node `http` + `https`
- CORS is open so the browser frontend can call it directly
- Start: `./server/start.sh` (kills any existing :3001 process, daemonizes to `server/server.log`) or `node server/index.js` for foreground
- Key endpoints (consumed by `data-layer.js`):
  - `GET /api/mlb/game-bvp?away=&home=&date=&awayLineup=&homeLineup=&awayPitcher=&homePitcher=` — per-batter BvP vs. starter
  - `GET /api/mlb/weather?gamePk=…` — MLB park weather / roof / wind
  - `GET /api/mlb/slate-signals?date=YYYY-MM-DD` — hot-play triage for the WHOLE slate in one call: `{ date, signals: [{ gamePk, away, home, tier, count, top, signals[] }] }`. Each signal carries `{ kind:'batter'|'pitcher', name, team, side, score, direction:'back'|'fade'|'caution', market, stat, streak:{key,games,label,line}, angles:[{kind,direction,text}], why, confirmed, order, detail }`. Cached 10 min (team form + batter game logs 30 min, career BvP / vs-team + pitcher logs 6 h), concurrency-limited to 4 games at a time. **Every per-player stat is fetched via ONE bulk `people?personIds=…&hydrate=stats(…)` call per team** — that is what makes career BvP-vs-tonight's-starter affordable slate-wide (~6 calls/game, ~3.5s for 15 games) instead of ~270 per-player calls. Savant's per-pair CSV (`fetchSavantBvP`) is far too expensive here; StatsAPI `vsPlayerTotal` / `vsTeamTotal` give the same career line in one hydrate.
  - `GET /api/mlb/player-lookup?player=<name|id>&gamePk=…` (or `&away=&home=&date=`) — ONE batter vs today's opposing starter: career BvP (game-by-game, weather-enriched) + the same Log5 prop projection the Edge Finder shows. `player` is a full name, a last name, or an MLB id. Lineup-independent — the whole point is that it works before a batting order posts. Returns a structured `{error}` for `PLAYER_NOT_FOUND` / `AMBIGUOUS_NAME` / `NO_OPPOSING_PITCHER` rather than a 500.
  - `GET /api/mlb/game-players?gamePk=…` — both 40-man hitter lists (pitchers excluded) for the lookup type-ahead.
- Internal caches: 2-min for live MLB, 15-min for historical BvP (max 500 entries, LRU eviction)
- **In-flight coalescing (`dedupe` in `server/shared/cache.js`)** — the TTL cache
  is only written *after* a fetch resolves, so simultaneous callers all miss it
  and all fetch. `dedupe(key, fn)` hands concurrent callers the promise already
  running for that key. It is NOT a cache: nothing is retained after settle, and
  a rejection reaches every joined caller, so existing `.catch()` fallbacks are
  unaffected. Used by `fetchSavantBvP`, `getBatterHitProfile`, `getBatterHand`,
  `getPitcherStats` and `getArsenalIndex` — each keeps its normal
  `cacheGet`/`cacheSet` around the `dedupe` call, and re-checks the cache inside
  it (a caller that queued may have had its answer filled while waiting).
  A `refresh:true` caller dedupes on a separate `refresh_` key so it is never
  served by a coalesced normal fetch.

**Rule: maintain the backend's current shape.** Add new endpoints rather than mutating existing ones, and keep it dependency-free.

---

## NFL

Added Sep 2026. NFL is the first non-daily sport in the app, and that drove
every design decision worth knowing about:

- **Weekly cadence.** `fetchAllGames(date)` queries every sport by date, but NFL
  plays ~3 days a week, so on most days it would simply vanish from the slate.
  When the requested date has no NFL games, `fetchAllGames` folds in the rest of
  the current week via `fetchNflWeek()` and tags each game `weekFallback: true`.
  `GameCard` reads that flag and prefixes the kickoff time with the weekday
  ("Thu, Sep 17 · 8:15 PM EDT") — without it a Sunday game shown on Wednesday
  reads as if it were today.
- **The week number comes from ESPN**, not from arithmetic on a season-start
  date (which drifts yearly and breaks when the playoff week counter restarts).
- **Football box scores are split into stat groups** (`passing`, `rushing`,
  `receiving`, …), each with its own `labels` array. The shared
  `enrichFormWithPlayerStats` reads `statistics[0]`, which for NFL is passing
  only, so NFL uses `enrichNflFormWithPlayerStats` instead. It also attaches
  `cats` to each form game — **without `cats`, `FormTab` falls back to
  basketball keys (pts/reb/ast) and every card renders blank.**
- **Team statistics endpoint gotchas** (verified against a live payload, not
  guessed): there is **no `rank` field**; `totalYards` lives under `rushing`,
  not `passing`; third-down and turnover stats live under `miscellaneous`. The
  only defensive data is `results.opponent`, which mirrors the whole stat tree
  with what opponents did against the team (this is where points-allowed lives).

`fetchRoster` and `fetchH2H` needed no changes — the grouped-roster shape and
`seasontype=[2,3]` already covered football.

**Scope:** MATCHUP, EDGE FINDER, LIVE, plus the five sport-agnostic tabs. There
is still no NFL projection/props model or ML — the Edge Finder shows real logs,
not probabilities, on purpose.

### NFL Edge Finder (Sep 2026)

`NflEdgeFinderTab` (`frontend/sports/nfl/tabs.jsx`), data in
`frontend/data/nfl/index.js` (`buildNflEdgeData`, `fetchNflPlayerCareerLog`,
`summarizeNflPlayerLog`). Per player: L5, career vs tonight's opponent (every
season, reg + playoffs), a per-season TIMELINE with the year on every game, and
hit rates once a prop line is typed. A top VS-TEAM EDGES board ranks career-vs-
opponent avg against the player's last-17 avg, sample size on every row.

Things verified against live payloads, not guessed:
- **Who:** ESPN `teams/{id}/depthcharts`. The offensive chart's NAME varies by
  personnel ("3WR 1TE"), so pick the chart that has a `qb` slot; take
  `qb/rb/wr1/wr2/wr3/te` [0]. Roster order is only a fallback.
- **Game log:** `site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{id}/gamelog?season=`.
  Index columns by `names` (unique camelCase) — `labels` repeat `YDS` for pass
  AND rush. Each player's payload only has his own stat groups; missing → 0.
- **`filters[season].options` lists every season the player has logged** —
  that's how "every season" costs exactly one call per real season.
- `?season=2025` includes the Jan-2026 playoffs: `season` on a game is the NFL
  season, the bar/timeline YEAR comes from `rawDate` (they differ in January).
- vs-team matches on opponent **team id** (stable across OAK→LV etc.), and
  `meta.team` records who the player was WITH, rendered as `w/ CHI` chips.
- Early in a season L5 must span two seasons, so the board always loads
  current + previous; older seasons load per card in the background through a
  6-wide limiter and a page-lifetime cache (past seasons are immutable).
- An all-zero line (rested week-18 starter) is flagged `dnp` and excluded from
  averages, otherwise it drags every mean toward 0.
- Bars use `nflColorFor` (over/under the typed line, else vs baseline) — the
  shared `defaultStatColorFor` is tuned for 0/1/2 MLB counts and would paint
  every yardage bar green.
- Headless-Chrome testing: ESPN answers `HeadlessChrome` UAs WITHOUT CORS
  headers, so every fetch fails; set a normal Chrome UA.

---

## Machine Learning (F5 money-line model)

The only ML model in the app. Predicts the **first-5-innings money line** (3-way: home/tie/away leads after 5), shown atop the MLB **High Contact** tab via `F5MoneyLineCard`.

- **Trained offline** with real XGBoost in `ml/` (Python), **never in the app**. GitHub Actions retrains weekly and commits `server/data/f5_model.json`; Render auto-deploys. The user never runs Python.
- **Scored live, zero-dep**: `scoreF5()` in `server/mlb/service.js` walks the exported trees (full-precision, round-robin tree→class + per-class `base_margin`, softmax) — no ML library in the runtime.
- **Train/serve parity is load-bearing**: features are defined once (`ml/f5_common.py` ↔ `server/data/f5_feature_spec.json`) and must be computed identically by `collect_mlb_f5.py` (historical) and `buildF5Features()` (live). `train_f5.py` embeds `parity_samples` so the Node scorer can self-check (expect ~1e-7). If you change a feature, change BOTH sides and retrain.
- Don't add an ML dependency to the Node app or a build step. Keep training in `ml/`. See `ml/README.md`.

---

## Known limitations / common issues

| Issue | Cause | Fix |
|---|---|---|
| "No games found" | Date has no scheduled games, or all sports off-season | Try another date; NCAAB is often off-season in spring |
| AI Plays button does nothing | No API key saved | Enter `sk-ant-…` in the top nav `ApiKeyInput` |
| MLB Edge Finder says "loading or unavailable" | Backend down, lineups not announced, or `bvpData.matchups` empty | Check `server/server.log`; lineups typically post ~2h before first pitch |
| Roster empty for a team | ESPN API structure varies by sport | Inspect `data.athletes` shape in `fetchRoster` |
| Claude returns non-JSON | Prompt drifted | Tighten the prompt in `generateAIPlays` — the app expects a single `[…]` array |
| Logos missing | ESPN CDN path differs for NCAAB (uses teamId, not abbr) | Fix in `teamLogoUrl` |

---

## How to add a new feature

### Add a new tab
1. Write the component in `tabs.jsx`, export via the `Object.assign(window, …)` at the bottom
2. Add its id/label to `TABS_MLB` or `TABS_OTHER` in `screens-v2.jsx`
3. Add the `{tab === 'newtab' && <NewTab gameData={gameData} />}` branch inside `GameDetailScreen`
4. If it needs new data, fetch it in the `load()` effect and include it in `setGameData({...})`

### Add a new data source
1. Add a `fetchXxx` function to `data-layer.js`
2. Export it on `window` via the `Object.assign` at the bottom
3. Call it from the `load()` effect in `GameDetailScreen`, include in `gameData`

### Add a new sport
1. Append to `SPORTS_CONFIG` in `data-layer.js`
2. Add it to the `sports` array in `HomeScreen` with `active: true`
3. Fetch/rendering code in tabs is sport-agnostic for overview/form/h2h/roster; sport-specific tabs (`EdgeFinderTab`, `PitchingEdgeTab`) are gated by `game.sportKey === 'mlb'`
4. Add the league to the `pro` allowlist in `teamLogoUrl` or logos silently 404
5. **Check `FormTab`'s stat keys.** It defaults to MLB keys for `mlb` and
   basketball keys (pts/reb/ast) for *everything else*. If the new sport's
   leaders aren't PTS/REB/AST, attach a `cats: [{key,label}]` array to each form
   game (see `enrichNflFormWithPlayerStats`) — otherwise the tab renders empty
   cards with no error
6. **Verify the ESPN payload before writing against it.** Field placement varies
   by sport in ways that are not guessable (NFL keeps `totalYards` under
   `rushing` and publishes no `rank`), and a wrong key fails silently as a blank
   value rather than an exception

### Improve AI play quality
- Tune the prompt in `generateAIPlays()` — the schema is `[{play, confidence, reason, type}]`
- Add more context (injuries, weather, BvP summary) to the prompt string

---

## Player Lookup (MLB) — research before the lineup posts

Added Sep 2026. Solves a timing gap, not a data gap: sportsbooks price batter
props (and analysts post picks) hours before MLB's boxscore exposes
`battingOrder`, so every lineup-gated board — Edge Finder, prop model, Low HR,
High Contact — renders empty exactly when research is most useful. Verified on a
live slate: PHI @ NYM had BOTH probable starters known and `prop-model` still
returned 0 batters.

- **The model is unchanged.** `getPlayerLookup` reuses `fetchSavantBvP`,
  `getBatterHitProfile`, `getBatterHand` and `computeBatterProps` — the same
  functions `getBatterPropModel` calls. The ONLY difference is where the batter
  name comes from, which the response records as `resolvedFrom`
  (`name` | `lastName` | `id`). Don't fork the math.
- **Name → id goes through the roster map**, never ESPN ids. `getTeamRosterMap`
  + `resolveRosterEntry` already back the manual-lineup override, and they
  handle accents, punctuation and suffixes (`Tatis` → "Fernando Tatis Jr.",
  `J.T. Realmuto`). Full-name is matched on BOTH sides before falling back to
  last-name, so a shared surname can't silently resolve to the wrong team; a
  genuinely ambiguous last name returns `AMBIGUOUS_NAME` instead of guessing.
- **Confidence is deliberately NOT the prop model's rule.** `getBatterPropModel`
  requires `bvpPa >= 10` for HIGH, which is right once a lineup is posted. Here
  the common case is a hitter who has barely faced this starter, so confidence
  keys off the SEASON sample (`games`) and BvP only enriches `confidenceNote`.
  A 146-game regular with 9 BvP PA is a well-sampled projection, not a MED one.
- **The tab does not wait on Phase 2.** It reads ESPN's probables from
  `pitchingData.pitchers` when available, but the backend resolves the starter
  from MLB's own feed, so the lookup works on first paint. Passing the ESPN
  probable only sharpens the match when MLB's `probablePitchers` field lags.
- **It IS the MLB ROSTERS tab** (merged Sep 2026). There was never a reason to
  keep two: the only thing anyone did with an MLB roster card was click it to
  get here. `MlbPlayerLookupTab` renders the search + projection panel and then
  embeds `RosterTab` beneath it, passing `onPlayerSelect={runLookup}` so a card
  click analyzes in place (and scrolls to top) instead of switching tabs. The
  old `lookup` tab id is gone; `GameDetailScreen` rewrites a persisted
  `piq_tab === 'lookup'` to `'roster'` so a mid-session reload doesn't land on
  a tab that no longer renders.
- **`RosterTab` stays sport-agnostic.** It takes an optional `onPlayerSelect`
  and is supplied one only by the MLB lookup tab; every other sport renders it
  bare from `GameDetailScreen`, non-interactive exactly as before. Pitchers
  aren't clickable — this is a batter model; the PITCHING tab covers them.
- **Degrades in the open.** No starter announced yet → `NO_OPPOSING_PITCHER`
  with the player still resolved, rendered as an explanation rather than an
  empty card. Once the lineup posts, the response carries `inPostedLineup` +
  `order` so the tab agrees with the official lineup instead of contradicting it.

### Recent-form module (Sep 2026)

The lookup panel carries the same visual analysis the Edge Finder gives a
batter, so one hitter's page isn't thinner than the board he'd appear on:

- **Last 5 games (season)** — a `GameLogChart` over H/HR/R/RBI/K/BB, plus a
  trend line (hit streak, H/G, "trending up" / "cooling off").
- **Every meeting** — a second `GameLogChart` over the career BvP games, next
  to the existing game-by-game rows (the rows keep the weather pills, which a
  bar chart can't show).
- **Hot/cold badge** — `HotBadge` in the identity header, the same tier the
  Edge Finder assigns.

Three things worth not re-deriving:

- **No backend change.** `/api/mlb/player-lookup` already returns career BvP;
  the only missing piece was a per-game SEASON log, which the Edge Finder
  already fetches client-side. The tab calls the same `fetchPlayerGameLog` +
  `attachWeatherToGameLog`, so there is no new endpoint and no second parser.
- **The tier scorer is shared, not copied.** `scoreMlbBatterForm(gameLog,
  bvpOps)` in `frontend/data/mlb/index.js` is the block that used to sit inline
  in `buildMlbEdgeData`; both callers use it, so the two boards can't disagree
  about who is hot. Verified identical on 40k randomized logs.
- **An empty log is `neutral`, not `cold`.** The old inline code hit its cold
  branch on `l5Avg === 0`, so a batter with no games scored COLD on zero
  evidence — which here would also flash a false badge in the gap before the
  log fetch resolves. Absence of data is now explicitly neutral. This is the
  ONE intentional behaviour change to the Edge Finder's tiers.
- **The log loads after the panel.** The projection and BvP cards render from
  the lookup response immediately; the form module fills in behind them rather
  than holding up first paint.

### Bar labels: dates carry the year, opponents are logos (Sep 2026)

`GameLogChart` labels every bar with the full date **including the year** and,
where the opponent is a team, its logo instead of a text abbreviation.

- **Dates come from `rawDate`**, via `gameLogDateParts()` in `ui-atoms.jsx`.
  Every producer already carried it; `date` remains the fallback, so a game
  object without `rawDate` renders exactly as before.
- **`rawDate` has TWO shapes and they need OPPOSITE handling** — this is the
  trap, and it is verified in both directions:
  - `YYYY-MM-DD` (MLB box scores) is a calendar date. `new Date()` reads it as
    UTC midnight, which renders as the PREVIOUS day west of Greenwich, so the
    digits are read literally.
  - A full ISO stamp (ESPN hoops gamelogs) is the **tipoff instant in UTC** — a
    May 11, 7:30pm ET game is stored `2026-05-12T02:30Z`. This one MUST be
    converted to local time, or every night game shows the wrong day (and a New
    Year's Eve game shows the wrong *year*).
- **MLB opponent logos** are attached by the data layer, not the server:
  `fetchPlayerGameLog` sets `oppLogo` for the batter logs (Edge Finder + Player
  Lookup), and `withMlbOppLogos()` stamps the pitcher `gameLog` / `vsOpp.games`
  as `/api/mlb/pitcher-props` comes back. The backend stays dependency-free and
  knows nothing about ESPN's CDN. A logo is only set when the abbreviation
  resolved — `'?'` would build a guaranteed 404, and the text fallback is more
  useful than a broken image. All 30 MLB abbreviations were checked against the
  CDN (30/30 → HTTP 200).
- **BvP bars are not team games.** Each one is a meeting with the same pitcher,
  so `shapeBvpForChart` marks them `vsPitcher: true`: no logo, and the label is
  the pitcher's name with no "vs"/"@" prefix (it previously hardcoded
  `home: false`, which rendered a misleading "@Burns" on every bar).


## Style Guide
- CSS variables only — no hardcoded hex colors except in component-local styles where you need a specific channel value (e.g. `'#00ff88'` for a win color)
- Use `HudCard` for all card-shaped containers
- Orbitron for numbers and labels; Space Mono for everything else
- Do NOT introduce a bundler, TypeScript, or npm-installed React. The "no build step" constraint is intentional — keep it that way.
- When adding components to a `.jsx` file, remember to append them to the `Object.assign(window, { … })` export at the bottom, or the next script won't find them.

---

## Backend performance — why the Edge Finder was slow (Sep 2026)

The MLB game detail screen fires `/api/mlb/game-bvp` and `/api/mlb/prop-model`
in the SAME `Promise.all` (`game-detail-screen.jsx` Phase 2). Both call
`getGameBvp()` internally. Measured cold, `prop-model` took **16.9s** while
every other MLB endpoint was under 700ms. Three independent causes, all
plumbing — **no model math was touched, and responses are byte-identical**:

1. **Duplicated in-flight work.** Neither request could see the other's cache
   (it is written only on completion), so all ~18 batter/pitcher Savant CSVs
   were downloaded **twice** — verified: 36 fetches for 18 unique pairs. Fixed
   by `dedupe` (above); now exactly 18.
2. **The two sides were sequential.** `getGameBvp` looped
   `for (const [side, oppSide] of [['away','home'],['home','away']])`, so the
   away team's ~9 Savant calls fully finished before the home team's began.
   They share no state — now built concurrently with `Promise.all`. Away is
   still index 0 and home index 1, and the `totalBatters`/`resolvedBatters`/
   `failedBatters` counters are tallied after both settle, so the response is
   order-independent.
3. **Independent fetches sat behind an unrelated await.** `getBatterPropModel`
   awaited `getGameBvp()` — which ends with a weather-enrichment pass over every
   BvP game — before fetching per-player season stats. But
   `getBatterHitProfile`/`getBatterHand`/`getPitcherStats`/`getPitcherArsenal`
   depend only on `(playerId, season)`, never on BvP. A request waterfall showed
   ~1.8s of MLB Stats API calls idling until the Savant+weather stage finished.
   They are now warmed concurrently with BvP off the (cheap, usually cached)
   lineups. Those priming calls are the same memoized functions the per-side
   build calls, so only timing changes; their errors are swallowed on purpose
   because the real call downstream re-runs and handles its own failures.

**Measured on cold games** (both endpoints concurrent, as the browser does it):
17.9s → 5.3s, 31.1s → 4.9s, 14.7s → 2.7s (**3.4x–6.3x**). Full 15-game slate:
median 1.5s, zero non-200s.

**If you touch this path, keep the guarantee that made it safe:** the win came
entirely from *when* fetches start and *how many* run, never from changing what
is computed. `$CLAUDE_JOB_DIR` scratch tests deep-compared old vs new
`game-bvp` + `prop-model` JSON across 4 live games and found them identical —
do the same before landing further changes here.

---

## Design system v2 — the theme engine (Sep 2026)

The app used to paint everything in one cyan. It is now **per-sport themed**,
and the mechanism matters more than the colors:

- **`--accent-h` / `--accent-s` / `--accent-l` in `:root` are the source of
  truth.** `--accent` is built from them, and **`--cyan` is now an ALIAS for
  `--accent`.** That alias is the whole trick: ~4,000 lines of sport tabs
  already paint with `var(--cyan)`, so they re-theme for free.
- **Setting `data-sport` on `<html>` re-themes the entire application** — nav,
  cards, charts, gauges, glows, the backdrop. `App` does this from the current
  view; `HomeScreen` also sets it on card hover to preview a sport.
  `:root[data-sport="…"]` blocks in `index.html` define the six themes.
- **Never write `--cyan` directly** (inline style, JS, or CSS). It shadows the
  theme and freezes the app on one color. Write the `--accent-h/s/l` channels
  instead — that is exactly what the tweaks panel's `applyAccentHex` does, and
  it keeps every derived value (tints, lines, glows, `--accent-2`) coherent.
- `--cyan-fixed` exists for the rare case where you genuinely mean cyan and
  not "the current accent".

### Motion
Keyframes + a `.stagger` container class live in `index.html`. Charts draw
themselves (`growUp` / `growRight`, sparkline stroke-dash, gauge sweep) and
`useCountUp` (exported from `ui-atoms.jsx`) animates numbers; `StatTile` and
`OpsGauge` use it already. Everything is inside the existing
`prefers-reduced-motion` guard — verified rendering at 390 / 820 / 1440px and
with reduced motion on: no horizontal scroll, no nav overflow, zero errors.

### HudCard
Now draws a top-lit gradient, layered shadows, expanding corner brackets and a
**cursor-tracked spotlight**. The spotlight writes CSS custom properties on the
DOM node rather than calling `setState`, so pointer movement never re-renders —
keep it that way or the slate grid will thrash. Pass `glow={false}` to opt out.
`accent` accepts a hex or a `var(…)`; the internal `at()` helper picks
`color-mix` for vars and the `+alpha` suffix for hex.

### Color + alpha: the one rule that breaks charts silently

`${color}88` (hex + alpha suffix) is used widely in the sport tabs and is
fine **only where `color` is a hex literal**. Most shared atoms receive CSS
variables instead — `var(--green)`, `var(--cyan)`, a team-color var — and
`"var(--green)88"` is invalid.

Where that lands matters:
- In `background` / `linear-gradient(...)` it voids the **whole** declaration,
  so the element paints nothing. This is what made every Edge Finder bar
  render as an empty outline (fixed in `9b19ccd`).
- In `boxShadow` / `filter` it fails quietly — the glow just doesn't draw.

So: in an atom, never build a `background` by concatenating alpha onto a
color prop. Use the flat color, or `color-mix(in srgb, ${color} 40%, transparent)`,
which works for hex and var alike — `HudCard`'s `at()` helper is the pattern.

---

## LIVE (in-play) tab — MLB

Added Sep 2026. The first tab whose numbers change by the minute, and the
first that compares a PlayIQ model against a real posted market price.

`frontend/sports/mlb/tabs.jsx` → `MlbLiveTab`, backed by
`GET /api/mlb/live?gamePk=` (`server/mlb/live-{model,service,moves}.js`).

### The pipeline
1. **State** — MLB StatsAPI `v1.1/game/{pk}/feed/live` gives inning, half,
   outs, exact baserunners, score, pitcher, **pitch counts**, batters faced,
   and the full unused-`bullpen` array in ONE call.
2. **Run environment** — blends the current pitcher (for the innings he is
   likely to cover, from pitch count) with the bullpen for the rest. This is
   why the model is a Markov chain and not a WE-table lookup: a table assumes
   league-average scoring for both sides for the remainder, which is exactly
   wrong the moment an ace is relieved.
3. **Price** — `winProbability` / `expectedRemainingRuns` / a full
   remaining-runs distribution (a mean cannot answer "P(total > 6.5)").
4. **Market** — ESPN's CORE api publishes a provider literally named
   **`"DraftKings - Live Odds"`** that tracks the game (verified: CHW -136 /
   O-U 8 pregame vs -253 / 6.5 once they led 1-0).
5. **Moves** — ranked, with edge, EV, ¼-Kelly stake, a checkable `why`, and
   explicit `caveats`.

### Things that are load-bearing — do not "simplify" them

- **DE-VIG BEFORE COMPARING.** The observed DraftKings live hold was **6.5%**.
  Comparing a model probability to the RAW implied probability of -253 invents
  ~3-4 points of edge on the favourite out of nothing.
- **The posted line refreshes PER HALF-INNING, not per pitch.** Measured over
  a 20-minute 60s poll: the number moved exactly once, at the inning break,
  and sat still through every out and baserunner in between. So a mid-inning
  "edge" is largely the book's number lagging the game, not a mispricing —
  `buildMove` caps confidence mid-inning and says so, and `checkpoints` points
  the user at the boundary instead.
- **We are ~10-12s behind the book, permanently.** The feed's own
  `metaData.wait` is 10. Books run ~1-2s feeds and hold a 3-8s acceptance
  window they can void into. The tab therefore never implies a race; the
  latency note is rendered permanently in the header, not hidden in a tooltip.
- **A stale line manufactures fake edge.** ESPN's row carries no
  `lastModified`, so `getLiveOdds` fingerprints it and reports `ageSec` from
  OUR first sighting (a lower bound). Over 150s → `stale: true` → any move
  built on it drops to LOW with the reason attached.
- **`ABSURD_EDGE` (25 pts) is a bug detector, not a filter.** No real market is
  25 points wrong. A malformed remaining-runs distribution once produced a
  confident "UNDER 8.5, +47.7 pts, stake 2u" — the math was right and the
  input was wrong. An edge that good is a symptom; drop it.
- **NO third-time-through-the-order cliff.** The classical TTO3 penalty is
  disputed by a 2022 Bayesian re-analysis (Brill et al., arXiv:2210.06724),
  which finds no strong discontinuity once batter/pitcher quality are
  controlled. Fatigue is modelled as a CONTINUOUS function of pitch count
  plus a small times-faced term.

### The model, and how it is actually validated

`live-model.js` is a 24-state (8 base configs x 3 outs) Markov chain solved by
forward propagation. `runSelfTest()` — **28/28 passing** — checks it against
things that are observable and stable: the published RE24 matrix and real
P(>=1 run scores this half-inning) rates, plus internal-consistency and
monotonicity properties.

It deliberately does **NOT** assert against remembered win-probability table
values. Two "Tango WE" reference points used from memory during development
were simply WRONG, e.g. a claimed .813 for (bottom 9, tied, runner on 1st, 0
out). That is internally impossible: with a ~.535 home edge in extras it
requires P(score this inning) = .598, while the real league rate from 1B/0-out
is .441. Chasing it would have meant breaking a correct model to hit a bad
target. **If you add WE assertions, scrape the table and commit it** — do not
type the numbers from memory, and check each against
`P(score) + (1 - P(score)) * P(win in extras)` first.

Three transition details the RE24 test caught, all of which a naive version
gets wrong and none of which fail loudly:
- **Sac fly.** Without a "runner on 3rd scores on an out" branch, 3B and 2B are
  worth *identically* the same (both were RE 1.057), since every hit scores
  both. Largest single structural error available here.
- **First-to-third** on a single, or a runner on 1B is undervalued.
- **Free advancement** (steal/WP/PB/balk/error). Bases-empty P(score) was
  correct while every occupied state was 3-6 points low — the fingerprint of
  missing non-hit advancement, not of a bad event mix.

### Tracker

`LiveTrackerPanel` logs bets to `localStorage.piq_live_bets` (per-browser,
never transmitted; every access try/caught). It records the **game state at
bet time** — inning, outs, bases, score, feed timestamp — which is what lets
you tell a bad model from a bad beat later.

It scores two things, and the distinction is the point: **P&L** (high variance,
needs thousands of bets) and **calibration via Brier score** (converges in
dozens). True CLV is not computable in-play — there is no meaningful "close"
when the market for a given game state exists for seconds — so rather than
fake it, the tracker scores the model's probabilities directly against
outcomes. 0.25 is the Brier score of always saying 50%; beating it means the
model carries real information.

### Gotchas found the hard way

- **`site.api.espn.com` 403s server-side** regardless of User-Agent, while
  `sports.core.api.espn.com` returns 200. The browser can still use the site
  API; the backend cannot. Map games via the core `events` listing.
- **Match ESPN games on FULL TEAM NAME, not abbreviation** — MLB says `CWS`,
  ESPN says `CHW`, and an abbreviation join silently returns null.
- **`linescore.defense.pitcher` is whoever is on the mound RIGHT NOW**, so
  reading it for both sides returns the same id twice (it produced a "HOME
  pitcher" of the AWAY starter, named "Unknown"). Each side's own current
  pitcher is the LAST entry in its boxscore `pitchers` array.
- **`inningState` has four values**, not two: `Top`/`Bottom`/**`Middle`**/
  **`End`**. Middle/End must be normalised to the start of the next half or
  the model prices a half-inning that already finished.
- **An unknown gamePk returns a well-formed EMPTY feed**, not a 404 — detect
  it by absent team ids.
