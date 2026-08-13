# Thunder Bowl manager-history audit

- Generated: `2026-08-13T18:00:01.000Z`
- Model: `manager-history-v2-recency-shrunk`
- Included seasons: 2012, 2015, 2017, 2018, 2019, 2021, 2022, 2023, 2024, 2025
- Validated auction purchases: **1252**
- Selected recency half-life: **1000.0 seasons**
- Cross-validated profile reliability: **0.15** (maximum allowed: 0.5)
- Authority: advisory only; no intrinsic VBD or bid-limit effect

## Identity continuity

- `Big Pimpin` → `Fumble Brewskis` / `Fumble-Brewskis` → `The Bungles`
- `Whoopass` / `The Whoopass` → `Three Amigos`
- Spelling and punctuation variants are normalized before aggregation.

## Season coverage

| Season | Purchases | Keeper rows excluded | Invalid rows excluded | Source |
|---:|---:|---:|---:|---|
| 2012 | 123 | 24 | 0 | 2012 Final.ddf (rounds 1-2 excluded as keepers) |
| 2015 | 125 | 24 | 0 | 2015 - DRAFT SUMMARY.csv |
| 2017 | 132 | 24 | 0 | 2017 - DRAFT SUMMARY.csv |
| 2018 | 137 | 24 | 1 | 2018 - DRAFT SUMMARY.csv |
| 2019 | 135 | 0 | 0 | 2019 Thunder Bowl Draft Results.csv |
| 2021 | 115 | 24 | 0 | backtest_player_auction_2021_2025.csv |
| 2022 | 126 | 24 | 0 | backtest_player_auction_2021_2025.csv |
| 2023 | 121 | 23 | 0 | backtest_player_auction_2021_2025.csv |
| 2024 | 120 | 0 | 0 | backtest_player_auction_2021_2025.csv |
| 2025 | 118 | 24 | 0 | backtest_player_auction_2021_2025.csv |

## Excluded seasons

- **2010:** No machine-readable completed auction result found.
- **2011:** The only DraftDominator file contains 24 keeper-stage rows, not a completed auction.
- **2013:** The only DraftDominator file contains 13 partial/keeper-stage rows.
- **2014:** The 96-row export is an unrelated eight-team league with zero-dollar rows; the Thunder Bowl file is keeper-only.
- **2016:** No completed auction summary or DraftDominator result found.
- **2020:** The available DraftDominator file contains only seven draft rows and four keeper rows.

## Safety contract

Only winning auction purchases are used. Keeper prices, waiver acquisitions, post-draft roster snapshots, incomplete auctions, and the unrelated 2014 league are excluded. The resulting tendencies remain empirically shrunk, advisory-only inputs to rival willingness-to-pay and practice behavior.
