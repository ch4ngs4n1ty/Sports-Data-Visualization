# NFL Live

The NFL game-detail Live tab reads the free public ESPN summary endpoint directly in the browser. No key, paid odds provider, AI call, bet slip, or transaction is involved. Requests run serially every 15 seconds with a 12-second timeout; hidden tabs stop polling and resume when visible. Failures retain old data with a stale notice and disable following. Provider freshness is unknown; the age shown is our last successful retrieval, not the source's publication time.

The field shows the last play's ending position relative to the possessing team's own goal line (offense always moves right), the line of scrimmage, and first-down/goal marker. It is a schematic, not a player-tracking feed. Halftime may retain the previous play's position.

Game indicators are **regulation only**. A compound Poisson scoring model combines assumed three-point (35%) and seven-point (65%) events with a rate of `(22 + current team score) / (3600 + elapsed seconds)`. Remaining scoring is that rate times regulation seconds left. The 22-point prior and event weights are explicit assumptions, not trained or calibrated parameters. Current score and clock update forecasts; possession, field position, injuries, team strength, timeout strategy, safeties, conversion outcomes and overtime are not modeled. Four-quarter line scores resolve games that reach overtime. Regulation win ties are shown separately, not silently split between teams. This is not a full-game sportsbook moneyline model.

Passing, rushing, and receiving yardage estimates extrapolate current game pace after ten minutes with an assumed Normal uncertainty band (9 yards × sqrt(remaining minutes) for passing; 5 for rushing/receiving, minimum 8). Integer lines include an approximate push bin. Negative yardage is possible, so crossing a line is not an automatic hit. No usage, substitution, injury or matchup model exists. Player forecasts project through regulation, are withheld during overtime, and final settlement uses final published full-game stats. These are experimental pace indicators, not calibrated betting recommendations.

Selections retain the entered line in per-game `piq_nfl_follows_<eventId>` browser storage, up to 12. Probability change tracks the current visit only. No odds comparison or claim of positive expected value is made.

Validation: `node --test tests/nfl-live.test.js` covers probability mass, complement/push accounting, spread signs, regulation/OT separation, unavailable inputs, negative player yardage, and field normalization.
