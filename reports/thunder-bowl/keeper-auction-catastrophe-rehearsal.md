# Thunder Bowl 2026 — Keeper-to-Auction Catastrophe Rehearsal

Generated: 2026-08-09T14:59:59.835Z

Result: **PASS**

This deterministic gate uses the active validated 716-player practice pack. It records the Herbert cap trade, corrects a mistaken keeper destination with an append-only void, assigns 24 legal keepers, completes the other 144 purchases, rejects an illegal maximum bid, corrects an offline price, merges a 72-sale outage exactly and idempotently, round-trips the full private recovery bundle, and tests the public/private boundary throughout. It does not replace the final human-paced usability rehearsal.

## Workload

- 716 current practice players and 177 authenticated keeper candidates
- 12 teams × 2 keepers + 144 auction purchases = 168 final rostered players
- 174 physical audit events; 170 active events
- Event replay p95: 0.4098 ms; maximum: 0.7411 ms
- Public snapshot p95: 0.2658 ms; maximum: 0.2658 ms
- Offline reconnect merge: 1.2626 ms
- Recovery validation/replay: 16.1448 ms

## Gate checks

| Check | Result |
|---|---|
| realValidated2026PackUsed | PASS |
| capTransferDirectionCorrect | PASS |
| tradedKeeperPreservesSalaryAndYear | PASS |
| keeperCorrectionIsAppendOnly | PASS |
| twentyFourLegalKeepers | PASS |
| oneHundredFortyFourSales | PASS |
| completeLegalRosters | PASS |
| illegalBidRejected | PASS |
| offlinePriceCorrectionReplayed | PASS |
| offlineMergeExactAndIdempotent | PASS |
| recoveryRoundTripExact | PASS |
| projectorFieldIsolationThroughout | PASS |
| replayP95Under50Ms | PASS |
| publicSnapshotP95Under50Ms | PASS |
| reconnectUnder250Ms | PASS |
| recoveryUnder1000Ms | PASS |

## Final rosters

| Team | Cap after trade | Keepers | Players | Cash left | Positions |
|---|---:|---:|---:|---:|---|
| Goon Skwad | $104 | 2 | 14 | $57 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| Dogs of War | $106 | 2 | 14 | $61 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| El Guapo | $102 | 2 | 14 | $57 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| Angry Face | $100 | 2 | 14 | $55 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| Big Head | $100 | 2 | 14 | $55 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| Crime and Punishment | $100 | 2 | 14 | $55 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| Orange Crush | $100 | 2 | 14 | $55 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| Super Suckers | $100 | 2 | 14 | $55 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| T-Dogs | $100 | 2 | 14 | $55 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| The Bungles | $100 | 2 | 14 | $55 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| The Hobbits | $100 | 2 | 14 | $53 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| Three Amigos | $100 | 2 | 14 | $55 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |

Pack SHA-256: `7ae356f76542ccad8cee292055e0c7cbc1ba67197b7f421a6ff941cbad841cd1`

Engine SHA-256: `0f20cd605092dc6af90cafeafa3715e032c3504c5b488203698d637a589d4975`

Ledger SHA-256: `60f41788691a07ff9506570c45fe6e54666f0f705e692615d0757b41398a2d53`
