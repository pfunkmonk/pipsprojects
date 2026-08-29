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
| Dynamic auction values | Historical roster-depth demand, position spend, live cash, live keeper/sale scarcity, plus the promoted ten-season position/rank price curve | Authoritative Market display |
| Glance value verdict | Intrinsic versus Market, tier deadline, hard stop, and whole-roster simulation produce BARGAIN / FAIR / WAIT / TIER SAVE | Private advisory; cannot change VBD, Market, or Max |
| Team budget pressure | Cash less legal-completion reserve, compared with active-room average | Advisory feature |
| Manager tendencies | 1,252 validated winning purchases across ten usable seasons (2012-2025 with documented gaps), identity-normalized, keepers/post-draft moves excluded, and rolling-origin calibrated to 0.15 reliability plus runtime empirical-Bayes shrinkage | Advisory feature |
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
2. Blend the available Footballguys, CBS, FantasyPros, and PFF league-scored weekly projections with registered reliability weights. FBG/CBS retain their measured inverse-MAE tilt; FantasyPros/PFF use neutral priors until comparable historical archives exist. Missing player-weeks reduce confidence and renormalize the remaining weights; they are never silently replaced with zero.
3. Apply only adjustments that reconcile by named component: mean reversion, within-position correction, season context, durability, and current availability.
4. Use weekly matchup, venue, travel, weather climatology, short-turnaround, division, and playoff evidence to shape weekly value. It may not manufacture extra season points unless an isolated time-forward season-total test earns that authority.
5. Emit an honest uncertainty interval and explicit fallback reason for every player.
6. Recompute VBD, intrinsic value, Market, Max, and keeper surplus inside Thunder Bowl through the released value engine—not in the projection updater.

The August 9 surrogate test scored 1,153 player-seasons in strict time-forward folds. Equal weighting beat the single-source reference (41.041 versus 41.748 MAE), and equal consensus plus a lean position-specific mean-reversion calibration improved MAE to 39.456 with no position regression. Inverse-error source weighting, within-position shrinkage, season-total context, a second durability haircut, and the full feature pile did not beat that challenger and remain rejected for automatic use.

The separate clean 2023 paired audit adds 412 like-for-like FBG/CBS player outcomes. Its two-source consensus scored 44.653 MAE versus 45.338 for the better single source. The confidence interval on the small FBG/CBS accuracy difference crossed zero, so the production source tilt is deliberately tiny rather than falsely precise. FantasyPros and PFF each receive the same neutral midpoint reliability prior until a comparable historical point archive exists; with all four sources present the weights are approximately FBG 25.3%, FantasyPros 25.0%, PFF 25.0%, and CBS 24.7%.

The released **Thunder Bowl Consensus** is therefore the accuracy-weighted source blend only. It drives projected points and the downstream VBD engine. Mean reversion, durability, weather, analog, and schedule total-point corrections remain at exactly zero because they did not clear their promotion gates. The draft room discloses the live weights, source range, fallback coverage, and zero QA correction for the selected player.

### League schedule configuration and weekly-context gate

The private Admin screen owns a strict, portable annual league-setup record rather than hard-coded commissioner data. Pip can assign all 12 teams to divisions, enter Dogs of War's Week 1-14 opponent or explicitly mark an all-play week, set playoff weeks and qualification berths, save it offline, and export/import a validated JSON backup. The verified 2026 setup is West Division with T-Dogs and Three Amigos; division-priority games are Weeks 1, 2, 12, and 13. Week 14 is all-play with no head-to-head opponent and receives ordinary weight. Playoff qualification is four division winners plus two wild cards, with Weeks 15-17 marked as playoffs.

The released importance policy is 1.20× for division weeks and 1.50× for playoff weeks, with Week 18 assigned zero league utility. It is normalized against replacement-level players, receives 35% preseason timing authority, and is capped at ±3 VBD points so it remains a tie-breaker rather than overwhelming the consensus projection.

