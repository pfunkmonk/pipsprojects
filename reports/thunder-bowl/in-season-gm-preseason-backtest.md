# Thunder Bowl In-Season GM — preseason backtest

Date: 2026-08-30  
Season: 2026  
Status: engineering gates passed; outcome calibration blocked until completed 2026 weeks exist

## Honest scope

No 2026 regular-season outcomes exist yet. This is not presented as a predictive-accuracy backtest. It is a deterministic engineering and sensitivity audit against the released 2026 player universe. The first legitimate time-forward accuracy report can be produced after Week 1 by freezing the Tuesday recommendation snapshot, then comparing it with the week’s final scoring and transactions without changing the archived inputs.

## Preseason gates

- Exact lineup contains 1 QB, 2 RB, 2 WR, 1 TE, 1 K, and 1 DST; the six bench players do not contribute to the total.
- A registered current-week Footballguys projection change can alter the selected starter.
- A critical injury removes that player from the recommended starting lineup.
- A missing projection is excluded; it is never converted to zero.
- Waiver additions remain inside the authenticated CBS available-player set.
- Every waiver addition is paired with a player actually on Dogs of War’s roster, and the resulting roster retains a legal lineup path.

Run `npm run backtest:thunder-season` to reproduce the audit. The script prints a content-hashed JSON result and fails closed when any invariant breaks.

The August 30 run used pack `tb26-final-supplemental-catalog-20260829132049` (717 players), produced a Week 1 baseline exact-lineup total of 153.2, reacted to the registered projection perturbation at 154.3, passed every gate, and emitted deterministic result SHA-256 `bc567bc91a3ab1ea41601605b63fc1d37b5ea1314bc89b94f2b417d2144c280f` in two consecutive runs.

## Time-forward adoption gate

After each completed week, evaluate lineup regret, projection MAE by source, waiver marginal points over 1/3/remaining-season horizons, false availability signals, injury false positives, and two-sided trade deltas. Do not add news, injury, matchup, weather, travel, or venue modifiers to the scoring model unless the frozen out-of-sample archive demonstrates a durable improvement over the registered projection baseline.
