# Pip's Draft Day Tool

Stage One is a league-configurable fantasy-football auction room at `/draft-day/`. It deliberately contains no VBD, ADP, projections, rankings, or draft advice.

## Product operating principle

Every change must make the tool easier, more intuitive, more desirable, and faster than paper or competing online services. Prefer eliminating a class of mistakes over patching one symptom, explain unusual league rules where they are entered, preserve the organizer's intent when setup is reopened, and test the complete affected workflow before shipping.

## Routes

- `/draft-day/` — create a league or manage setup before the first auction sale
- `/draft-day/auctioneer/` — predictive keeper and sale entry, corrections, undo/restore, backups, clock, board status, and CSV export
- `/draft-day/board/` — code-protected read-only room board
- `/draft-day/guide/` — short organizer and auctioneer operations guide

## Data and security boundaries

- Each league receives a random eight-character league code.
- Organizer, auctioneer, and Draft Board access codes are independently salted and hashed with scrypt. Plaintext codes are returned only through the creator's own form state and are never stored by the server.
- Role sessions are separate HTTP-only, same-site cookies signed with `DRAFT_DAY_SESSION_SECRET`.
- The Draft Board snapshot excludes event history, custom-player management, entered salary-pool setup, and every credential field.
- Netlify Blobs stores one strongly consistent, revisioned document per league. Auction events are append-only; correction, undo, and restore add events rather than rewriting a sale.
- The checked-in 716-player pool contains public identity fields only: id, name, position, and NFL team.

## Local development

Set a local secret of at least 32 characters, then run:

```powershell
$env:DRAFT_DAY_SESSION_SECRET='replace-with-local-32-character-secret'
npm.cmd run dev -- --offline --no-open
```

Run validation with:

```powershell
npm.cmd test
npm.cmd run build
```

## Production requirement

Set `DRAFT_DAY_SESSION_SECRET` to a new random value of at least 32 characters in the Netlify production environment before deploying. Never reuse a Thunder Bowl credential and never commit the value.

## Stage One acceptance flow

1. Create a multi-team league with individualized pools and position rules.
   - A blank position maximum means no position-specific limit; the overall roster maximum still applies.
   - “Allow any mix of backups” clears every position maximum at once.
2. Add keepers from the collapsible auctioneer Keeper Setup using the identity-only 2026 player search.
   - Player position and NFL team fill from the catalog.
   - Salary is required; contract year and keeper round are optional.
   - A league-level keeper maximum is optional and enforced per team.
   - The first auction sale locks new keeper entry; legal audited correction, undo, and restore remain available.
   - In current-cash mode salaries are not deducted twice; in pre-keeper mode they reduce auction cash automatically.
3. Sign into auctioneer and Draft Board roles separately.
4. Record a sale and observe the board update.
5. Correct, undo, and restore the sale.
6. Verify overspending and impossible-roster purchases are blocked.
7. Export spreadsheet-safe CSV, including keeper contract year and keeper round, plus JSON backup.

The later customizable VBD/ADP application should consume this event history through a separate normalized import/valuation layer; it must not add strategy fields to the Stage One board payload.

