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

Novel ideas from medicine, engineering, finance, operations research, or other sciences are welcome as challengers. At least three unconventional models should be tested, but none receives automatic model weight. Examples queued for controlled tests include:

1. reliability/survival-style workload modeling for injury-adjusted availability;
2. portfolio optimization that values correlated upside, floor, and playoff paths rather than independent point totals;
3. robust-control or minimax roster construction that performs well across projection-source disagreement and injury scenarios.

## Near-term sequence

1. Accumulate 2026 timestamped forecasts, sale outcomes, runner-ups, and nomination order.
2. Re-run the price challenger after each rehearsal; publish error and interval-calibration reports.
3. Add new projection data from the separate projection-upgrade application through the validated import boundary.
4. Rehearse auctioneer-feed failure, manual takeover, Wi-Fi loss, recovery restore, and second-screen board.
5. Freeze a draft-morning release only after the complete automated and human departure gates pass.
