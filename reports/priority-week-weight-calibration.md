# Priority-week weight calibration

Generated 2026-08-29T12:52:59.413462+00:00 from 48 archived Thunder Bowl team-seasons and 150,000 common-random-number Monte Carlo trials.

## Forecast coverage and timing reliability

| Season | Teams | Skill players | Team forecast match | Player actual match |
|---:|---:|---:|---:|---:|
| 2015 | 12 | 123 | 100.0% | 87.8% |
| 2017 | 12 | 132 | 100.0% | 92.4% |
| 2018 | 12 | 137 | 100.0% | 94.2% |
| 2023 | 12 | 120 | 100.0% | 100.0% |

Centered preseason-to-actual weekly timing correlation: **0.210**; calibration slope: **0.371** across 780 team-weeks.

## Monte Carlo marginal leverage

Each derivative is the change in outcome probability from one extra lineup point in one week, estimated with the same random schedules for baseline and boosted trials.

| Week class | Division-title derivative | Playoff derivative | Championship derivative |
|---|---:|---:|---:|
| Ordinary | +0.001223 | +0.001569 | +0.000238 |
| Division | +0.001501 | +0.001544 | +0.000288 |
| Playoffs | +0.000000 | +0.000000 | +0.001631 |

Division/ordinary leverage ratio for playoff qualification: **0.984×**.
Division/ordinary leverage ratio for winning the league: **1.210×**.
Playoff/ordinary leverage ratio for winning the league: **6.860×**.

## Historical weekly-weight grid

Baseline correlations — playoff: **0.315**; championship: **0.250**.
Grid champion — division **1.30×**, playoffs **1.85×**; playoff correlation **0.329**, championship correlation **0.270**.

The grid is a small archived sample and is used as a guardrail, not as permission to overfit.

## Live recommendation

Use **1.00× ordinary / 1.20× division / 1.50× playoffs** and set Week 18 to zero. Give the weekly timing signal **35% authority**, calculate it relative to positional replacement, and cap any player at **±3 VBD**.

The 1.20 division weight matches the simulated championship leverage and Footballguys' published conference-game guidance. The 1.50 playoff weight matches the published optimization paper's playoff-versus-regular win utility and deliberately stays below both Footballguys' 2.00 suggestion and the 1.85 in-sample grid result because the archived timing signal is noisy and leave-one-season-out results are unstable.
