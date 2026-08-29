# Thunder Bowl 2026 handoff

Updated August 29, 2026. This is the takeover starting point for another developer or Codex task.

## Current outcome

- Production: `https://pipsprojects.com/thunder-bowl/`
- Branch: `main`
- Hosting: Netlify; source remote is `origin`
- Active repository pack: `tb26-tb-weekly-source-consensus-20260829-v1-20260829124635`
- Current authority: production-locked final pack; 716 players; 12 teams. The server-pinned SHA-256 is `96e5eaf3fdd1e0f17381eddbff182aaa3c1ea3d4ff8deffa4bbf421d42a437f8`.
- Keeper selection and rights trading begin August 15. Auction is August 29, 2026.
- Technical readiness rehearsal: passed and pack-pinned (24 keepers, 144 auction sales, 16/16 catastrophe gates).
- Final-pack verification: 436/436 automated tests, 716-player/12-team production build, exact-byte pack audit, 168-sale full auction, 36-player/608-rollout-per-player advice Monte Carlo, foolproof roster simulation, and 24-keeper/144-sale catastrophe/recovery rehearsal all pass against the August 29 pack. The complete August 11 signed-in production role audit is recorded in `reports/thunder-bowl/release-audit-20260811.md`; the refreshed-pack code/browser/dependency wrap is in `reports/thunder-bowl/release-audit-20260817.md`; current price/advice evidence is in `reports/thunder-bowl/auction-price-curve-backtest.json` and `auction-advice-monte-carlo.json`.
- **Live 2026 keeper authority is final.** The canonical 24-active-keeper cloud set (two per team) was sealed on August 28, 2026 at 5:08 PM MT. Production verification shows exactly one `KEEPERS_FINALIZED` event, the read-only board reports the final lock without exposing its private reason, and a live auctioneer edit probe is rejected with HTTP 403 / `KEEPERS_FINALIZED` without changing assignments or revision. Fresh private devices are forced to the official cloud workspace; only the authenticated organizer can deliberately enable session-scoped corrections.
- The August 29 projection refresh is the final production-locked 2026 pack. It league-scores and blends the newest Footballguys, CBS, FantasyPros, and PFF weekly assets at the week level, renormalizes only across sources actually available for that player-week, and never converts a missing row to zero. Fresh source evidence covers 636/716 players; the remaining 80 deep players retain the prior validated projection and weekly shape. All 716 season/weekly totals reconcile, 503 projections changed, VBD/intrinsic/Market/Max/keeper surplus were recomputed by Thunder Bowl, and the $1,212 allocation reconciles exactly. The source audit and hashes are pinned in `reports/thunder-bowl/latest-source-weekly-assets-audit.{json,md}`.
- The command center now has one collapsed Live Bid HUD: BID/HOLD/PASS, Win chance, next/current bid, hard maximum, comparable supply, cash leverage, budget runway, best alternative, market inflation, and position-run status. Full evidence is one `?` hotkey away; dated evidence is collapsed by default. On the three-column draft desk, player pool, HUD/evidence, and roster/forecast columns share the remaining viewport height; secondary lists scroll inside their own panel, Next nomination stays above the rival forecast list, and the static Safety rails reference lives in Admin & data instead of consuming draft-room height.
- The nomination assistant ranks DRAIN RIVAL, FLOAT CHALK, and SECURE TARGET presentation plays over the existing WTP model. Surplus heat, season asset lines, per-card intel age, Pro mode, and keyboard-first B/Enter/N/Space/? controls are live. None creates a second value engine or ledger.
- A red-and-white `!` appears beside a player in the pool and selected-player heading whenever the validated saved Footballguys, RotoWire, or CBS archive contains news for that player. It updates with any feed, points to the full player record, and has no projection, VBD, price, or ledger authority. Footballguys Latest News and its Footballguys View analysis share the protected 30-minute research refresh with FBG depth charts and CBS news, accumulate into the offline 45-day lockbox, and fail closed on page-contract drift.
- Active practice auctions now remain unambiguous while Pip browses alternatives: a prominent BROWSING ONLY warning names the actual nominee, bid, and leader; the decision strip suppresses BID/HOLD/PASS until Return to live player is pressed.
- Player lookup now uses one shared typo-tolerant ranker in the private pool, keeper picker, and restricted auctioneer console. The release gate includes transposed and two-error names so those surfaces cannot silently drift apart again.
- The auctioneer's legality preview, final button, and server command now fail closed from the same pending-sale calculation. An illegal amount visibly changes the action to `Blocked · max $X`, disables it, and remains rejected server-side if a stale client attempts the command.
- Runner-up capture is private and production-only: after a real confirmed sale, Pip gets one 30-second team choice (or `Not sure`), with the winner excluded and later correction available in Admin & data. Replay and auto-auction practice intentionally suppress the prompt so simulated evidence cannot train the live WTP model.
- Admin & data now exposes the protected operation by its actual purpose: **Clear all player placements**. It shows the current keeper/drafted-player count, requires `CLEAR ALL PLACEMENTS`, downloads a private recovery bundle, archives the full ledger, clears keepers/drafted players/cap trades/passes/nominations, and advances the generation so stale tabs cannot restore the prior board. Projection packs, news, and private player decisions remain intact. The server temporarily accepts the former confirmation phrase so an already-cached client can still complete a safe archive after deployment.
- Admin & data now has a separate **CBS Auction Import CSV** for downstream CBS browser automation. It emits active `PLAYER_SOLD` events only, in chronological order, with the immutable six-column contract `player_name,nfl_team,position,fantasy_team,auction_price,player_id`. Keepers, trades, passes, nominations, voided sales, metadata, totals, and private strategy are excluded. Export fails closed on an empty sale ledger, missing/extra fields, invalid position/team/price values, duplicate internal player IDs, unknown fantasy teams, or any name/position/NFL-team mismatch against the active draft pack. The older full draft-history CSV remains a separate audit/modeling artifact.
- Admin & data also generates two offline-safe **Top-200 emergency auction sheets** as real eight-page landscape, fillable PDFs: value order and the identical pool alphabetized by player name. Each has 400 AcroForm text fields for winning team and actual price and still prints cleanly. Rank, VBD, and pre-auction dollars are always recomputed from a clean configured room using the current pack and approved schedule policy, so rehearsals or live sales cannot corrupt the paper baseline. Current keepers/sales may prefill only the editable `Drafted by` and `Actual $` fields. The module is cached for offline use and has no ledger or model-write authority.
- Every Draft Board team header now opens that team's read-only public salary ledger: $100 opening cap, bracket bonus or other pre-auction adjustment, cap/rights trades, keepers, auction purchases, and an authoritative running balance. The server derives it from active append-only events, omits voided transactions, fails closed if it does not reconcile to team cash, and exposes only a nested public allowlist. The bounded modal updates with the board, scrolls internally, traps/returns focus, and closes by outside click, ×, or Escape.
- Keeper prediction work can now be published without re-entry. **Review & sync sandbox** compares event IDs against the official ledger, ignores server receipt metadata, rejects collisions and non-keeper event types, validates the complete candidate ledger through the state engine, previews every active keeper/trade/pass/correction, and appends only missing events. The sandbox remains locally intact. If the tab belongs to an archived generation, the Keeper page exposes **Load current cloud ledger**; that operation downloads the prior official ledger and never changes `keeperPredictionSandboxEvents`.
- The completed 2026 keeper set now has an append-only cloud finalization event. Once finalized, every private device defaults to the official ledger, ordinary controls are read-only, the auctioneer can view keeper assignments but cannot edit/undo/restore/reconcile them, and both the auctioneer command service and storage boundary enforce that restriction. Only the authenticated private organizer can deliberately enable session-scoped correction mode; every correction remains in history, and draft-morning readiness fails closed if the final set is no longer canonical.
- Release is intentionally not final until the exposed private-room and Draft Board access codes are rotated, the final projection export is audited/promoted, fresh all-player intelligence is captured, and a recovery bundle is downloaded on the MacBook.

