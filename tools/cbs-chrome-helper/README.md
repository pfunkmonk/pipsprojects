# Thunder Bowl Data Helper

This small Chrome/Edge helper provides the private CBS, Footballguys, FantasyPros, and PFF portions of the In-Season GM’s **Update everything** button. It reads the required signed-in current-week component-stat projection tables and runs only when that button is pressed.

## One-time setup

1. Extract `thunder-bowl-data-helper-v0.7.0.zip` to a permanent folder.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge, using the browser profile used for Thunder Bowl.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select the extracted folder containing `manifest.json`.
5. Sign into `https://berrymvp.football.cbssports.com/` in the same browser profile.
6. Sign into `https://www.footballguys.com/` with the PRO account that contains the Thunder Bowl league.
7. Open or reload the In-Season GM and choose **Update everything**.

After setup, the single button captures CBS rosters, additions/drops, and current-week CBS component projections; captures current Footballguys PRO, FantasyPros, and PFF component projections through the same signed-in browser profile; scores all available raw categories under Thunder Bowl rules; refreshes injuries, news and IR-return evidence; and rebuilds the weekly plan.

## Privacy and authority boundary

- No password, cookie, or browser-storage permission is requested.
- The helper does not store CBS, Footballguys, FantasyPros, or PFF credentials or session data.
- It opens provider pages in inactive tabs only after the user presses the update button, reads the required reports, then closes the tabs.
- It accepts every legal 8–14 player roster. Waiver and trade recommendations are blocked only when a team lacks 1 QB, 2 RB, 2 WR, 1 TE, 1 K, or 1 DST, or exceeds the 14-player maximum.
- It also reads the authenticated CBS FAB budget, current FAB order, standings record, and available current-week transaction evidence so the advisor can size blind-auction bids under the league's $50 rules.
- It cannot change CBS rosters, lineups, waivers, trades, keepers, salaries, contracts, auction values, or ledger state.
- The manifest is limited to the Thunder Bowl CBS host, Footballguys, FantasyPros, PFF, and the Thunder Bowl app origins.

The JSON and CSV imports in **Advanced recovery tools** are fallbacks only; they are not part of the normal workflow.
