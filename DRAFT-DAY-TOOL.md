# Pip's Draft Day Tool

Stage One is the live, league-configurable fantasy-football auction room at [pipsprojects.com/draft-day](https://pipsprojects.com/draft-day/). It deliberately contains no VBD, ADP, projections, rankings, or draft advice.

## Product operating principle

Every change must make the tool easier, more intuitive, more desirable, and faster than paper or competing online services. Remove calculations and translations the product can do reliably, preserve user intent across reopening and connection loss, and fix shared rules or workflows instead of patching isolated symptoms.

## Current status — August 17, 2026

Stage One is feature-complete and released. The current web-shell release is `20260817j`.

- League-specific teams, starting pools, bid rules, roster minimum/maximum, optional keeper maximum, optional position maximums, and nomination mode are configurable.
- Organizer, Auctioneer, and Draft Board use separate access codes and role sessions.
- Auctioneer keeper entry uses predictive 2026 player search and fills position, NFL team, and bye week automatically.
- Keeper salaries immediately reduce remaining cash and legal maximum bids.
- Keepers can be explicitly locked/unlocked until the first auction sale; corrections remain audited afterward.
- Selecting a nominated player creates the large public Draft Board nomination card; recording the winning sale clears it.
- Player stickers are position-colored and include NFL team, bye week, price, and a keeper marker.
- Assignment correction, undo, restore, local nomination clock, board-presence indicator, CSV export, and JSON backup are available.
- Ordinary refresh restores the active role screen. Explicit logout clears every Draft Day role cookie and the league's offline verifiers.
- Session expiry stops repeating timers and preserves queued Auctioneer actions for re-authentication instead of dropping them.

Stage Two—the customizable VBD/ADP, scoring, imported provider rules, and historical league modeling layer—has not started. It should consume the Stage One event history through a separate normalized import/valuation boundary and must not add strategy data to the public Stage One payload.

## Routes

- `/draft-day/` — create a league or manage setup before the first auction sale
- `/draft-day/auctioneer/` — keeper and sale entry, corrections, undo/restore, backups, clock, live board status, CSV, and logout
- `/draft-day/board/` — code-protected, read-only live room board
- `/draft-day/guide/` — current organizer, auctioneer, board, refresh/logout, and recovery instructions

## Data, security, and session boundaries

- A memorable league code comes from the first eight letters or numbers of the league name. Short names stay short; a duplicate receives a visible numeric suffix.
- Organizer, Auctioneer, and Draft Board access codes are independently salted and hashed with scrypt. Plaintext codes are returned only to the league creator's form state and are never stored by the server.
- Role sessions use signed, HTTP-only, SameSite=Strict cookies with a 12-hour lifetime. Refresh reuses them; explicit logout expires all three role cookies.
- Remembered league selection and offline verifiers are centralized in `public/draft-day/session-storage.mjs`, so every role follows one persistence/logout contract.
- The Draft Board snapshot excludes event history, custom-player management, entered salary-pool setup, and all credential fields.
- Netlify Blobs stores one strongly consistent, revisioned document per league. Auction events are append-only; correction, undo, and restore add events rather than rewriting a sale.
- The checked-in 716-player pool contains public sticker-ready identity fields only: id, name, position, NFL team code/name/short name, and bye week.
- Pending Auctioneer commands are idempotent, revision-checked, locally queued, and retained across connection or session interruption until confirmed or explicitly rejected by a valid server response.

## Stage One acceptance flow

1. Create a league with individualized pools and position rules.
   - A blank position maximum means no position-specific limit; the overall roster maximum still applies.
   - **Allow any mix of backups** clears every position maximum at once.
2. Record keepers from collapsible Keeper Setup.
   - Salary is required; contract year and keeper round are optional.
   - Salary deductions and legal roster completion are checked before record.
3. Lock and unlock keepers, then record the first sale and verify the permanent keeper-entry lock.
4. Sign into Auctioneer and Draft Board separately; refresh both and verify they restore without code entry.
5. Select a nomination and verify the large Draft Board card; record the sale and verify it clears.
6. Correct, undo, and restore the sale; verify budgets, roster counts, and the public board remain canonical.
7. Verify overspending, duplicate players, invalid increments, position caps, and impossible roster paths are blocked.
8. Finish and reopen the draft.
9. Export spreadsheet-safe CSV and JSON backup.
10. Explicitly log out and verify every Draft Day role requires an access code again.

## Validation and live release audit

Local validation:

```powershell
$env:DRAFT_DAY_SESSION_SECRET='replace-with-local-32-character-secret'
npm.cmd run dev -- --offline --no-open
npm.cmd run build
npm.cmd test
```

The reusable live audit creates an isolated QA league and tests role separation, wrong-code rejection, session refresh, keeper deductions, lock/unlock, nomination visibility, public-data isolation, sales, duplicate/overspend rejection, idempotency, correction, undo/restore, finish/reopen, post-sale setup lock, board write rejection, concurrent revision conflicts, and logout cookie expiry:

```powershell
npm.cmd run audit:draft-day-live -- --base=https://pipsprojects.com --production
```

The command intentionally creates a uniquely named `QA… Live Audit` production league and prints no access codes.

## Production requirement

`DRAFT_DAY_SESSION_SECRET` must be a separate random value of at least 32 characters in Netlify production. Never reuse a Thunder Bowl credential and never commit the value.

## Engineering handoff

Start here:

- Domain rules and event ledger: `public/draft-day/core.mjs`
- Organizer UI: `public/draft-day/setup.mjs`
- Auctioneer UI and offline queue: `public/draft-day/auctioneer/auctioneer.mjs`
- Public board lifecycle: `public/draft-day/board/board.mjs`
- Browser persistence contract: `public/draft-day/session-storage.mjs`
- HTTP/session boundary: `netlify/functions/_draft-day/http-handlers.mjs` and `security.mjs`
- Strongly consistent service/store: `netlify/functions/_draft-day/service.mjs` and `store.mjs`
- User tutorial: `public/draft-day/guide/index.html`
- Automated coverage: `tests/draft-day-*.test.mjs`

Release procedure: run build, targeted Draft Day tests, full tests, and the live audit; bump the single Draft Day shell version in all pages and `service-worker.js`; commit and push `main`; deploy `public` plus Netlify functions; verify production assets and APIs; then repeat the authenticated Chrome smoke test. Do not stop shared local servers or other Codex processes during handoff.