Never commit live access codes, display tokens, session secrets, cookies, or signed board URLs. `.env.example` contains placeholders only.

Security blocker: the public repository's older history contains the current private-room code and Draft Board code. Current source files no longer contain either value, and the build now compares configured runtime secrets against public/function source without embedding those secrets. Rotate both Netlify environment values, then verify the old values are rejected and the new values work. History rewriting is optional after rotation because the exposed values must be treated as permanently compromised.

## Product mission gate

Every change must be easier, more intuitive, more desirable, and faster than paper or competing services under a loud in-person auction. Fix the failure class, not one symptom. Authority-bearing model changes remain quarantined until time-forward QA earns promotion.

## Authoritative boundaries

1. The append-only event ledger is the only truth for caps, keeper-rights trades, keeper choices/passes, sales, corrections, nominations, and rosters.
2. The private command center owns VBD, projections, targets, notes, personal prices, opponent profiles, and advisory forecasts.
3. The auctioneer receives public roster/player data only and writes through revision-checked, idempotent commands.
4. The Draft Board is read-only and receives a sanitized public snapshot. It never receives private strategy fields.
5. Prediction-sandbox keeper actions are local and private until the owner explicitly reviews and syncs the complete validated setup sequence. No sandbox event reaches the shared board implicitly.

