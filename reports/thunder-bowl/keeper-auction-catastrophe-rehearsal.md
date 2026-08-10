# Thunder Bowl 2026 — Keeper-to-Auction Catastrophe Rehearsal

Generated: 2026-08-10T03:34:12.382Z

Result: **PASS**

This accepted deterministic gate uses the active validated 716-player practice pack. It records the Herbert cap trade, corrects a mistaken keeper destination with an append-only void, assigns 24 legal keepers, completes the other 144 purchases, rejects an illegal maximum bid, corrects an offline price, merges a 72-sale outage exactly and idempotently, round-trips the full private recovery bundle, and tests the public/private boundary throughout. It satisfies the technical rehearsal gate; it does not claim physical speaking, projector, or venue-network evidence.

## Workload

- 716 current practice players and 177 authenticated keeper candidates
- 12 teams × 2 keepers + 144 auction purchases = 168 final rostered players
- 174 physical audit events; 170 active events
- Event replay p95: 0.5561 ms; maximum: 0.8749 ms
- Public snapshot p95: 0.3304 ms; maximum: 0.3304 ms
- Offline reconnect merge: 1.1402 ms
- Recovery validation/replay: 25.9421 ms

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

Pack SHA-256: `756c41777792b278f591245515b32eec908b59ff27e75d94f4a82b4554c98f1a`

Engine SHA-256: `8c7b7f09496751f1504607620989f7799af98976abfb70267f0ae538aba51b87`

Ledger SHA-256: `fab85222bed1ff351a921a81a7fa04df489aa4517cf99c5044700145ba6f5b20`
