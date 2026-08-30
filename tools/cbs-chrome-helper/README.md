# Thunder Bowl Data Helper

This small Chrome helper provides the private CBS portion of the In-Season GM’s **Update everything** button. It reads all 12 Thunder Bowl roster pages only when that button is pressed. Footballguys projections and public injury/news sources are downloaded by the server in the same update.

## One-time setup

1. Extract `thunder-bowl-data-helper-v0.2.0.zip` to a permanent folder.
2. Open `chrome://extensions` in the Chrome profile used for Thunder Bowl.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select the extracted folder containing `manifest.json`.
5. Sign into `https://berrymvp.football.cbssports.com/` in the same Chrome profile.
6. Open the In-Season GM and choose **Update everything**.

After setup, the single button captures CBS rosters, additions/drops and current CBS player context; downloads and scores the current Footballguys weekly projection file; refreshes injuries, news and IR-return evidence; and rebuilds the weekly plan.

## Privacy and authority boundary

- No password, cookie, or browser-storage permission is requested.
- The helper does not store CBS credentials or session data.
- It opens CBS roster pages in an inactive tab only after the user presses the update button, extracts the roster table, then closes the tab.
- It cannot change CBS rosters, lineups, waivers, trades, keepers, salaries, contracts, auction values, or ledger state.
- The manifest is limited to the Thunder Bowl CBS host and the Thunder Bowl app origins.

The JSON and CSV imports in **Advanced recovery tools** are fallbacks only; they are not part of the normal workflow.