On August 9, the raw weekly context correctors were tested on 31,486 player-weeks in strict time-forward folds from 2018-2025. Both models received the same realized player-season total, isolating whether prior-career venue/weather/rest splits and prior-season opponent defense distributed points across weeks more accurately than a flat per-game baseline. The best challenger (matchup only) worsened MAE by 0.36%, won only 2/8 season folds and 1/4 position folds. The full context model worsened MAE by 1.10% and won 0/8 seasons and 0/4 positions. Those raw correctors remain rejected. Reports live in `reports/weekly-context-time-forward-backtest.{json,md}` and the repeatable runner is `scripts/backtest-weekly-context.py`.

The August 9 component bundle is a separate weekly-shape input. Its governed intake validates 716 players and 12,888 player-weeks, hashes both CSVs, requires complete identities/byes, rescoring and reconciliation, and rejects every point/VBD/price field. It applies league scoring to weekly components and rescales the result to the already-approved season consensus, so weekly timing coverage increases from 447 to 716 without changing the signed season projection. Honest nonzero component coverage is 623/716; the 93 component-empty rows are all $1 players and use a source/team weekly share rather than invented components.

A separate priority-week calibration then joined 48 archived Thunder Bowl team-seasons (2015, 2017, 2018, and 2023) to actual results. Archived preseason weekly timing correlated 0.210 with realized within-team weekly scoring and had a 0.371 calibration slope. In 150,000 common-random-number league simulations, a divisional-week point carried 1.210× the championship leverage of an ordinary-week point; a playoff-week point carried 6.860×, reflecting direct elimination leverage. The archived grid peaked in-sample at 1.30/1.85 but was unstable in leave-one-season-out folds. Published guidance brackets division games around 1.20 and playoff weeks from 1.50 to 2.00. The released 1.20/1.50 policy therefore shrinks below the grid winner and is further protected by 35% authority plus the ±3 VBD cap. It now recalculates VBD, the live auction market, keeper comparisons, and bid guidance through one shared runtime pack. The repeatable audit is `scripts/backtest-priority-week-weights.py`; reports are `reports/priority-week-weight-calibration.{json,md}`.

### Projection updater handoff contract

- exactly one row for every one of the 717 active pack players;
- exact pack ID plus available FBG, CBS, FantasyPros, PFF, and GSIS source IDs;
- immutable model ID, timezone-bearing source/export timestamps, scoring fingerprint, and `candidate_only` authority;
- all four raw source values, their registered accuracy-weighted consensus, every named adjustment, final modified projection, uncertainty bounds, fallback reason, and optional Weeks 1–18 values;
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
- Draft Board team headers are keyboard-accessible controls for a public salary-ledger audit. Each ledger reconstructs the $100 opening cap, bonuses/adjustments, trades, keepers, and purchases from active canonical events, reconciles to authoritative cash, stays read-only, and closes by outside click, ×, or Escape without moving the board.
- The deterministic catastrophe rehearsal is the accepted technical rehearsal evidence. Physical speaking/projector practice is optional and is never falsely certified by automation.
- The active weekly-asset pack is `tb26-tb-cbs-fbg-refresh-20260812-20260812225551-m-weekly-assets-20260816234243-priority-v1-assets-v1`. The released market model improves matched historical auction-price MAE from 5.887 to 4.191 (28.8%) with 79.4% held-out 80% interval coverage. Final automated counts and rehearsal evidence are refreshed after every authority-bearing release.
- The draft-speed review is implemented: collapsed Live Bid HUD, adjacent chance-at-cap, whole-roster Monte Carlo safety, historical position budget lanes, roster-after-likely-win analysis, explicit hard-stop language, exact last-sale correction preview, one-key full evidence, surplus heat, three-play nomination assistant, private asset lines, Pro mode, keyboard controls, intel age, evidence-only news warning badges, equal-height viewport columns with internal secondary scrolling, static Safety rails moved to Admin & data, and an exact-byte one-click final-pack promotion gate. Position-run pressure failed its authority threshold and is therefore a visible warning only.
- The August 16 league-price promotion uses all 1,252 validated purchases across ten seasons with an eight-season half-life. Five-season time-forward player matching selected a conservative 60% historical price-curve blend and improved overall sale-price MAE from `$3.690` to `$2.822` and premium-player MAE from `$5.114` to `$3.941`. The compact BARGAIN / FAIR / WAIT / TIER SAVE verdict is an advisory translation of intrinsic value, live Market, tier deadline, hard stop, and roster Monte Carlo safety; it cannot alter VBD, Market, Max, or ledger state.
- The command center and the August 29 final governed projection pack are technically release-ready. The remaining owner/device operations are a fresh all-player intelligence seal and recovery download on the MacBook after the exact deployed pack is locked in production.