## Code map

- Private UI and orchestration: `public/thunder-bowl/index.html`, `app.mjs`, `app.css`
- Rules, replay, public sanitization: `public/thunder-bowl/state-engine.mjs`
- Keeper calculations: `keeper-board.mjs`, `keeper-scenario.mjs`; reviewed sandbox publication: `keeper-sandbox-promotion.mjs`
- VBD and live market: `thunder-value.mjs`, `auction-demand.mjs`, generated `auction-price-profile.mjs`
- Auction advisory and simulation: `auction-intelligence.mjs`, `auction-telemetry.mjs`, `roster-safety.mjs`
- Historical manager-profile rebuild: `scripts/build-manager-history.py`; governed normalized rows and audit live in `reports/thunder-bowl/manager-auction-history-normalized.csv` and `manager-history-audit.{json,md}`
- Historical league price-curve rebuild/backtest: `scripts/build-auction-price-curve.mjs`; governed report is `reports/thunder-bowl/auction-price-curve-backtest.json`
- Glance-decision and draft-pressure presentation: `decision-context.mjs`, `nomination-assistant.mjs`, `position-run.mjs`
- Projection governance: `projection-lab.mjs`, `scripts/projection-refresh-core.mjs`
- Weekly-asset governance: `scripts/weekly-assets-core.mjs`, `scripts/import-weekly-assets.mjs`; the current four-source path is `scripts/source-weekly-assets-core.mjs`, `scripts/import-source-weekly-assets.mjs`; raw component files remain outside the web tree
- Annual divisions/schedule: `league-setup.mjs`; bounded live schedule weighting: `priority-weights.mjs`
- Auctioneer: `public/thunder-bowl/auctioneer/`
- Public board and login gate: `public/thunder-bowl/board/`, `board.html`, `draft-board/`
- Shared public-only services: `public/thunder-bowl/shared/`
- Cloud functions and ledger service: `netlify/functions/`
- Exact-byte final-pack promotion overlay: `netlify/functions/_lib/pack-release-store.mjs`, `thunder-pack-promote.mjs`
- Automated QA/rehearsals: `tests/`, `scripts/run-full-auction-rehearsal.mjs`, `scripts/run-keeper-auction-catastrophe-rehearsal.mjs`
- User operations guide: `public/thunder-bowl/guides/index.html`
- Dated release audit: `reports/thunder-bowl/release-audit-20260811.md`
- Refreshed-pack release audit: `reports/thunder-bowl/release-audit-20260817.md`
- Draft-pressure decision helpers: `decision-context.mjs`; rendering and interaction wiring are in `app.mjs`
- Printable/fillable emergency sheets: `emergency-auction-pdf.mjs`; deterministic builder: `scripts/build-emergency-auction-pdf.mjs`; canonical field/widget/save validator: `scripts/validate-emergency-auction-pdf.py`

## Projection and VBD state

- Thunder Bowl Consensus drives projected points. FBG and CBS retain the small measured inverse-MAE tilt from their paired historical audit; FantasyPros and PFF receive the neutral midpoint prior until comparable archives exist. With all four present the weights are approximately FBG 25.3%, FantasyPros 25.0%, PFF 25.0%, and CBS 24.7%. Missing player-weeks renormalize; they are never zero-filled.
- The production blend beat the single-source reference in strict time-forward tests. The source tilt is deliberately small because the clean paired historical difference was not statistically decisive.
- The value chain is consensus projection → league scoring → replacement-level VBD → intrinsic dollars → historical roster-depth/position market → live room scarcity and cash → Max bid.
- Unvalidated season-total weather, travel, venue, rest, durability, mean-reversion, and schedule corrections remain at zero. The failed 31,486 player-week raw-context challengers remain rejected.
- The live weekly-importance policy is 1.20 division / 1.50 playoffs / zero Week 18. It was calibrated from 48 archived team-seasons and 150,000 Thunder Bowl simulations, then shrunk to 35% timing authority and capped at ±3 replacement-relative VBD because archived weekly forecast timing remains noisy. One adjusted runtime pack drives displayed VBD, Market, Max, keeper surplus, and bid guidance.
- The August 21 four-source bundle passes a private fail-closed intake: exact schemas and source identities, one row per source/player/week, explicit CBS native/bye/missing status, scoring through Thunder Bowl rules, duplicate-player protection, 716 reconciled season totals, and no direct value fields. Systemic source-collapse detection rejects repeated implausible near-zero outputs; the audit separately lists large source spreads as role uncertainty rather than silently averaging them away.

