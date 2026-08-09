# Auction Intelligence Release Candidate — 2026-08-09

## Outcome

The ten auction-microstructure ideas are implemented as one private advisory stack without changing authoritative VBD, Market, Max, the public ledger, or the projector board.

The system follows the mission gate: one compact forecast block replaces the older abstract pressure score; the optional runner-up interaction takes one selection; missed entries self-dismiss after 30 seconds; corrections and exports live behind a collapsed Admin disclosure.

## What is active

- second-highest-WTP + $1 pricing frame;
- per-team legal maximum, legal-completion reserve, budget pressure, roster need, and substitute scarcity;
- empirical-Bayes shrinkage of every manager position and NFL-team affinity tendency;
- comparable-sale anchoring, measurable global room residual, and a simple position-run heuristic;
- 384 selected-auction WTP draws for the immediate price distribution;
- 96 remaining-auction cash/roster rollouts for nomination-window evidence;
- natural room price vs. Dogs of War participation at the current effective limit;
- a rational roster/cap-constrained reference price;
- a private runner-up log with automatic pre-sale forecast snapshots, later correction, CSV export, and recovery-bundle inclusion.

## Calibration and authority

The released historical-demand baseline remains authoritative. Its matched-purchase MAE is $4.191, improved from $5.887 for the classic starter-only baseline.

The coarse baseline price interval uses 141 matched development purchases. Its leave-one-season-out 80% band covered 79.4%, with mean width $14.553. Position radii are QB $7, RB $8, WR $14, TE $7, K $7, and DST $7; low-sample positions fall back to the global $7 radius.

That interval is a safety proxy, not proof that the new per-team WTP challenger is conformal. The WTP challenger did not exist historically and historical runner-up bids do not exist. It remains `advisory_only_experimental` until timestamped predictions earn their own out-of-sample calibration.

## Correct league arithmetic

- Confirmed 2026 starting room cash is $1,212, not $1,200.
- A team must finish a legal starting lineup of 8 players and may stop there or draft up to 14.
- Budget pressure therefore reserves only the $1 additions still required to become legal.
- Unspent auction cash may disappear; it is not forced into player prices.

## UI acceptance gate

- Tested at 1536×960 CSS pixels, corresponding to the 3072×1920 Retina workspace.
- Base body text is 18px.
- Bid ceiling, player values, scarcity, and auction forecast are visible together.
- No horizontal page overflow was observed.
- Manual-backup sale entry is fixed within the bottom 129 pixels of the viewport.
- The full rollout is cached by player, ledger, telemetry, pack, and bid limit so repeated search rendering does not recompute it.

## QA evidence

- Unit/system tests cover strict private telemetry validation, void reconciliation, winner/runner-up separation, empirical-Bayes shrinkage, legal budget reserve, WTP caps, second-price arithmetic, deterministic remaining-auction rollouts, recovery inclusion, offline caching, and public-board non-disclosure.
- The selected-player remaining-auction rollout stays below the 100 ms computation gate after warm-up in the automated performance check.
- Local browser inspection found no console errors on the new draft surface.

## Known evidence limits

- Historical winning purchases identify prices and owners but not runner-up bidders or losing bid ceilings.
- Historical nomination timestamps/order are incomplete, so nomination-order weighting remains simulated and explicitly warns about wait risk.
- The rational baseline is a reference for a constrained room, not a prediction that managers behave optimally.
- Manager psychology labels are intentionally absent; only observable cash, roster, prices, and sequence are modeled.

## Next promotion evidence

At least 30 timestamped sale forecasts are recommended before reporting a first live WTP calibration table. Promotion still requires better time-forward MAE/pinball loss, approximately correct interval coverage, no position/tier regression, complete catastrophe rehearsal, and human approval of the draft-day interaction speed.
