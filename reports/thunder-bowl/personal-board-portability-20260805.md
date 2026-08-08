# Thunder Bowl private personal-board portability

Date: 2026-08-05  
Release: `20260805e`  
Offline shell: `thunder-bowl-shell-v47`  
Production deploy: `6a73518fc360b45e499eeb40`

## Outcome

Targets, Avoids, steal prices, hard-stop prices, and personal notes are no longer stranded in one browser's local storage. Admin & data now provides a private JSON backup/restore path for moving those decisions to the MacBook, plus a spreadsheet-safe CSV reading copy.

## Safety contract

- The JSON contract contains only exact player identity and the existing personal annotation schema.
- Same-season files remain valid after a 2026 projection-pack refresh; the source pack ID is retained as provenance but is not a lock.
- Import replaces matching player decisions and preserves current decisions for players omitted from a partial file.
- Wrong season, unknown player, duplicate player, changed player identity, malformed price/note/tag, empty row, extra top-level field, extra entry field, or extra annotation field fails the entire import before local data changes.
- `modelEffect: none` and `ledgerEffect: none` are mandatory. The import function has no event, pack, VBD, market-value, or maximum-bid write path.
- CSV cells are quoted and formula-leading values are neutralized. CSV is a reading copy; JSON is the restorable format.

## Browser QA

- Local 1536x960 and 1024x640 high-zoom layouts had zero horizontal overflow.
- All three controls measured 48 px high.
- Existing local Jahmyr Gibbs data rendered correctly as one Target, one priced decision, and one note.
- Local JSON and CSV downloads completed and reported exact row counts.
- Production loaded `app.mjs?v=20260805e`, rendered the portability card, served the cached exchange module, and completed an empty-board JSON smoke download without error.

## Automated verification

- Web/release tests: 153 passed.
- Production build: passed with 716 players, 12 teams, and private/public isolation intact.
- Full auction rehearsal: 168 sales; replay p95 0.3834 ms; search p95 0.0309 ms; reconnect 1.0742 ms.
- Keeper/auction catastrophe rehearsal: 24 keepers plus 144 sales; replay p95 0.4178 ms; reconnect 1.2315 ms; recovery 17.337 ms.
- Production index, app, exchange module, and service worker returned HTTP 200.

## Mac transfer procedure

1. On the computer holding the completed personal board, open **Admin & data** and choose **Download private JSON**.
2. Copy that JSON file to the MacBook with a USB drive, AirDrop, iCloud Drive, Dropbox, or another private method.
3. Open the same season's Thunder Bowl room on the MacBook, open **Admin & data**, and choose **Import private JSON**.
4. Confirm the displayed counts for player decisions, Targets, Avoids, personal prices, and notes.
5. Optionally download the CSV for a human-readable audit. Do not use the CSV for restoration.