## Historical league auction-price curve and glance advice

The live Market now adds a Thunder Bowl league price-rank curve built from the same 1,252 validated purchases across ten usable seasons. Rolling time-forward stability selected an eight-season recency half-life. A separate five-season preseason-price-to-actual-sale audit matched 106 players and selected a conservative 60% historical-curve share: overall MAE fell from `$3.690` to `$2.822`, while premium-player MAE fell from `$5.114` to `$3.941`. A paired modern holdout independently favored still more history, so 60% is the safer promoted authority. The curve dynamically reranks only the remaining players in each position and scales with live position dollars and VORP. It changes Market—not projections, VBD, legal maximum, personal maximum, or the append-only ledger.

The Live Bid HUD places one compact value verdict beside BID/HOLD/PASS: `BARGAIN`, `FAIR`, `WAIT`, or `TIER SAVE`. `TIER SAVE` requires the last remaining player in a tier, a hard stop that still covers Market, at least 95% simulated legal-roster completion, and at least 60% simulated strong-roster completion. `AVOID`, `OWNED`, and `BROWSE` are fail-closed guardrails. The classifier never changes the primary action or hard stop. Rebuild with `npm.cmd run backtest:thunder-price-curve`; run the 36-player, 608-rollout-per-player contract check with `npm.cmd run rehearsal:thunder-advice`.

## Final projection refresh

The separate projection application must fill the exact 716-row template in `artifacts/thunder-bowl/projection-handoff-2026/`. Raw projection files are not an Admin-page import: the browser accepts only a fully validated pack. Run:

```powershell
npm.cmd run refresh:thunder-projections -- completed-handoff.csv candidate-pack.json
npm.cmd run audit:thunder-pack -- candidate-pack.json public/thunder-bowl/current-draft-pack.json
npm.cmd run stage:thunder-pack -- candidate-pack.json
```

Review every blocking issue and outlier. Promotion requires an explicit, separately reviewed `--promote` run followed by the complete test, build, valuation, Monte Carlo, catastrophe, Chrome, and readiness checks. Never edit the active pack by hand.

After a final season projection pack is promoted, rebuild and attach the private weekly assets:

```powershell
npm.cmd run import:thunder-weekly-assets -- "C:\Users\mailp\Dropbox\Personal\FAMILY STUFF\Mike Stuff\Fantasy Football\_weekly_assets\output" "tmp\draft-pack-2026-weekly-assets.json"
npm.cmd run stage:thunder-pack -- "tmp\draft-pack-2026-weekly-assets.json" --promote
```

For the current per-source weekly files, use the newer single governed path instead:

```powershell
npm.cmd run import:thunder-source-assets -- "C:\Users\mailp\Dropbox\Personal\FAMILY STUFF\Mike Stuff\Fantasy Football\_weekly_assets\by_source" "reports\thunder-bowl\candidate-source-assets-20260821.json"
npm.cmd run stage:thunder-pack -- "reports\thunder-bowl\candidate-source-assets-20260821.json" --promote
```

This path applies league scoring to raw assets, blends source weeks with availability-aware weights, recomputes all classic values, and emits a full audit before promotion. The upstream builders also fail closed if Footballguys kicker conversion rates or DST sack coverage indicate a column/duplicate-row parsing regression.

The raw CSVs must never enter `public/`. Staging the governed candidate remains a separate explicit `--promote` action. After the final candidate is active, Pip uses the one-click **Promote & lock this final pack** control; the server reruns the release gate, pins the exact active bytes in strong-consistency storage, and only then serves that exact pack with production status.

## Position-run authority

The detector now follows the review spec's minimum evidence rule: a six-sale decaying window, at least four confirmed sales, at least two same-position observations, separate frequency and overpay signals, and hard +$3/+3 VBD proposal caps. A repeatable 563-sale chronological backtest across 2012, 2014, 2015, 2017, 2018, and 2023 found only 17.4% precision and 13.2% recall for short-horizon continuation. The supplied 2025 files do not contain a complete ordered auction, so the 2025 replay can verify UI/ledger/privacy behavior but cannot honestly tune a time-series detector. Consequently the HUD may show HOT/WARM/WATCH, but the signal has zero direct VBD, Max, or rival-WTP authority. See `reports/thunder-bowl/position-run-backtest.{json,md}`.

