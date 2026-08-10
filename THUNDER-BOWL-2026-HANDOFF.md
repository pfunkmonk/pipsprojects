# Thunder Bowl 2026 handoff

Updated August 10, 2026. This is the takeover starting point for another developer or Codex task.

## Current outcome

- Production: `https://pipsprojects.com/thunder-bowl/`
- Branch: `main`
- Hosting: Netlify; source remote is `origin`
- Active pack: `tb26-tb-accuracy-consensus-20260809-v1-2026080922-weekly-assets-20260810033019-priority-v1-assets-v1`
- Current authority: practice pack; 716 players; 12 teams
- Keeper selection and rights trading begin August 15. Auction is August 29, 2026.
- Technical readiness rehearsal: passed and pack-pinned (24 keepers, 144 auction sales, 16/16 catastrophe gates).
- Release-candidate verification: 286/286 automated tests, 716-player build validation, 168-sale full-auction rehearsal, 24-keeper/144-sale catastrophe rehearsal, 0 VBD formula mismatches, and both known legacy identity-curve anomalies repaired without changing room dollars.
- The command center now has one collapsed Live Bid HUD: BID/HOLD/PASS, Win chance, next/current bid, hard maximum, comparable supply, cash leverage, budget runway, best alternative, market inflation, and position-run status. Full evidence is one `?` hotkey away; dated evidence is collapsed by default.
- The nomination assistant ranks DRAIN RIVAL, FLOAT CHALK, and SECURE TARGET presentation plays over the existing WTP model. Surplus heat, season asset lines, per-card intel age, Pro mode, and keyboard-first B/Enter/N/Space/? controls are live. None creates a second value engine or ledger.
- Active practice auctions now remain unambiguous while Pip browses alternatives: a prominent BROWSING ONLY warning names the actual nominee, bid, and leader; the decision strip suppresses BID/HOLD/PASS until Return to live player is pressed.
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
5. Prediction-sandbox keeper actions are local and private. Only explicit Official ledger actions may sync to the shared board.

## Code map

- Private UI and orchestration: `public/thunder-bowl/index.html`, `app.mjs`, `app.css`
- Rules, replay, public sanitization: `public/thunder-bowl/state-engine.mjs`
- Keeper calculations: `keeper-board.mjs`, `keeper-scenario.mjs`
- VBD and live market: `thunder-value.mjs`, `auction-demand.mjs`
- Auction advisory and simulation: `auction-intelligence.mjs`, `auction-telemetry.mjs`
- Glance-decision and draft-pressure presentation: `decision-context.mjs`, `nomination-assistant.mjs`, `position-run.mjs`
- Projection governance: `projection-lab.mjs`, `scripts/projection-refresh-core.mjs`
- Weekly-asset governance: `scripts/weekly-assets-core.mjs`, `scripts/import-weekly-assets.mjs`; raw component files remain outside the web tree
- Annual divisions/schedule: `league-setup.mjs`; bounded live schedule weighting: `priority-weights.mjs`
- Auctioneer: `public/thunder-bowl/auctioneer/`
- Public board and login gate: `public/thunder-bowl/board/`, `board.html`, `draft-board/`
- Shared public-only services: `public/thunder-bowl/shared/`
- Cloud functions and ledger service: `netlify/functions/`
- Exact-byte final-pack promotion overlay: `netlify/functions/_lib/pack-release-store.mjs`, `thunder-pack-promote.mjs`
- Automated QA/rehearsals: `tests/`, `scripts/run-full-auction-rehearsal.mjs`, `scripts/run-keeper-auction-catastrophe-rehearsal.mjs`
- User operations guide: `public/thunder-bowl/guides/index.html`
- Draft-pressure decision helpers: `decision-context.mjs`; rendering and interaction wiring are in `app.mjs`

## Projection and VBD state

