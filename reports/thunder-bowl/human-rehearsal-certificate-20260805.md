# Thunder Bowl human-paced rehearsal certificate QA — 2026-08-05

## Purpose

Automated load and catastrophe tests cannot prove that one operator can bid, speak, enter purchases, watch a projector, survive Wi-Fi loss, and recover under room noise. Admin now exposes the exact physical exit test as a seven-item local certificate.

## Required physical actions

1. Complete a full 12-team mock auction at realistic speaking and entry speed.
2. Project the public board on a second computer and observe roughly one-second updates.
3. Deliberately disconnect Wi-Fi during active bidding.
4. Search, record a sale, and use Undo while offline.
5. Reconnect and verify queued events merge without duplicates or lost corrections.
6. Download and successfully restore a recovery bundle.
7. Operate the intended MacBook zoom while bidding, talking, and tracking the room alone.

## Evidence contract

- All seven booleans must be true before sealing.
- The certificate stores a stable signature of season, rules version, roster and starter rules, all team caps, nomination order, and order verification state.
- Configuration drift, missing items, malformed/future timestamps, value-bearing authority, or age over 30 days invalidates it.
- It is human-attested and device-local. It never writes projections, VBD, prices, keepers, events, or the public board.
- A missing or invalid certificate appears as a departure warning; a current certificate appears as a pass.
- Training sandboxes cannot seal it because they do not exercise the real second-screen cloud path.

## QA

- Browser testing found and fixed an initial systemic defect where ordinary background rerenders could erase partially checked items.
- After the fix, all seven UI checks remained selected through 2.5 seconds of background activity, enabled sealing only at 7/7, and returned to 0/7 without saving a false certificate.
- Production 1024×640 QA: no horizontal overflow; 24×48 px checkbox controls; 52 px action buttons; all seven items present; readiness warning present; diagnostics empty.
- Automated suite: 148/148 pass.
- Full auction: 168 sales; replay p95 0.5996 ms; search p95 0.0563 ms; reconnect 1.2849 ms.
- Catastrophe rehearsal: 24 keepers plus 144 sales; replay p95 0.6889 ms; reconnect 1.5378 ms; recovery 27.4892 ms.

## Production

- Release `20260805d`.
- Offline shell `thunder-bowl-shell-v46`.
- Netlify deploy `6a734f080adb605b80e375a7`.