## Release-candidate wrap — August 11, 2026

- Signed-in production Chrome QA covered the private draft room, keeper sandbox, manual backup, restricted auctioneer, and read-only Draft Board at a 1536×960 effective viewport. No production sale was recorded and no private strategy field appeared on a public surface.
- The review found a shared-search consistency failure and an auctioneer client-legality consistency failure. Both were fixed at their common system boundaries and received cross-surface regression tests; details and exact release-gate evidence live in `reports/thunder-bowl/release-audit-20260811.md`.
- Runner-up evidence remains a single private production-only choice after a confirmed sale. Replay and automated practice suppress it, the winning team is excluded, `Not sure` is explicit, the prompt expires after 30 seconds, and Admin & data retains correction/export authority.
- `app.mjs` remains large. A pre-draft broad refactor was rejected by the mission gate because it would add release risk without making an auction decision faster. Post-2026 modularization should follow measured ownership boundaries and preserve the append-only ledger, public allowlist, offline recovery, and sub-100-ms selected-player response.
- The source release candidate passed the full automated gate and is ready for local commit. It must not be described as deployed until an explicit push/deploy action completes. Operator-only departure gates remain code rotation, next week's governed projection promotion, a fresh all-player intelligence seal, and a recovery download on the MacBook.

## Practice-reset usability — August 12, 2026

- The existing archive-and-generation reset is now presented in Admin & data as **Clear all player placements**, with a live count of keepers and drafted players and explicit disclosure that cap trades, passes, and nominations also reset.
- The action remains protected: exact phrase, mandatory pre-reset recovery download, immutable cloud archive, compare-and-set generation change, stale-tab rejection, and server validation. It clears the shared ledger without deleting the projection pack, intelligence archive, targets, avoids, notes, or personal prices.
- This is one system control for practice cleanup and the final pre-draft reset; no second reset mechanism or shadow ledger was introduced.

## Projection refresh checkpoint — August 12, 2026

- The governed `tb-cbs-fbg-refresh-20260812` handoff replaced the dated premium-source rows and promoted `tb26-tb-cbs-fbg-refresh-20260812-20260812225551` as the active practice pack.
- Thunder Bowl—not the projection producer—recomputed projected points, starter-baseline VBD, intrinsic dollars, historical-demand Market, Max, and keeper surplus. The full room allocation remains exactly $1,212.
- Existing August 12 weekly asset profiles were proportionally rebased to every new season total, including an explicit zero-projection path. All 716 weekly profiles retain one bye and reconcile to the authoritative projection.
- The importer now prevents two refresh-wide failure classes: stale FBG/CBS/FantasyPros evidence cannot survive behind a fresh consensus, and a newer weekly evidence timestamp cannot falsely block a slightly earlier same-day season snapshot as a rollback.
- Release QA passed 310/310 tests, the 168-sale full-auction rehearsal, the 24-keeper/144-sale catastrophe and recovery rehearsal, the 36-player/608-rollout-per-player advice Monte Carlo, and the 192-rollout foolproof roster simulation. At the 1536×960 effective MacBook viewport, a live practice nomination kept BID/HOLD/PASS plus the value verdict above the fold, all three draft columns remained equal height with internal scrolling, horizontal overflow was zero, and console diagnostics were clean. The pack remains practice-only pending the deliberate Admin final lock.
- The post-auction CBS handoff is now a deliberately boring intermediate format rather than browser-coupled code. Admin exports one validated active auction purchase per row with exactly `player_name,nfl_team,position,fantasy_team,auction_price,player_id`, raw UTF-8 CSV values, canonical full league-team names, standard positions, integer prices, and stable internal player IDs. The exporter rejects identity drift, duplicate IDs, unknown teams, malformed values, and empty ledgers; it never includes keepers, voided sales, model values, notes, totals, or private strategy. A separate tool owns CBS webpage matching and entry.

