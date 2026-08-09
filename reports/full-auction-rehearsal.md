# Thunder Bowl 2026 — Automated Full-Auction Rehearsal

Generated: 2026-08-09T16:19:04.683Z

Result: **PASS**

This is a deterministic automated state, rule, recovery, and latency rehearsal. It deliberately exercises 168 active purchases, a corrected price via append-only void, an illegal maximum-bid attempt, a 96-sale offline fork/reconnect, and the public/private data boundary. It does not replace the later human-paced usability rehearsal.

## Workload

- 168 players
- 12 teams × 14 roster spots
- 171 physical audit events; 169 active events
- Incremental replay p95: 0.4052 ms; maximum: 0.5714 ms
- Search p95: 0.0302 ms; maximum: 0.1324 ms
- Offline reconnect merge: 1.0871 ms
- Public snapshot generation: 0.2085 ms

## Gate checks

| Check | Result |
|---|---|
| activeSalesExactly168 | PASS |
| legalFourteenPlayerRosters | PASS |
| allStarterPathsSatisfied | PASS |
| illegalBidRejected | PASS |
| voidAndCorrectionReplayed | PASS |
| offlineMergeExact | PASS |
| publicFieldIsolation | PASS |
| replayP95Under50Ms | PASS |
| searchP95Under50Ms | PASS |
| reconnectUnder250Ms | PASS |

## Final rosters

| Team | Players | Cash left | Positions |
|---|---:|---:|---|
| Goon Skwad | 14 | $13 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| Dogs of War | 14 | $11 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| El Guapo | 14 | $9 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| Angry Face | 14 | $7 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| Big Head | 14 | $7 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| Crime and Punishment | 14 | $7 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| Orange Crush | 14 | $7 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| Super Suckers | 14 | $7 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| T-Dogs | 14 | $7 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| The Bungles | 14 | $7 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| The Hobbits | 14 | $7 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |
| Three Amigos | 14 | $7 | QB 2, RB 4, WR 4, TE 2, K 1, DST 1 |

Ledger SHA-256: `69d6360fb3793905fb8c33b51b85b6d26460f1277aa563bef9a466efd77364c6`
