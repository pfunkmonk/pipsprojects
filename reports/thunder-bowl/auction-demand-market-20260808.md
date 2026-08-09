# Thunder Bowl historical auction-demand market

Status: validated for **market-price estimation only**. Classic starter-count VBD remains the bid-authority control.

## Outcome

Thunder Bowl managers do not stop at the mandatory 24 RB and 24 WR starters. Across the 48 usable team-seasons from 2021, 2022, 2023, and 2025, expected league demand is 44.75 RB and 41.50 WR. The live market now prices that bench demand while leaving lineup VBD unchanged.

The market estimate is a preregistered-style blend:

- 75% historical-demand auction value;
- 25% classic starter-VBD intrinsic dollars;
- 2025 player outcomes excluded from the price and decision backtests;
- 2024 roster counts excluded from the 2026 demand profile because that roster snapshot is incomplete.

## Time-forward price evidence

The candidate was evaluated on the same unseen 2023 and 2024 auction-purchase rows used by the conventional replay. Explicit keepers were excluded where acquisition labels allowed it. Every unmodeled player received the same $1 floor.

| Price model | 2023 MAE | 2024 MAE | Combined MAE |
|---|---:|---:|---:|
| Classic starter-VBD room curve | $5.247 | $6.574 | $5.887 |
| Global historical-demand dollars | $4.151 | $5.574 | $4.837 |
| Position-budget historical demand | $4.164 | $4.838 | $4.489 |
| 75% position demand / 25% classic blend | **$3.753** | **$4.662** | **$4.191** |

The blended market estimate reduced combined development-fold price MAE by 28.8% versus classic pricing, 13.4% versus the earlier global-demand model, and improved both folds. The source contains 241 auction-purchase rows; 141 have canonical identifiers that join to the preseason projection pools and constitute the price-error evaluation above. Unmatched rows receive the same $1 fallback in every candidate and are not used to exaggerate the comparison. These are development folds, not a claimed untouched final holdout; 2025 was excluded because its outcomes had already informed prior work and its current projection/auction identifiers do not join reliably.

Historical position spending also prevents one position's fantasy-point scale from consuming another position's auction dollars. Across 2021, 2022, 2023, and 2025, the observed spend was QB $420, RB $2,090, WR $1,618, TE $431, K $87, and DST $123. At the untouched 2026 room total of $1,212, that becomes dynamic opening budgets of QB $107, RB $531, WR $411, TE $110, K $22, and DST $31.

## Why it does not control Max

Historical-depth utility was also retested as a roster-selection authority. It remains unstable. In the unseen 2023 fold, a 75% depth-utility blend selected the same roster outcome as full historical-depth VBD: 141.54 realized positive VBD and 1,609.02 actual starter points, versus 244.66 and 1,801.12 for classic VBD. Its 2024 improvement does not erase that reversal.

Therefore:

- **Market** estimates what this league is likely to pay, using historical bench demand and live room cash.
- **Max** remains the classic starter-VBD control, adjusted only by the established live-room multiplier and the user's personal limits.
- Market demand may inform keeper surplus, trade value, opponent practice behavior, and auction inflation.
- It may not silently become Dogs of War's bid ceiling.

## 2026 regression examples

| Player | Lineup VBD | Old market | Validated market |
|---|---:|---:|---:|
| David Montgomery | 0.0 | $1 | $11 |
| Terry McLaurin | 0.0 | $1 | $7 |
| Jahmyr Gibbs | 137.8 | $40 | $30 |
| Denver Broncos | 112.4 | $5 | $5 |
| Ameer Abdullah | -175.1 | $6 | $1 |
| Robbie Ouzts | -199.4 | $2 | $1 |

## Runtime invariants

- Historical demand expects 144 purchases at the untouched 2026 starting state, not an automatic 168 maximum-roster purchases.
- Demand is recalculated from every team's current positional holdings, open capacity, and cash.
- Declared keepers and completed sales immediately remove supply and update remaining demand.
- The demand-only curve preserves every remaining room dollar before the validated market blend is applied.
- Within each position, a higher projected player cannot receive a lower market estimate than a lower projected player.
- The classic market and max-bid curves are reassigned monotonically within position, removing player-identity price artifacts without changing the shape of the room curve.
- A kept player's counterfactual market estimate remains available for keeper and trade evaluation.
- The entire model runs locally and synchronously; it adds no draft-day API call or user step.
