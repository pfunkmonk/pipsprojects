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
4. **Experimental challengers:** unvalidated matchup correctors, new projection blends, medical/weather/college features, and any novel mathematical model. These receive no permanent authority until time-forward tests improve the agreed metrics.

## Auction-intelligence stack

| Layer | Current implementation | Authority |
| --- | --- | --- |
| Legal room arithmetic | $1,212 confirmed starting pool; reserve only enough $1 bids to finish a legal 8-player lineup; 8–14 final players allowed | Authoritative |
| Dynamic auction values | Historical roster-depth demand, position spend, live cash, live keeper/sale scarcity | Authoritative Market display |
| Team budget pressure | Cash less legal-completion reserve, compared with active-room average | Advisory feature |
| Manager tendencies | Four seasons of winning purchases, empirically shrunk toward league average | Advisory feature |
| Team WTP | Market × shrunk position/affinity × roster need × budget pressure × substitutes × live bounded evidence; correlated market/team shocks prevent false max-of-11 certainty | Advisory challenger |
| Whole-roster safety | 192 correlated market/position rollouts plus an exact cash-constrained required-starter portfolio under current personal caps | Advisory only; recomputed after every sale/correction |
| Position budget lanes | Historical Thunder Bowl position spend and final-roster depth, rescaled to current cash and remaining additions | Private planning aid; no value authority |
| Sale mechanism | Highest bidder wins near the second-highest WTP + $1 | Advisory challenger |
| Comparable anchoring | Recent same-position/tier prices and measurable room residuals | Advisory challenger |
| Position runs | Six-sale decaying frequency + overpay detector; four-sale/two-position minimum; historical continuation precision remains weak, so the HUD shows WATCH while WTP/VBD/Max effect stays zero | Display-only challenger |
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
2. Blend the available Footballguys, CBS, and FantasyPros point projections with registered inverse-MAE reliability weights. Missing sources reduce confidence and renormalize the remaining weights; they are never silently replaced with zero.
3. Apply only adjustments that reconcile by named component: mean reversion, within-position correction, season context, durability, and current availability.
4. Use weekly matchup, venue, travel, weather climatology, short-turnaround, division, and playoff evidence to shape weekly value. It may not manufacture extra season points unless an isolated time-forward season-total test earns that authority.
5. Emit an honest uncertainty interval and explicit fallback reason for every player.
6. Recompute VBD, intrinsic value, Market, Max, and keeper surplus inside Thunder Bowl through the released value engine—not in the projection updater.

The August 9 surrogate test scored 1,153 player-seasons in strict time-forward folds. Equal weighting beat the single-source reference (41.041 versus 41.748 MAE), and equal consensus plus a lean position-specific mean-reversion calibration improved MAE to 39.456 with no position regression. Inverse-error source weighting, within-position shrinkage, season-total context, a second durability haircut, and the full feature pile did not beat that challenger and remain rejected for automatic use.

The separate clean 2023 paired audit adds 412 like-for-like FBG/CBS player outcomes. Its two-source consensus scored 44.653 MAE versus 45.338 for the better single source. The confidence interval on the small FBG/CBS accuracy difference crossed zero, so the production source tilt is deliberately tiny rather than falsely precise: FBG 33.7%, FantasyPros 33.3%, and CBS 33.0% when all three are present. FantasyPros receives a neutral midpoint reliability prior until a comparable historical point archive exists.

The released **Thunder Bowl Consensus** is therefore the accuracy-weighted source blend only. It drives projected points and the downstream VBD engine. Mean reversion, durability, weather, analog, and schedule total-point corrections remain at exactly zero because they did not clear their promotion gates. The draft room discloses the live weights, source range, fallback coverage, and zero QA correction for the selected player.

### League schedule configuration and weekly-context gate

The private Admin screen owns a strict, portable annual league-setup record rather than hard-coded commissioner data. Pip can assign all 12 teams to divisions, enter Dogs of War's Week 1-14 opponent or explicitly mark an all-play week, set playoff weeks and qualification berths, save it offline, and export/import a validated JSON backup. The verified 2026 setup is West Division with T-Dogs and Three Amigos; division-priority games are Weeks 1, 2, 12, and 13. Week 14 is all-play with no head-to-head opponent and receives ordinary weight. Playoff qualification is four division winners plus two wild cards, with Weeks 15-17 marked as playoffs.

