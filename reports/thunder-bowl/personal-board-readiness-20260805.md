# Thunder Bowl personal-board readiness binding

Date: 2026-08-05  
Release: `20260805f`  
Offline shell: `thunder-bowl-shell-v48`  
Production deploy: `6a735a889d74088a8939c2a4`

## Outcome

The draft-morning departure gate now proves that the current Targets, Avoids, steal prices, hard-stop prices, and notes match a recent private JSON export or a JSON restore on the current laptop. A stale backup can no longer look current after an edit or deletion.

## Evidence contract

- The exact same-season personal-board payload is canonicalized and SHA-256 fingerprinted.
- Evidence records only season, export/import action, time, decision count, fingerprint, and mandatory `modelEffect: none` / `ledgerEffect: none` boundaries.
- A different 2026 projection pack does not invalidate an unchanged personal board.
- Any changed annotation, deletion, added decision, changed count, malformed evidence, future time, wrong season, authority field, or age over seven days produces a readiness warning.
- An empty personal board passes honestly because there is no private player decision to transfer.
- JSON export and JSON import create evidence. The readable CSV does not, because it is intentionally not restorable.
- Every local or cross-tab annotation edit clears saved evidence and immediately reruns the readiness check.

## Browser lifecycle QA

At 1024x640 high zoom with the existing Jahmyr Gibbs Target, price, and note:

1. Pre-export card showed `Needs private JSON`; readiness showed a yellow warning.
2. JSON export changed the card to `Backed up ...`; readiness passed with the exact one-decision message.
3. A temporary note edit immediately changed the card and readiness back to warning.
4. QA found and fixed a stale success-message trap, then verified the visible instruction changed to `Personal board changed. Download a new private JSON...`.
5. The original Gibbs note was restored and a new JSON export returned the exact board to green.
6. No horizontal overflow occurred and all three portability controls remained 48 px high.

Production with an empty personal board showed `No backup needed`, a passing readiness row, release `20260805f`, zero horizontal overflow, and three 48 px controls.

## Verification

- Web/release tests: 157 passed.
- Production build: passed with 716 players, 12 teams, and private/public isolation intact.
- Full auction rehearsal: 168 sales; replay p95 0.6529 ms; search p95 0.0489 ms; reconnect 1.4013 ms.
- Keeper/auction catastrophe rehearsal: 24 keepers plus 144 sales; replay p95 0.6379 ms; reconnect 1.747 ms; recovery 28.6124 ms.
- Production index, app, personal-board exchange, readiness module, and service worker returned HTTP 200.

