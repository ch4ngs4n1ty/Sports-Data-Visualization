# MLB live feed and indicators

No paid data subscription, API key, AI request, build step, or new Node dependency
is required. MLB StatsAPI supplies game state, completed plays, current player
box scores, and the live slate. ESPN supplies initial multi-sport discovery and
optional reference odds. Public access is not a latency/availability guarantee
or a grant of redistribution rights. Hosting configuration is unchanged.

## Update pipeline

- `GET /api/mlb/stream?gamePk=...` streams complete game snapshots via SSE.
  `?date=YYYY-MM-DD` streams the MLB slate. `/api/mlb/snapshot` accepts the same
  parameters for the REST fallback.
- One serial fetch per active topic serves every connected viewer. The cache and
  in-flight coalescing also cover requests from the analysis endpoint. Polling
  stops after the last viewer leaves; no always-on background crawler is added.
- Game feeds respect `metaData.wait`, with a 10-second minimum. Pregame/delayed
  games check about every 30 seconds, finals every 60 seconds for corrections,
  and the slate every 15 seconds, all after the previous response. These are
  request intervals, not delays measured from action on the field.
- Browser subscriptions share a connection between the detail header and live
  tab, close while hidden, and fetch a fresh snapshot on return. A failed or
  silent stream falls back to serial REST polling; foregrounding retries SSE.
  Last good values remain visible with a stale/reconnecting indicator.
- Limits: 200 simultaneous streams, 8 per client IP, 40 distinct topics per server
  process. Slow socket readers are disconnected. Multi-instance hosting would
  need a shared broker to coordinate ingestion across processes.
- Full snapshots recover after missed messages. A content revision covers state,
  player box scores, and completed plays, including scoring corrections. Provider
  heartbeat timestamps alone do not change the revision.
- MLB slate updates preserve ESPN event IDs for existing analytics. Game IDs and
  start times disambiguate doubleheaders; ambiguous matches are left unchanged.
  Initial multi-sport discovery refreshes serially every minute. Provider naming
  differences may leave a card unmatched; game detail uses the resolved MLB ID.

## Live feed and indicators

The Live tab uses a compact scoreboard and a feed inspired by the supplied Real
reference: on-deck hitters, bases/outs, current batter and pitcher, pitch sequence,
and a strike-zone plot using MLB's measured pX/pZ and batter strike-zone bounds.
Missing locations remain missing; no heatmap or pitch locations are invented.
Feed/Game/team views expose plays, linescore and player statistics. Narrow screens
switch between the game feed and indicators; wide screens show them side by side.

The light snapshot path does not wait for bullpen statistics, odds or the model.
`/api/mlb/live` computes analysis separately, cached by revision and run environment.
The browser only enables indicators when model and snapshot revisions agree.

`server/mlb/live-indicators.js` builds an approximate joint final-score distribution
from the existing base/out half-inning model. It skips unneeded bottom innings,
ends walk-offs at the winning run, and carries ties into extra innings (automatic
runner for regular-season/spring games). It follows up to 12 extra innings beyond
the current/regulation inning and exposes unresolved mass; indicators are withheld
if more than 0.5% is unresolved. Smaller tails are normalized. Walk-off home-run
excess is not modeled, which can understate late total/run-line chances. Current
ball/strike count is displayed but not used in the plate-appearance model.

Moneyline, run-line and total probabilities all use that same score distribution.
Whole-number lines include an explicit push chance. Fair prices condition on no
push. A higher outcome probability is not automatically betting value; the UI
does not call an unverified quote an executable opportunity. Users can enter their
actual run/total line; the total initially uses the reference line when available,
otherwise an editable 8.5 example. The home run-line example is -1.5.

The first player projection supports hits overs only. It uses a Poisson additional-
hits estimate, season hits per plate appearance shrunk with 50 baseline appearances
(12 hits), and 4.3 team plate appearances per remaining regulation inning divided
by nine. At least 50 observed season PA are required. It does not model batting
order, pitch count, individual matchup, or future extra-inning opportunities.
Those limitations are visible in the interface. No future-opportunity estimate is
shown when regulation opportunities are exhausted for an active hitter. Reached
thresholds use the observed box score; replaced hitters have no future hits in
this estimate. These probabilities have not been calibrated to live outcomes.

## Followed picks

Clicking a prediction stores just its market, team/player, fixed line and follow
time in `piq_live_follows_<gamePk>` (maximum 12 per game). No stakes, orders, slips,
P&L, paper execution or bet settlement are part of the new live interface.
The selected line stays fixed when the market or editable line changes. Each new
matching snapshot updates its estimated chance, direction of change and a compact
trend. The trend starts fresh per visit; selected picks survive reloads. Paused or
stale feeds keep the last observed probability visibly muted. Final scores update
game-market outcomes; provider corrections can change them.

Legacy tracker helpers/files remain for compatibility with existing tests and
browser data, but are not mounted in the live UI; paper/slip scripts are no longer
loaded. Existing stored records are not deleted. No paid API or AI call is added.

## Verification

Run `node --test tests/*.test.js`. Tests cover shared/serial ingestion, disconnect
cleanup, provider failure/recovery, limits, corrections, browser visibility,
SSE fallback, ambiguous doubleheaders, game-ending rules, extra innings, market
probabilities/pushes, fixed followed lines, hitter progress, and measured pitches.
Legacy tracker regressions also remain covered. No packages are required.

Restart the Node backend and reload the frontend after updating. The static
frontend remains compatible with Vercel; SSE terminates on the Node backend.
Render's free tier may sleep or be limited, so continuous production availability
is not promised. No hosting plan was changed and nothing is deployed by these edits.
