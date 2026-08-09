# Thunder Bowl valuation release — 2026-08-09

## Release decision

Promote the historically calibrated auction-demand market to the live draft room and keeper prediction workspace. This release changes anticipated auction prices and conservative bid ceilings; it does not replace or average the primary player projections.

## System corrections

- Preserve the existing Thunder Bowl VBD calculation. The reproducible audit found zero VBD arithmetic mismatches across all 716 players.
- Price each position from Thunder Bowl's observed roster-depth demand and historical position spending instead of treating the eight-player legal starting lineup as the entire auction demand curve.
- Assign market dollars monotonically by projected points within each position. This removes 22 material legacy cases in which the correct dollar from a position curve had been attached to the wrong player identity.
- Recalculate the complete remaining market after every keeper, trade, or auction purchase. Cheap keepers reduce supply while preserving room cash; they cannot lower their own counterfactual auction value merely because they were kept.
- Keep conservative bid ceilings separate from anticipated room prices. The draft room can therefore show a market price above the user's rational maximum without recommending that the user chase it.

## Calibration evidence

The active blend uses 75% position-budget demand and 25% the prior room curve. The weights were selected from time-forward 2023 and 2024 development folds using prior Thunder Bowl seasons only.

- Canonically matched purchases: 141
- Prior classic matched MAE: $5.887
- Released blend matched MAE: $4.191
- Improvement: 28.8%
- 2025 outcomes remain descriptive-only and are not represented as an unseen holdout.

The historical demand profile covers 48 team-seasons from 2021, 2022, 2023, and 2025. The 2024 roster snapshot was excluded because it was incomplete.

## Source safeguards

- The supplied Footballguys auction-value PDF remains comparison-only. Its Draft Dominator file differs from Thunder Bowl in 23 roster/scoring settings, including roster rounds, PPR, passing touchdowns, sacks, interceptions, and points allowed.
- The Footballguys importer now requires the corresponding DDF configuration, audits it against the league pack, and fails closed unless an incompatible import is explicitly quarantined.
- CBS, Footballguys, FantasyPros, and the experimental candidate model remain visible as evidence. No supplemental source gains value authority merely because it is present.

## Regression examples

- David Montgomery: +0.0 lineup VBD, $11 anticipated market, $7 conservative max. The zero VBD is a replacement-line result; the $11 market price reflects observed backup-RB purchasing.
- Terry McLaurin: $7 anticipated market, $5 conservative max.
- Ameer Abdullah: corrected from a legacy $6 identity assignment to $1.
- Denver DST: $5 anticipated market, preventing raw defensive point scale from consuming RB/WR auction dollars.

## Verification

- `npm test`: 227/227 passed.
- `npm run build`: passed with 716 players and 12 teams.
- `npm run audit:thunder-values`: passed; zero VBD formula mismatches.
- `npm run backtest:thunder-market`: passed and reproduced the calibration metrics above.
- Local browser smoke test: David Montgomery rendered at +0.0 / $11 / $7; FBG incompatibility warning rendered; no console errors.

Detailed evidence is in `valuation-audit-20260808.md`, `valuation-audit-20260808.csv`, `auction-demand-market-20260808.md`, and `auction-market-position-calibration-20260808.json` in this directory.