## Refreshed-pack release wrap — August 17, 2026

- The active 716-player practice pack is `tb26-tb-cbs-fbg-refresh-20260812-20260812225551-m-weekly-assets-20260816234243-priority-v1-assets-v1`; its private weekly rows, public identity build, 12 manager profiles, keeper rights, and `$1,212` room allocation pass the release gates.
- Full QA passed 372/372 tests after rebasing the concurrent Draft Day release, plus the 168-sale rehearsal, 24-keeper/144-sale catastrophe recovery, 192-rollout foolproof roster safety, and 36-player/608-path auction-advice Monte Carlo. The historical market, price curve, position-run, priority-week, and projection challenger backtests were also rerun. Evidence and remaining operator-only departure gates are recorded in `reports/thunder-bowl/release-audit-20260817.md`.
- Two release-process failure classes were repaired at their boundaries: weekly source coverage is now compared semantically instead of by JSON serialization, and the projection challenger now reconstructs time-forward lag features from raw season facts through a dependency-aware documented command. Neither change grants a supplemental source or challenger model live value authority.
- The operator field guide now covers the deterministic six-column CBS auction handoff. The product still rejects a broad pre-draft `app.mjs` refactor because it would add risk without making an auction decision faster.

## Four-source projection refresh — August 21, 2026

- The active practice pack is `tb26-tb-weekly-source-consensus-20260821-v1-20260821144515`. It was rebuilt from the dated `by_source` Footballguys, CBS, FantasyPros, and PFF weekly asset exports and rescored under Thunder Bowl rules before any source blending.
- Fresh evidence covers 627/716 players and every top-168 player. The 89 uncovered deep players preserve their previously validated season total and weekly shape. Every one of the 716 weekly profiles reconciles exactly to its authoritative season projection, and the dynamic auction allocation remains exactly `$1,212`.
- The source-wide importer prevents three failure classes found during this refresh: FBG made/missed kick columns cannot be reversed, duplicate FBG rows cannot overwrite valid offense or split DST/return assets, and CBS `missing` rows cannot masquerade as zero projections. Kicker conversion and DST coverage sanity checks fail closed before a candidate is written.
- Twelve players exceed a 75-point source spread and remain visible as role/workload uncertainty; no source triggered the repeated-collapse blocker. The current valuation audit reports four-source coverage/rank agreement and found zero VBD formula mismatches and zero starter/replacement reversals against every available external source.
- Full automated tests pass 384/384. The public identity build, private/public isolation, exact-byte pack gate, catastrophe recovery, full auction, foolproof roster safety, and advice Monte Carlo are rerun after every promoted projection pack.
- The paper catastrophe path is now deterministic rather than improvised: Admin generates value-ranked and alphabetical native PDFs containing the same top 200 players, approved schedule-adjusted VBD, clean-room pre-auction dollars, and 400 fillable AcroForm team/price fields. Each still uses 25 large rows on eight printable landscape letter pages, prefills active placements without allowing them to alter rank/value, works offline, and contains no private notes, news, personal limits, telemetry, or public-board authority.
- Keeper modeling now has a deliberate local-to-shared bridge instead of requiring manual re-entry. A protected review validates the full sandbox event sequence against the current official generation, shows every active keeper/trade/pass/correction, appends only missing event IDs, preserves the original sandbox, and fails closed on stale generations, event collisions, forbidden event types, or an illegal resulting league state. Stale-ledger recovery is available directly on the Keeper page and does not overwrite private prediction metadata.