## Historical manager profiles

The live 2026 rival profiles now use 1,252 validated winning auction purchases across ten seasons: 2012, 2015, 2017, 2018, 2019, and 2021-2025. `Big Pimpin → Fumble Brewskis/Fumble-Brewskis → The Bungles` and `Whoopass/The Whoopass → Three Amigos` are explicit, audited identity-continuity rules. Keeper rows, post-draft moves, incomplete seasons, the unrelated eight-team 2014 export, and one impossible 2018 `$0` row are excluded. The leakage-safe 2025 replay uses the same pipeline only through 2024 (nine seasons).

Rolling-origin tests across the usable seasons selected effectively equal historical weighting and a 0.15 profile reliability. The former 0.50 signal worsened next-season position-share error; 0.15 slightly beat the league-only baseline. Runtime empirical-Bayes shrinkage and the 0.65 ceiling remain intact, and profiles remain advisory only: they affect rival WTP/practice behavior, never intrinsic VBD, Market, Max, or the ledger. Rebuild with `npm.cmd run refresh:thunder-managers`; then pass the generated 2026 candidate through the normal `stage:thunder-pack` audit/promotion path. See `reports/thunder-bowl/manager-history-audit.md`.

## Required verification

## Final four-source projection lock — August 29, 2026

- The newest four dated files in the private Dropbox `by_source` folder were rebuilt together and imported through the governed source-assets boundary. The resulting pack is `tb26-tb-weekly-source-consensus-20260829-v1-20260829124635`; no raw source CSV is copied into the repository or public web tree.
- The refresh exposed a systemic upstream defect: season-curve assets could remain on an authoritative bye week and were then silently discarded during intake, understating the affected season total. The upstream builder now removes and renormalizes bye leakage before export, emits explicit `bye` rows for every source, suppresses contradictory CBS native bye data, canonicalizes established player aliases, and reports source-only identities. The application importer now requires `is_bye` and `data_status=bye` to agree for every source, with a permanent regression test.
- Source evidence is clean for 636/716 players, all four source bundles pass their minimum coverage gates, no missing source row was converted to zero, no repeated-collapse signal fired, every weekly profile reconciles, and the governed market allocation remains exactly `$1,212`. Nine greater-than-75-point source spreads remain visible as uncertainty; they are not hidden corrections.
- One newly signed source-only player, Jonnu Smith (`TE-GB`), is reported but not forced into the stable 716-player identity spine during the final pack refresh. Alias changes for Ken/Kenneth Walker III, Kenny/Kenneth Gainwell, and Chig/Chigoziem Okonkwo are canonicalized without creating duplicate players.
- Final QA passed 436/436 tests, the production build, valuation/formula audit, historical market and price-curve backtests, priority-week calibration, position-run backtest, projection challenger, 36-player/608-path advice Monte Carlo, 168-sale full auction, foolproof roster simulation, and 24-keeper/144-sale catastrophe/recovery rehearsal. The pack-pinned catastrophe certificate was deliberately regenerated after promotion; the first full-suite pass correctly rejected the stale August 21 certificate.
- Commit `3de32f5` deployed the exact repository pack. The protected production promotion then pinned pack ID `tb26-tb-weekly-source-consensus-20260829-v1-20260829124635` and SHA-256 `96e5eaf3fdd1e0f17381eddbff182aaa3c1ea3d4ff8deffa4bbf421d42a437f8`; a fresh authenticated read returned `status: production`, 716 players, and the same pack ID. The official ledger remained generation 3 with one `KEEPERS_FINALIZED` event. Remaining owner/device actions are fresh all-player intelligence capture and the MacBook recovery download.

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run audit:thunder-values
npm.cmd run backtest:thunder-price-curve
npm.cmd run backtest:thunder-runs
npm.cmd run backtest:thunder-priority
npm.cmd run backtest:thunder-projections
npm.cmd run rehearsal:thunder-advice
npm.cmd run rehearsal
npm.cmd run rehearsal:catastrophe
npm.cmd run rehearsal:foolproof
npm.cmd audit
git diff --check
```

## Startup-performance checkpoint — August 23, 2026

- The private command center now authenticates while reading its cached pack, critical metadata, and append-only event ledger in parallel. A valid cached 716-player pack becomes usable immediately; large value-neutral status/news/research archives hydrate just after first paint, and the same authenticated endpoint performs its ETag refresh in the background.
- `renderAll()` still recomputes the complete authoritative auction state, but only the visible Draft room, Keeper strategy, or Admin & data surface is rendered. Opening a tab builds it from the current state, so no hidden view can become stale.
- The player pool retains all 716 IDs for search, keyboard order, tiers, and calculations while rendering only the visible window plus overscan. The fixed-height spacer system preserves native scrolling and bounds the initial pool DOM to roughly 13–20 player rows.
- Isolated browser QA reduced the initial command-center DOM from 11,256 to 1,713 nodes and 727 to 14 rendered player rows. A warm authenticated reload reached the visible app in 531 ms on the Windows test machine, with zero horizontal overflow and all three auction columns ending inside the viewport.
- The release gate passes 390/390 automated tests, the 168-sale full-auction rehearsal, the 24-keeper/144-sale catastrophe recovery rehearsal, and the foolproof roster Monte Carlo. The QA server is intentionally persistent and must be stopped after browser checks; it is not itself a finite test command.

The projection challenger entrypoint selects a Python runtime containing NumPy and pandas. Set `THUNDER_BOWL_PYTHON` when needed, or install the optional packages with `python -m pip install -r requirements-backtests.txt`. The command remains an audit only and cannot promote a live pack.

Use signed-in Chrome for production QA at a 1536×960 CSS viewport (the 3072×1920 MacBook display at 2× scaling). Verify private, auctioneer, and Draft Board sign-ins; player search/right-click intelligence; keeper/undo; atomic trade/undo; manual-backup visibility; illegal-bid rejection; public-field isolation; status stability; and clean console diagnostics. Do not leave test sales in the live ledger.

## Draft-morning sequence

1. Promote the final governed season projection pack, then refresh/validate/promote its private weekly-asset layer.
2. Sign in online on the MacBook so the offline verifier is current.
3. Open the auctioneer and Draft Board once.
4. Capture all player intelligence in Admin & data.
5. Download the recovery bundle and any requested private-board JSON.
6. Run the departure check and clear every blocker.
7. Leave Auctioneer feed selected. If the auctioneer loses cloud access, switch Pip's already-unlocked command center to Manual backup; switch back only after all three screens agree.

## Access-boundary security checkpoint — August 26, 2026

- The private Command Center, Auctioneer console, and Draft Board use three cryptographically signed role-specific cookies. All are `HttpOnly`, `Secure` in production, `SameSite=Strict`, high priority, and independently validated on every request. A role token remains invalid if copied into another role's cookie name.
- The Auctioneer receives an explicit server-side operational allowlist. The Draft Board receives a smaller read-only allowlist with no available-player catalog or audit history. Neither role cookie is accepted by the private pack, ledger, news, research, status, replay, promotion, or reset endpoints.
- All three sign-in functions have Netlify per-IP/domain rate limits on both friendly API routes and direct function routes. Authentication accepts only one small JSON `code` field; Auctioneer commands are authenticated before parsing and have a 64 KB ceiling.
- JSON responses fail closed with `no-store`, `nosniff`, `default-src 'none'`, `frame-ancestors 'none'`, same-origin resource policy, and no referrer. The site adds HSTS, same-origin opener/resource policy, and no cross-domain policy files.
- `tests/thunder-security-boundary.test.mjs` is a fail-closed endpoint inventory. Adding a Thunder Bowl function requires explicit classification, and the suite proves role-token substitution cannot elevate access. The August 26 gate passed 421/421 tests, the Netlify production bundle, and `npm audit --omit=dev` with zero known vulnerabilities.
- The real 716-player pack remains function-bundled and authenticated. The public fallback is a distinct 12-player illustrative pack. The service worker never handles `/api/` requests, so private API responses cannot enter its shared shell cache.
- Residual disclosure boundary: browser-side calculation modules are static assets and their formulas can be inspected. Current projections, private evidence, manager data, targets, notes, prices, and ledger are not embedded in those modules. Moving formulas themselves behind a server API is a post-draft architectural option, not a prerequisite for protecting the live analytics data.

## Known dependency advisory

`npm audit --omit=dev` reports zero known production vulnerabilities as of August 17, 2026. Recheck before every deployment; do not force a breaking dependency downgrade solely to silence a future transitive development-only advisory.
