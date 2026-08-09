# Thunder Bowl 2026 Product Plan

## Non-negotiable mission gate

Every feature and change must be:

- easier and more intuitive than paper or competing draft software;
- desirable to use under loud, fast, one-person auction conditions;
- faster than the manual alternative;
- complete enough to avoid a second tracking system;
- verified at the system level, with experimental model outputs quarantined until they earn authority.

No individual bug fix is complete until the underlying class of failure is tested and prevented.

## Product authority layers

1. **Authoritative draft ledger:** keepers, trades, caps, sales, undo history, nomination order, roster legality, and public board.
2. **Authoritative player-value core:** current primary projections, league scoring, historical roster-depth demand, position budgets, replacement levels, VBD, Market, and Max.
3. **Private advisory intelligence:** opponent willingness-to-pay, auction forecasts, simulation ranges, nomination timing, comparable-sale anchoring, and Dogs of War participation counterfactuals.
4. **Experimental challengers:** weekly matchup weights, new projection blends, medical/weather/college features, and any novel mathematical model. These receive no permanent authority until time-forward tests improve the agreed metrics.

## Auction-intelligence stack

| Layer | Current implementation | Authority |
| --- | --- | --- |
| Legal room arithmetic | $1,212 confirmed starting pool; reserve only enough $1 bids to finish a legal 8-player lineup; 8–14 final players allowed | Authoritative |
| Dynamic auction values | Historical roster-depth demand, position spend, live cash, live keeper/sale scarcity | Authoritative Market display |
| Team budget pressure | Cash less legal-completion reserve, compared with active-room average | Advisory feature |
| Manager tendencies | Four seasons of winning purchases, empirically shrunk toward league average | Advisory feature |
| Team WTP | Market × shrunk position/affinity × roster need × budget pressure × substitutes × live bounded evidence | Advisory challenger |
| Sale mechanism | Highest bidder wins near the second-highest WTP + $1 | Advisory challenger |
| Comparable anchoring | Recent same-position/tier prices and measurable room residuals | Advisory challenger |
| Position runs | Simple last-two/last-three same-position heuristic; no overfit Hawkes process | Advisory challenger |
| Remaining-auction simulation | 96 deterministic-seed rollouts that spend cash and fill historical position depth before the target nomination | Advisory challenger |
| Nomination timing | Read from rollout windows with an explicit wait/availability warning | Advisory challenger |
| Rational baseline | Roster/legal-cap constrained market baseline; reference only | Advisory reference |
| Dogs counterfactual | Natural room price vs. outcome when Dogs participates at the current effective limit | Advisory challenger |
| Price intervals | Simulation envelope unioned with a coarse historical baseline error radius | Advisory safety range |

## Learning protocol

- After each sale, privately save the forecast that existed immediately before the sale.
- Offer Pip a non-modal, optional runner-up selector for 30 seconds; never send this evidence to the public ledger or board.
- Preserve missed runner-up rows for later correction in Admin & data.
- Treat the runner-up as a censored WTP boundary, not an exact valuation.
- Export all private learning evidence in the recovery bundle and a readable CSV.
- Refit only between rehearsals or drafts, never invisibly during active bidding.

## Promotion gates

An auction-price challenger may influence authoritative Market only after all of the following pass:

- time-forward or leave-one-season-out evaluation with no outcome leakage;
- lower sale-price MAE and pinball loss than the released baseline;
- an 80% interval with approximately 80% out-of-sample coverage and acceptable width;
- no material degradation by position, price tier, or auction phase;
- full ledger, roster-legality, offline, recovery, and public-privacy tests;
- selected-player response below 100 ms after warm-up on the draft laptop;
- a human 12-team rehearsal at realistic auction speed.

Until then, the challenger is visible only as a labeled private advisory.

## Projection/VBD research program

The player-value foundation remains at least as important as price prediction. Every projection or VBD challenger must be evaluated on preseason-only inputs against later results, with injuries and games played reported separately. Required outputs include total/weekly error, rank correlation, lineup/roster surplus, playoff qualification, and simulated auction surplus.

### Projection ensemble architecture

The target pipeline is source evidence → Thunder projection → VBD → intrinsic dollars → historically calibrated auction market → live-room bid guidance. Source projections never write VBD or dollars directly.

1. Rescore every source to the exact Thunder Bowl scoring fingerprint before comparison.
2. Average the available Footballguys, CBS, and FantasyPros point projections as the transparent raw consensus. Missing sources reduce confidence; they are not silently replaced with zero.
3. Apply only adjustments that reconcile by named component: mean reversion, within-position correction, season context, durability, and current availability.
4. Use weekly matchup, venue, travel, weather climatology, short-turnaround, division, and playoff evidence to shape weekly value. It may not manufacture extra season points unless an isolated time-forward season-total test earns that authority.
5. Emit an honest uncertainty interval and explicit fallback reason for every player.
6. Recompute VBD, intrinsic value, Market, Max, and keeper surplus inside Thunder Bowl through the released value engine—not in the projection updater.

The August 9 surrogate test scored 1,153 player-seasons in strict time-forward folds. Equal weighting beat the single-source reference (41.041 versus 41.748 MAE), and equal consensus plus a lean position-specific mean-reversion calibration improved MAE to 39.456 with no position regression. Inverse-error source weighting, within-position shrinkage, season-total context, a second durability haircut, and the full feature pile did not beat that challenger and remain rejected for automatic use.

This result validates the architecture, not a live premium-source replacement: the archived history contains Sleeper/ESPN forecasts rather than the exact dated Footballguys/CBS/FantasyPros trio. The draft room therefore shows the Thunder result only in a collapsed, private **candidate only / no value effect** disclosure until exact-source evidence earns promotion.

### Projection updater handoff contract

- exactly one row for every one of the 716 active pack players;
- exact pack ID plus available FBG, CBS, FantasyPros, and GSIS source IDs;
- immutable model ID, timezone-bearing source/export timestamps, scoring fingerprint, and `candidate_only` authority;
- all three raw source values, their equal consensus, every named adjustment, final modified projection, uncertainty bounds, fallback reason, and optional Weeks 1–18 values;
- exactly one blank bye week when weekly values are supplied, with weekly values reconciling to the season total;
- fail-closed rejection of missing/duplicate players, identity drift, stale or malformed metadata, forged consensus values, unreconciled adjustments, or malformed weeks;
- candidate pack and audit output only. The active pack remains unchanged until the independent projection promotion gate passes.

Beginning with the 2026 snapshot, every dated premium-source input, modified projection, model ID, and later result will be retained so future tests no longer depend on surrogate sources.

Novel ideas from medicine, engineering, finance, operations research, or other sciences are welcome as challengers. At least three unconventional models should be tested, but none receives automatic model weight. Examples queued for controlled tests include:

1. reliability/survival-style workload modeling for injury-adjusted availability;
2. portfolio optimization that values correlated upside, floor, and playoff paths rather than independent point totals;
3. robust-control or minimax roster construction that performs well across projection-source disagreement and injury scenarios.

## Near-term sequence

1. Complete the separate projection-upgrade application's exact 716-player candidate export through the validated handoff boundary.
2. Review source omissions, source disagreement, uncertainty, durability, and availability exceptions before any promotion decision.
3. Accumulate every 2026 timestamped source forecast, modified forecast, sale outcome, runner-up, and nomination position.
4. Re-run the projection and price challengers after each rehearsal; publish error and interval-calibration reports.
5. Rehearse auctioneer-feed failure, manual takeover, Wi-Fi loss, recovery restore, and second-screen board.
6. Freeze a draft-morning release only after the complete automated and human departure gates pass.