The released importance policy is 1.20× for division weeks and 1.50× for playoff weeks, with Week 18 assigned zero league utility. It is normalized against replacement-level players, receives 35% preseason timing authority, and is capped at ±3 VBD points so it remains a tie-breaker rather than overwhelming the consensus projection.

On August 9, the raw weekly context correctors were tested on 31,486 player-weeks in strict time-forward folds from 2018-2025. Both models received the same realized player-season total, isolating whether prior-career venue/weather/rest splits and prior-season opponent defense distributed points across weeks more accurately than a flat per-game baseline. The best challenger (matchup only) worsened MAE by 0.36%, won only 2/8 season folds and 1/4 position folds. The full context model worsened MAE by 1.10% and won 0/8 seasons and 0/4 positions. Those raw correctors remain rejected. Reports live in `reports/weekly-context-time-forward-backtest.{json,md}` and the repeatable runner is `scripts/backtest-weekly-context.py`.

The August 9 component bundle is a separate weekly-shape input. Its governed intake validates 716 players and 12,888 player-weeks, hashes both CSVs, requires complete identities/byes, rescoring and reconciliation, and rejects every point/VBD/price field. It applies league scoring to weekly components and rescales the result to the already-approved season consensus, so weekly timing coverage increases from 447 to 716 without changing the signed season projection. Honest nonzero component coverage is 623/716; the 93 component-empty rows are all $1 players and use a source/team weekly share rather than invented components.

A separate priority-week calibration then joined 48 archived Thunder Bowl team-seasons (2015, 2017, 2018, and 2023) to actual results. Archived preseason weekly timing correlated 0.210 with realized within-team weekly scoring and had a 0.371 calibration slope. In 150,000 common-random-number league simulations, a divisional-week point carried 1.210× the championship leverage of an ordinary-week point; a playoff-week point carried 6.860×, reflecting direct elimination leverage. The archived grid peaked in-sample at 1.30/1.85 but was unstable in leave-one-season-out folds. Published guidance brackets division games around 1.20 and playoff weeks from 1.50 to 2.00. The released 1.20/1.50 policy therefore shrinks below the grid winner and is further protected by 35% authority plus the ±3 VBD cap. It now recalculates VBD, the live auction market, keeper comparisons, and bid guidance through one shared runtime pack. The repeatable audit is `scripts/backtest-priority-week-weights.py`; reports are `reports/priority-week-weight-calibration.{json,md}`.

### Projection updater handoff contract

- exactly one row for every one of the 716 active pack players;
- exact pack ID plus available FBG, CBS, FantasyPros, and GSIS source IDs;
- immutable model ID, timezone-bearing source/export timestamps, scoring fingerprint, and `candidate_only` authority;
- all three raw source values, their registered accuracy-weighted consensus, every named adjustment, final modified projection, uncertainty bounds, fallback reason, and optional Weeks 1–18 values;
- exactly one blank bye week when weekly values are supplied, with weekly values reconciling to the season total;
- fail-closed rejection of missing/duplicate players, identity drift, stale or malformed metadata, forged consensus values, unreconciled adjustments, or malformed weeks;
- candidate pack and audit output first; an explicit, separately audited promotion action is required before the active pack changes.

Beginning with the 2026 snapshot, every dated premium-source input, modified projection, model ID, and later result will be retained so future tests no longer depend on surrogate sources.

Novel ideas from medicine, engineering, finance, operations research, or other sciences are welcome as challengers. At least three unconventional models should be tested, but none receives automatic model weight. Examples queued for controlled tests include:

1. reliability/survival-style workload modeling for injury-adjusted availability;
2. portfolio optimization that values correlated upside, floor, and playoff paths rather than independent point totals;
3. robust-control or minimax roster construction that performs well across projection-source disagreement and injury scenarios.

