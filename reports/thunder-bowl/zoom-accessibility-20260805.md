# Thunder Bowl high-zoom draft-day QA — 2026-08-05

## Target

- Hardware: 16-inch MacBook Pro, 3072×1920 physical pixels, 16:10.
- Old-eyes requirement: keep the critical live-auction controls usable at 125% and 150% browser zoom without shrinking their text or click targets.
- Browser test equivalents: 1229×768 for 125%; 1024×640 for 150%.

## 150% equivalent — 1024×640

### Live draft room

- Horizontal overflow: no.
- Top bar: 0–57 px.
- Fast search: 372–422 px.
- Fixed sale recorder: 504–633 px.
- Record and undo buttons: both visible, each 52 px high.
- Result: pass. Search, selected-player decision area, bid recording, and undo remain simultaneously usable.

### Auto-auction practice

- Horizontal overflow: no.
- Top bar: 0–57 px.
- Fast search: 372–422 px.
- Practice console: 454–633 px; it begins 32 px below the search field.
- Start nomination, Bid +$1, I'm out, and Pause: all visible, each 60 px high.
- Result: pass. The practice console does not cover search and every time-critical action remains above the fold.

## 125% equivalent — 1229×768

- Horizontal overflow: no.
- Fast search, selected-player name, model maximum, fixed sale recorder, Record sale, and Undo last sale were all visible together.
- Result: pass.

## Permanent guard

- `tests/zoom-layout.test.mjs` enforces the short-desktop media query, pinned live/practice controls, compact status treatment, and large practice targets.
- Full automated suite: 137/137 pass.
- Build validation: pass with 716 players and 12 teams.
- Full-auction rehearsal: 168 sales, replay p95 0.4063 ms, reconnect 0.9596 ms.
- Catastrophe rehearsal: 24 keepers plus 144 sales, reconnect 1.1459 ms, recovery 17.9849 ms.

The compact layout changes presentation only. It does not alter the projection pack, VBD, auction values, keepers, or the audited event ledger.

## Production verification

- Release: `20260805b`; offline shell: `thunder-bowl-shell-v44`.
- Netlify deploy: `6a73492eb78c48233b18ce88`.
- Production repeated the 1024×640 live-draft and auto-auction measurements above exactly, returned HTTP 200 for the app and versioned assets, and produced no browser diagnostic logs.
