# Weekly context time-forward backtest

Time-forward weekly-shape test. Both models receive the same realized player-season total; only preseason-available prior-season/prior-career context may redistribute it.

| Challenger | Rows | Flat MAE | Context MAE | Change | Season wins | Position wins |
|---|---:|---:|---:|---:|---:|---:|
| matchup_only | 31,486 | 4.6706 | 4.6873 | +0.0167 (+0.358%) | 2/8 | 1/4 |
| personal_only | 31,486 | 4.6706 | 4.7046 | +0.0340 (+0.728%) | 0/8 | 0/4 |
| full_context | 31,486 | 4.6706 | 4.7218 | +0.0512 (+1.096%) | 0/8 | 0/4 |

Champion: **matchup_only**. Promotion gate: **HOLD**.

The realized season total is used only to isolate weekly-shape accuracy; it does not make this a season-total projection backtest.
