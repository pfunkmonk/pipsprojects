# Thunder Bowl 2026 — Keeper-to-Auction Catastrophe Rehearsal

Generated: 2026-08-17T22:36:52.983Z

Result: **PASS**

This accepted deterministic gate uses the active validated 716-player practice pack. It records the Herbert cap trade, corrects a mistaken keeper destination with an append-only void, assigns 24 legal keepers, completes the other 144 purchases, rejects an illegal maximum bid, corrects an offline price, merges a 72-sale outage exactly and idempotently, round-trips the full private recovery bundle, and tests the public/private boundary throughout. It satisfies the technical rehearsal gate; it does not claim physical speaking, projector, or venue-network evidence.

## Workload

- 716 current practice players and 177 authenticated keeper candidates
- 12 teams × 2 keepers + 144 auction purchases = 168 final rostered players
- 174 physical audit events; 170 active events
- Event replay p95: 0.5056 ms; maximum: 0.8344 ms
- Public snapshot p95: 0.3151 ms; maximum: 0.3151 ms
- Offline reconnect merge: 1.3998 ms
- Recovery validation/replay: 36.7647 ms

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

Pack SHA-256: `e8e7ef29f90d03ccef82e86922943d5e0d4cf4caf8428fdf4744de8bcbd6d2c2`

Engine SHA-256: `861931cece846e63646b0f04edfb2ca19da993363d85161804a46cefa915663c`

Ledger SHA-256: `2d98a6dfcd65baa0a77b15b55e140984d193e1216a6ae5732b8a7455f6fabc19`
