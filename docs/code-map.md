# PlayIQ Code Map

## Frontend

- `frontend/shared/ui-atoms.jsx`
  Shared UI building blocks used by every sport.
- `frontend/shared/screens/home-screen.jsx`
  Sport selection screen.
- `frontend/shared/screens/games-screen.jsx`
  Multi-sport schedule browser.
- `frontend/shared/screens/game-detail-screen.jsx`
  Shared game detail shell that decides which sport tabs to show.
- `frontend/shared/tabs/common-tabs.jsx`
  Reusable tabs shared across sports: overview, H2H, form, roster, AI plays.
- `frontend/data/shared/core.js`
  Shared data fetchers and helpers for ESPN, navigation data, injuries, roster, and AI play generation.

## Sport-specific frontend

- `frontend/sports/mlb/tabs.jsx`
  MLB-only tabs: Edge Finder and Pitching.
- `frontend/data/mlb/index.js`
  MLB-only data helpers: starters, BvP, weather, batter game logs, MLB edge builder.
- `frontend/sports/nba/tabs.jsx`
  NBA-only tab: Edge Finder.
- `frontend/data/nba/index.js`
  NBA-only data helpers: player game logs and NBA edge builder.

## Backend

- `server/index.js`
  Thin HTTP entrypoint and route wiring.
- `server/shared/cache.js`
  Cache helpers reused by backend services.
- `server/shared/http.js`
  HTTP fetch and JSON response helpers.
- `server/mlb/service.js`
  MLB backend service logic: lineups, BvP, Savant parsing, weather, and game lookup.

## Notes

- NHL and NCAAB still use shared schedule/overview/roster flows because they do not have dedicated detail-analysis modules yet.
- The original root files (`ui-atoms.jsx`, `tabs.jsx`, `screens-v2.jsx`, `data-layer.js`) are now legacy consolidated copies; the app loads the organized files under `frontend/`.
