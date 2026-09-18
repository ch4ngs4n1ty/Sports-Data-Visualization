# PlayIQ

A dark-mode sports betting intelligence dashboard with an HUD / sci-fi aesthetic.
Pick a sport → browse today's slate → drill into a game for deep analysis across
matchup, form, roster, and sport-specific modeling tabs.

**MLB · NBA · WNBA · NFL · NHL · NCAAB**

---

## What it does

- **Slate triage** — MLB game cards carry a hot-play badge (🔥 HOT PLAY / ▲ LEAN /
  • LOOK / ⚠ FADE SP) so you know which games are worth opening before you open one.
- **Per-game deep dives** — Overview, Head-to-Head, Last 5, Rosters, AI Plays for
  every sport, plus per-sport analytical tabs.
- **MLB** — Edge Finder (batter-vs-pitcher + transparent Log5 prop projections),
  Pitching (K/Outs/ER/HR projections with per-start charts), Low HR model,
  High Contact report, a 3D CSS lineup diamond, and a player lookup that works
  *before* the batting order posts.
- **NBA / WNBA** — Edge Finder with a per-player threshold projection model,
  lineups (WNBA gets a 3D court view), and defense-vs-position.
- **NFL** — season offense/defense matchup board, with weekly-slate handling so
  Sunday's games still show up on a Wednesday.
- **AI Plays** — bring your own Anthropic API key; Claude generates plays from the
  game context and you can discuss them in free-form.

The only machine-learned component is the **MLB first-5-innings money line model**
(XGBoost, trained offline in CI). Every other "model" in the app is transparent,
inspectable arithmetic — Log5 matchups, Binomial/Poisson distributions, additive
scoring — and each score carries a `why` string or a `methodology` entry naming its
source, endpoint, inputs and formula.

---

## Stack

**Frontend — no build step, by design.**
React 18 + Babel Standalone from a CDN; `.jsx` files are transpiled in the browser.
No bundler, no TypeScript, no npm-installed React. Fonts are Orbitron (display) and
Space Mono (everything else).

**Backend — zero dependencies.**
Pure Node `http` + `https` on port 3001. No npm packages at all, in-memory caching
(2 min for live data, 15 min for historical BvP).

**Data sources.** ESPN's public API (no key), the MLB Stats API, and Baseball Savant.
Claude (Haiku) is called directly from the browser with a user-supplied key.

---

## Running it locally

```bash
# 1. Backend (port 3001, no install step — there are no dependencies)
./server/start.sh          # daemonizes, logs to server/server.log
# or: node server/index.js # foreground

# 2. Frontend — any static server from the repo root
python3 -m http.server 8000
```

Open <http://localhost:8000>. The frontend auto-detects localhost and points at
`http://localhost:3001`, ignoring the production backend URL, so local dev works
without editing anything.

Check the backend is up:

```bash
curl http://localhost:3001/api/health
```

To use AI Plays, paste an `sk-ant-…` key into the input in the top nav. It is stored
in `localStorage` and sent only to Anthropic.

---

## Repo layout

```
index.html                 Shell: CDN scripts, nav, API-key input, global CSS
frontend/
  data/                    Fetchers + models, split shared/ + per-sport
  shared/ui-atoms.jsx      Primitive UI components (HudCard, Sparkline, …)
  shared/tabs/             Sport-agnostic tabs
  shared/screens/          Home / Games / GameDetail
  sports/{mlb,nba,nfl}/    Sport-specific tabs
server/
  index.js                 Node HTTP server (port 3001)
  mlb/  nba/               Per-sport services and endpoints
  data/f5_model.json       Committed XGBoost model (CI writes this)
ml/                        Offline Python training pipeline (runs in CI, not the app)
```

> **Note:** `data-layer.js`, `tabs.jsx`, `screens-v2.jsx` and `ui-atoms.jsx` in the
> repo root are dead legacy files left over from a reorg. `index.html` does not load
> them. Always edit under `frontend/`.

---

## Architecture notes

**Scripts communicate through `window`.** With no bundler, each file ends with an
`Object.assign(window, { … })` export and later scripts read from there. The load
order in `index.html` is load-bearing: data layer → atoms → tabs → screens → app.

**Backend URL resolution** (`frontend/data/shared/core.js`), in order:
`window.PIQ_API_BASE` → localhost shortcut → the `<meta name="piq-api-base">` tag →
localhost fallback.

**The F5 model's train/serve parity is a contract.** Features are defined once in
`ml/f5_common.py` and `server/data/f5_feature_spec.json`, and must be computed
identically by the Python collector and the live `buildF5Features()`. Training
embeds parity samples so the Node scorer self-checks to ~1e-7. Change a feature on
both sides, then retrain.

---

## Deployment

- **Frontend** — static hosting (Vercel), no build command.
- **Backend** — Render, via the committed `render.yaml` blueprint. On the free tier
  the service sleeps after ~15 min idle, so the first request after a nap takes
  ~30s. After deploying, point `<meta name="piq-api-base">` in `index.html` at the
  service URL.
- **F5 model** — `.github/workflows/train-f5.yml` retrains weekly, commits the model
  JSON, and Render auto-deploys it.

---

## Contributing conventions

- Keep the no-build-step constraint. No bundler, no TypeScript, no npm React.
- Keep the backend dependency-free. Add new endpoints rather than mutating existing ones.
- Use CSS variables from `:root` in `index.html`; wrap card-shaped content in `HudCard`.
- New components must be added to the `Object.assign(window, …)` export at the bottom
  of their file, or the next script won't find them.
- Verify an ESPN payload before writing against it — field placement varies by sport
  and a wrong key fails silently as a blank value, not an exception.

`CLAUDE.md` holds the full blueprint: file-by-file responsibilities, per-sport
gotchas, and how to add a tab, data source, or sport.

---

## Disclaimer

PlayIQ is an analysis and research tool. Nothing it outputs is betting advice, and
no model here predicts outcomes reliably. Bet responsibly, or don't.