## Near-term sequence

Final projection status (August 29): the newest Footballguys, CBS, FantasyPros, and PFF asset bundle has been league-scored, availability-weighted, audited, promoted, deployed, and exercised through the complete automated release gate. A governed supplemental catalog then added Jonnu Smith's source-backed identity without changing the other 716 player records. Production now serves immutable ID `tb26-final-supplemental-catalog-20260829132049`, pinned to SHA-256 `6214947472bdd20b16c27e62263525165a4c2a426b099bc09c9b8776ea9d4db5`.

1. Preserve the exact 717-player August 29 pack and its source/audit hashes; do not rerun or hand-edit values after the production lock.
2. Keep the nine large source disagreements visible as uncertainty and the 80 fallback deep players explicit; do not reinterpret missing evidence as zero.
3. Accumulate every 2026 timestamped source forecast, modified forecast, sale outcome, runner-up, and nomination position.
4. Re-run the projection and price challengers after each rehearsal; publish error and interval-calibration reports.
5. Run the deterministic full-system and catastrophe rehearsals after every authority-bearing pack change. They must cover the complete auction, keeper/cap trades, auctioneer/manual failover, offline divergence, reconnect, recovery restore, latency, and public/private isolation. A physical speaking/projector exercise remains useful but optional and is never falsely certified as automated evidence.
6. Keep the finalized 24-keeper official ledger separate from projection authority; every recorded auction sale must continue to recalculate the remaining pool immediately.
7. Finish the draft-morning freeze with the production pack lock, fresh intelligence capture, and MacBook recovery download.

## Access-boundary hardening — August 26, 2026

- Mission-gate outcome: shared Board and Auctioneer access cannot open or infer the private analytics pack. Authorization remains server-enforced, deny-by-default, and role-specific; no UI hiding is treated as security.
- Private, Auctioneer, and Draft Board authentication now reject ambiguous/non-JSON/oversized requests, issue signed `HttpOnly`/`Secure`/`SameSite=Strict` cookies, and are protected by deploy-level per-IP/domain throttles. Auctioneer commands receive an authenticated 64 KB request ceiling.
- A permanent endpoint inventory and token-substitution suite fails CI if a new Thunder Bowl function is not explicitly classified or if any shared role reaches the private pack, ledger, news, research, status, replay, promotion, or reset boundary.
- Defense-in-depth headers now cover the full origin and JSON responses. The service worker continues to exclude `/api/`, and the real 717-player pack remains outside `public/`.
- Honest limit: the browser-side model implementation is inspectable JavaScript. Its protected inputs and the resulting private analytics are not public. Server-side model execution would hide formulas but adds draft-day latency/offline complexity, so it remains deferred unless formula confidentiality becomes more important than the current speed and catastrophe path.

## Startup-speed release — August 23, 2026

- Startup work is now organized around the draft-day critical path: authenticate, restore the cached governed pack and append-only ledger, compute current auction authority, and show the Draft room. Pack freshness, status, news, and research refresh immediately afterward without blocking the first decision.
- Critical IndexedDB metadata uses one batch transaction, event and access reads run concurrently, large value-neutral intelligence archives hydrate after first paint, a valid cached pack avoids a blocking 2 MB download, hidden Keeper/Admin views render on demand, and the 717-player pool uses a tested fixed-window virtual table.
- Mission-gate result: no projection, VBD, Market, Max, rival-WTP, legal-roster, public allowlist, correction-history, offline, or recovery authority changed. Browser QA measured a 531 ms warm authenticated reload, 1,713 initial DOM nodes, 14 rendered player rows, equal-height auction columns, and no horizontal overflow.