## Release checkpoint — August 9, 2026

- The live practice room carries 716 players, all 12 league teams, the accuracy-weighted FBG/CBS/FantasyPros consensus, authenticated keeper contracts, historical demand, auction simulation, and the verified 2026 division schedule.
- Production Chrome QA passed the private room, prediction sandbox keeper/undo, atomic two-player-plus-cap trade/undo, auctioneer login and illegal-bid rejection, Draft Board login, 12-team public rendering, and private-field isolation without recording a live sale.
- The refreshed 716-player valuation audit found 0 VBD formula mismatches and 0 legacy identity-curve repairs. Seventy-nine large source disagreements remain explicitly flagged as forecast uncertainty (not silently promoted), with only one starter/replacement reversal across every available external source; that player remains at the $1 floor.
- Unchanged 1.5-second ledger polls no longer rewrite IndexedDB or rebuild the 716-player DOM. Rendering now occurs only when the append-only event sequence, ledger generation, or board link actually changes.
- All role-specific shells use an external CSP-compatible hidden-state rule. Inline CSS that the strict Thunder Bowl security policy would reject has been removed from the auctioneer and board shells.
- A production intelligence-popout stress test exposed legacy UTF-8 mojibake in command-center labels. Every known artifact was corrected, and the build now recursively rejects common decoding artifacts across public and function sources.
- The in-app operation guide covers the private command center, keeper sandbox versus official ledger, auctioneer, Draft Board, draft-morning gate, and the real internet-out failover path.
- The deterministic catastrophe rehearsal is the accepted technical rehearsal evidence. Physical speaking/projector practice is optional and is never falsely certified by automation.
- The active weekly-asset pack is `tb26-tb-accuracy-consensus-20260809-v1-2026080922-weekly-assets-20260810033019-priority-v1-assets-v1`. The released market model improves matched historical auction-price MAE from 5.887 to 4.191 (28.8%) with 79.4% held-out 80% interval coverage. Final automated counts and rehearsal evidence are refreshed after every authority-bearing release.
- The draft-speed review is implemented: collapsed Live Bid HUD, adjacent chance-at-cap, whole-roster Monte Carlo safety, historical position budget lanes, roster-after-likely-win analysis, explicit hard-stop language, exact last-sale correction preview, one-key full evidence, surplus heat, three-play nomination assistant, private asset lines, Pro mode, keyboard controls, intel age, evidence-only news warning badges, equal-height viewport columns with internal secondary scrolling, static Safety rails moved to Admin & data, and an exact-byte one-click final-pack promotion gate. Position-run pressure failed its authority threshold and is therefore a visible warning only.
- The command center is rehearsal-ready. The only authority-bearing data change still planned is promotion of next week's final governed projection pack; draft morning then requires a fresh all-player intelligence seal and recovery download on the MacBook.

## Near-term sequence

1. Complete the separate projection-upgrade application's exact 716-player candidate export through the validated handoff boundary.
2. Review source omissions, source disagreement, uncertainty, durability, and availability exceptions before any promotion decision.
3. Accumulate every 2026 timestamped source forecast, modified forecast, sale outcome, runner-up, and nomination position.
4. Re-run the projection and price challengers after each rehearsal; publish error and interval-calibration reports.
5. Run the deterministic full-system and catastrophe rehearsals after every authority-bearing pack change. They must cover the complete auction, keeper/cap trades, auctioneer/manual failover, offline divergence, reconnect, recovery restore, latency, and public/private isolation. A physical speaking/projector exercise remains useful but optional and is never falsely certified as automated evidence.
6. Keeper selection and rights trading begin August 15. When the final projection export arrives, rebuild the accuracy-weighted consensus, apply league scoring, recompute weekly shapes and classic VBD, rerun keeper scarcity and the live auction market, rerank every keeper/trade board, run the valuation/outlier and Monte Carlo audits, and promote only the governed candidate. Every recorded keeper, pass, or trade must then recalculate the remaining auction pool immediately.
7. Freeze the draft-morning release only after the complete automated gate passes and the user completes the fresh intelligence capture and recovery download.