- Thunder Bowl Consensus drives projected points: FBG 33.7%, FantasyPros 33.3%, CBS 33.0% when all three are present. Missing sources renormalize; they are never zero-filled.
- The production blend beat the single-source reference in strict time-forward tests. The source tilt is deliberately small because the clean paired historical difference was not statistically decisive.
- The value chain is consensus projection → league scoring → replacement-level VBD → intrinsic dollars → historical roster-depth/position market → live room scarcity and cash → Max bid.
- Unvalidated season-total weather, travel, venue, rest, durability, mean-reversion, and schedule corrections remain at zero. The failed 31,486 player-week raw-context challengers remain rejected.
- The live weekly-importance policy is 1.20 division / 1.50 playoffs / zero Week 18. It was calibrated from 48 archived team-seasons and 150,000 Thunder Bowl simulations, then shrunk to 35% timing authority and capped at ±3 replacement-relative VBD because archived weekly forecast timing remains noisy. One adjusted runtime pack drives displayed VBD, Market, Max, keeper surplus, and bid guidance.
- The August 9 weekly-asset bundle passes a private fail-closed intake: 716 players, 12,888 week rows, complete bye coverage, maximum component reconciliation delta 0.0008, and zero changes to signed season projections. It expands weekly timing coverage from 447 to 716. Honest nonzero component coverage is 623/716; all 93 component-empty players are $1 players and retain their approved consensus total plus a source/team weekly shape.

## Final projection refresh

The separate projection application must fill the exact 716-row template in `artifacts/thunder-bowl/projection-handoff-2026/`. Then run:

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

The raw CSVs must never enter `public/`. Staging the governed candidate remains a separate explicit `--promote` action. After the final candidate is active, Pip uses the one-click **Promote & lock this final pack** control; the server reruns the release gate, pins the exact active bytes in strong-consistency storage, and only then serves that exact pack with production status.

## Position-run authority

The detector now follows the review spec's minimum evidence rule: a six-sale decaying window, at least four confirmed sales, at least two same-position observations, separate frequency and overpay signals, and hard +$3/+3 VBD proposal caps. A repeatable 563-sale chronological backtest across 2012, 2014, 2015, 2017, 2018, and 2023 found only 17.4% precision and 13.2% recall for short-horizon continuation. The supplied 2025 files do not contain a complete ordered auction, so the 2025 replay can verify UI/ledger/privacy behavior but cannot honestly tune a time-series detector. Consequently the HUD may show HOT/WARM/WATCH, but the signal has zero direct VBD, Max, or rival-WTP authority. See `reports/thunder-bowl/position-run-backtest.{json,md}`.

## Required verification

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run audit:thunder-values
npm.cmd run backtest:thunder-runs
npm.cmd run rehearsal
npm.cmd run rehearsal:catastrophe
npm.cmd audit
git diff --check
```

Use signed-in Chrome for production QA at a 1536×960 CSS viewport (the 3072×1920 MacBook display at 2× scaling). Verify private, auctioneer, and Draft Board sign-ins; player search/right-click intelligence; keeper/undo; atomic trade/undo; manual-backup visibility; illegal-bid rejection; public-field isolation; status stability; and clean console diagnostics. Do not leave test sales in the live ledger.

## Draft-morning sequence

1. Promote the final governed season projection pack, then refresh/validate/promote its private weekly-asset layer.
2. Sign in online on the MacBook so the offline verifier is current.
3. Open the auctioneer and Draft Board once.
4. Capture all player intelligence in Admin & data.
5. Download the recovery bundle and any requested private-board JSON.
6. Run the departure check and clear every blocker.
7. Leave Auctioneer feed selected. If the auctioneer loses cloud access, switch Pip's already-unlocked command center to Manual backup; switch back only after all three screens agree.

## Known dependency advisory

`npm audit` currently reports three high-severity package entries from two `image-size@2.0.2` denial-of-service advisories inherited through `@netlify/blobs` → `@netlify/dev-utils`. The vulnerable ICNS/JXL/HEIF parser is not reachable through Thunder Bowl routes. The offered forced fix is a breaking Netlify Blobs downgrade; do not apply it. Recheck before each deployment and upgrade when Netlify publishes a patched dependency path.
