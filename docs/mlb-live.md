# MLB live workflow

The MLB game detail screen exposes `◉ LIVE` using the existing React/Babel CDN
scripts, shared HUD primitives, design tokens, and zero-dependency Node server.
`frontend/sports/mlb/live-slip.jsx` loads immediately before MLB tabs and exports
through `window`, matching the rest of the app.

The workflow is game state → research moves → singles slip → local tracker.
The board only offers moneyline/total selections with supplied reference odds.
Adding a pick freezes its quote and game state; later updates do not silently
rewrite it. Users can edit the actual book price and stake before logging.
Returns include stake. The tracker records separate singles, not a synthetic
same-game parlay, and supports win/loss/push/void settlement. Manual selections
without model probabilities are excluded from calibration.

Live requests run serially, about 15 seconds after each response. Hidden pages
skip polling. A 30-second request timeout and retry preserve the last good
payload on transient failure. Missing/stale prices or paused/failed polling
block new selections. Model calls are suppressed when reference odds are stale.
The provider does not expose executable quotes or authoritative market suspension
status, so users must confirm availability with their sportsbook. There is no
sportsbook account connection, wager submission, or automatic settlement.

Recent completed plays come from MLB `liveData.plays.allPlays`; the current
pitcher is read from `linescore.defense.pitcher`. Between-inning state is retained
separately from the normalized next-half model state.

Research informing the workflow:

- [DraftKings: live market suspension](https://support.draftkings.com/dk/en-us/what-does-it-mean-when-a-market-is-suspended?id=kb_article_view&sysparm_article=KB0010811): unavailable markets cannot be added to a slip.
- [DraftKings: same-game parlays](https://support.draftkings.com/dk/en-us/what-is-a-same-game-parlay-sgp-bet?id=kb_article_view&sysparm_article=KB0010719): selections are assembled in a slip/builder; live availability depends on the offering.
- [DraftKings: wager types](https://help.draftkings.com/hc/en-us/articles/4405229776531-What-types-of-wagers-are-available-with-DraftKings-Sportsbook-US): live odds change with game events.

Run regressions: `node --test tests/mlb-live.test.js`. No packages are required.
Restart the Node backend after updating these server modules.
