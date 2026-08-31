# Thunder Bowl Data Helper

This small Chrome/Edge helper provides the private CBS portion of the In-Season GM’s **Update everything** button. It reads CBS’s all-team Thunder Bowl roster report and current-week component-stat projection tables only when that button is pressed. Footballguys raw-stat projections refresh automatically in the Tuesday job and are also downloaded by the server in the same manual update.

## One-time setup

1. Extract `thunder-bowl-data-helper-v0.4.1.zip` to a permanent folder.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge, using the browser profile used for Thunder Bowl.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select the extracted folder containing `manifest.json`.
5. Sign into `https://berrymvp.football.cbssports.com/` in the same browser profile.
6. Open or reload the In-Season GM and choose **Update everything**.

After setup, the single button captures CBS rosters, additions/drops, and current-week CBS component projections (yards, touchdowns, receptions, fumbles, kicking, and defense); downloads the current Footballguys component-stat projection file; scores both under Thunder Bowl rules; refreshes injuries, news and IR-return evidence; and rebuilds the weekly plan.

## Privacy and authority boundary

- No password, cookie, or browser-storage permission is requested.
- The helper does not store CBS credentials or session data.
- It opens CBS roster pages in an inactive tab only after the user presses the update button, extracts the roster table, then closes the tab.
- It accepts every legal 8–14 player roster. Waiver and trade recommendations are blocked only when a team lacks 1 QB, 2 RB, 2 WR, 1 TE, 1 K, or 1 DST, or exceeds the 14-player maximum.
- It cannot change CBS rosters, lineups, waivers, trades, keepers, salaries, contracts, auction values, or ledger state.
- The manifest is limited to the Thunder Bowl CBS host and the Thunder Bowl app origins.

The JSON and CSV imports in **Advanced recovery tools** are fallbacks only; they are not part of the normal workflow.
