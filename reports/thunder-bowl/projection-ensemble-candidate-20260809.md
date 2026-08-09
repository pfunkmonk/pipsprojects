# Thunder Bowl projection ensemble candidate

Status: **implemented as a private, value-neutral challenger; live projection promotion blocked**.

## What changed

- The draft room can now show a collapsed Thunder Projection Lab disclosure for the selected player.
- It shows the current primary projection, the equal FBG/CBS/FantasyPros consensus, the surrogate-gated modified candidate, and an 80% historical residual interval.
- Existing weekly context is rescaled to the candidate total without changing the weekly shape or creating season points.
- The public board, keeper ledger, VBD, intrinsic dollars, Market, Max, auction forecast, and bid recommendation cannot read this preview.
- A strict 716-player CSV contract now connects the separate projection updater to a candidate-pack builder. The builder recalculates downstream values internally and leaves the active pack unchanged.

## Time-forward evidence

Historical snapshots for the exact premium trio are not available. The available archived Sleeper/ESPN snapshots were used as a surrogate mechanics test across 1,153 player-seasons with each test year trained only on earlier years.

| Challenger | MAE | Decision |
| --- | ---: | --- |
| One-source reference | 41.748 | Reference |
| Equal two-source consensus | 41.041 | Keep |
| Inverse-MAE weighted consensus | 41.095 | Reject; did not beat equal weighting |
| Equal consensus + lean mean reversion | 39.456 | Lowest-error surrogate challenger |
| Within-position shrink | 43.097 | Reject |
| Season-total context after calibration | 39.999 | Reject for total-point authority |
| Second durability layer | 40.032 | Reject for total-point authority |
| Full feature pile | 40.295 | Reject for total-point authority |

The lowest-error challenger improved MAE at QB, RB, WR, and TE versus the one-source reference. Exact premium-source promotion remains blocked because transfer from Sleeper/ESPN to FBG/CBS/FantasyPros is not guaranteed.

## Gibbs example

- FBG: 339.6
- CBS: 386.5
- FantasyPros: 372.2
- Equal premium consensus: 366.1
- Surrogate RB calibration: `max(0, -2.157168 + 0.909122 × consensus)`
- Thunder candidate: 330.7
- Surrogate historical 80% range: 275.5–413.3

This is deliberately conservative after calibration because archived preseason totals—especially high totals—were optimistic on average. The result is evidence for review, not a live value override.

## Promotion rule

A future completed premium-source handoff may produce a structurally valid candidate and audit, but it cannot be made authoritative until exact timestamped FBG/CBS/FantasyPros history passes time-forward error, rank, lineup, auction, calibration, position/tier, performance, offline, and rehearsal gates.
