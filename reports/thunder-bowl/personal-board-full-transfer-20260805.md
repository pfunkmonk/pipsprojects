# Thunder Bowl deletion-safe full personal-board transfer

Date: 2026-08-05  
Release: `20260805g`  
Offline shell: `thunder-bowl-shell-v49`  
Production deploy: `6a735c8c573aef0f5aafc9d9`

## Outcome

New private JSON files are complete-board snapshots. Importing one on the Mac replaces the entire current personal board, so a player deliberately cleared on Windows is also cleared on the Mac. Omitted decisions can no longer survive as stale Targets, Avoids, prices, or notes.

## Compatibility and safety

- Schema v2 adds `scope: full-board`; exact import clears current decisions absent from the file.
- Already-downloaded schema-v1 files remain valid only as explicit legacy merges. They preserve unrelated local decisions because v1 cannot distinguish a deliberate deletion from a partial export.
- A legacy merge does not create draft-morning transfer evidence. The app instructs the operator to create a new v2 export on the source computer.
- Readiness evidence is now schema v2 and records `boardSchemaVersion: 2`. Evidence created by a v1 export expires automatically after upgrade.
- Full-board import is staged before mutation. Local annotation storage and IndexedDB evidence are restored to their prior values if commit or rendering fails.
- Full-board and legacy paths remain same-season, exact-identity, `modelEffect: none`, and `ledgerEffect: none`; neither can write projections, VBD, prices, pack state, events, or the public board.

## Verification

- Contract tests prove exact deletion transfer, pack-refresh survival, v1 merge preservation, invalid-scope rejection, obsolete-evidence rejection, and full state fingerprinting.
- Application tests prove full/legacy branching, rollback restoration of both local stores, readiness behavior, and zero model/ledger writes.
- The actual local browser download was inspected at `C:\Users\mailp\Downloads\thunder-bowl-2026-personal-board-2026-08-05T15-53-00-848Z.json`: schema 2, `full-board`, season 2026, one entry, and both authority effects `none`.
- Browser QA proved old v1 evidence became `Needs private JSON`; a fresh v2 export restored green. At 1024x640 the card had zero horizontal overflow and all controls were 48 px high.
- Web/release tests: 158 passed.
- Production build: passed with 716 players and 12 teams.
- Full auction rehearsal: 168 sales; replay p95 0.5884 ms; search p95 0.0599 ms; reconnect 1.1251 ms.
- Keeper/auction catastrophe rehearsal: 24 keepers plus 144 sales; replay p95 0.6206 ms; reconnect 1.7216 ms; recovery 27.38 ms.
- Production app, exchange module, and service worker returned HTTP 200; release and offline-shell versions matched.

