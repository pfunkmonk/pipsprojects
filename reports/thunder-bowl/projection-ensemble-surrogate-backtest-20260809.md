# Thunder Bowl projection ensemble surrogate backtest

Generated: 2026-08-09T16:13:15.811276+00:00

Decision: **SURROGATE GATE PASSED — LIVE PROMOTION STILL BLOCKED**

Historical premium FBG/CBS/FantasyPros snapshots are unavailable. This validates ensemble/sauce mechanics on archived Sleeper/ESPN projections, not the exact 2026 premium trio.

| Variant | N | MAE | RMSE | Bias | Spearman | Top-tier hit | Bust rate |
|---|---:|---:|---:|---:|---:|---:|---:|
| raw_primary | 1153 | 41.748 | 57.030 | 13.579 | 0.7959 | 0.7432 | 0.1206 |
| raw_equal_blend | 1153 | 41.041 | 56.579 | 10.034 | 0.7995 | 0.7315 | 0.1206 |
| weighted_blend | 1153 | 41.095 | 56.636 | 9.860 | 0.7985 | 0.7315 | 0.1206 |
| within_position | 1153 | 43.097 | 56.994 | 16.658 | 0.7985 | 0.7315 | 0.1206 |
| lean_mean_reversion | 1153 | 39.456 | 54.666 | -4.461 | 0.7995 | 0.7315 | 0.0856 |
| mean_reversion | 1153 | 39.514 | 54.624 | -2.902 | 0.7985 | 0.7315 | 0.0778 |
| context_only | 1153 | 39.999 | 55.324 | -0.642 | 0.7954 | 0.7198 | 0.0856 |
| durability | 1153 | 40.032 | 55.376 | 0.339 | 0.7914 | 0.7082 | 0.0856 |
| full_model | 1153 | 40.295 | 55.268 | -0.698 | 0.7894 | 0.7121 | 0.0934 |

## Position MAE for lowest-error variant

- QB: 57.657 (-0.304 versus raw primary)
- RB: 42.282 (-1.085 versus raw primary)
- WR: 37.714 (-4.623 versus raw primary)
- TE: 27.576 (-0.792 versus raw primary)

## Authority

This report cannot promote a live projection. Exact 2026 FBG/CBS/FantasyPros forecasts must remain candidate-only until their timestamped snapshots can be scored without retrospective leakage.
