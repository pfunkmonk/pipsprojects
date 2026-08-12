# Thunder Bowl release audit — August 11, 2026

## Outcome

This audit applies the product mission gate: every accepted change must make draft operation easier, more intuitive, more desirable, and faster than paper; protect all authority and recovery boundaries; and prevent the failure class rather than patch one player or screen.

The signed-in production application is operational and the source release candidate has completed exhaustive automated verification. No production sale was written during the audit. The source fixes described below are not called deployed until an explicit push/deploy action completes.

## Signed-in production QA

The live site was exercised in Chrome at an effective 1536×960 viewport:

| Surface | Evidence checked | Result |
| --- | --- | --- |
| Private draft room | 716-player pool, balanced viewport columns, internal scrolling, BID/HOLD/PASS HUD, current/next bid, maximum, alternatives, roster needs, auction forecast, nomination, manual/auctioneer switch | Passed |
| Player intelligence | Right-click open, evidence/news/depth/projection data, personal tags/prices/notes, tier detail, outside-click and X close | Passed |
| Keeper strategy | 0/1/2 choices, pass, searchable rights, contract years, atomic multi-player/cap trades and undo, dynamic inflation, evidence, optimizer scroll | Passed |
| Admin & data | Readiness, safety rails, morning intelligence capture, recovery controls, annual schedule, public board launch | Passed with the operator gates listed below |
| Restricted auctioneer | Separate sign-in, public-only snapshot, player lookup, legality preview, manual amount testing | Defect found and fixed in source; server backstop remained safe |
| Draft Board | Separate sign-in, 12 teams, cash, maximum bids, nomination/clock, current nominee, no private strategy data | Passed |
| 2025 replay | Isolated local-only state and practice behavior | Passed; runner-up training is intentionally suppressed |

## System defects found and fixed

### One search promise, one matcher

The UI promised typo tolerance, but command-center and auctioneer paths had diverged and a two-error query such as `Jamy Gbbs` returned no result. Player-pool, keeper-picker, and auctioneer lookup now route through the shared ranked matcher. Query tolerance scales conservatively with query/name length, preserving fast exact/prefix ranking while accepting common two-error long-name mistakes. Cross-surface tests prevent future drift.

### One sale state, three enforcement layers

The auctioneer correctly labeled an impossible sale illegal and the server would reject it, but the final client button remained enabled. Preview text, action label, and disabled state now consume one pending-sale calculation. Illegal input visibly produces `Blocked · max $X`; server replay/legality validation remains the authoritative stale-client backstop. Tests cover both client prevention and server rejection.

## Professional code review

- Runtime authority remains correctly separated: append-only ledger for truth, private command center for strategy, restricted auctioneer for public writes, sanitized read-only Draft Board for the league.
- Duplicate-player, legal-roster, $1 reserve, revision/CAS, idempotency, correction-history, offline recovery, and public allowlist boundaries remain intact.
- Search work remains bounded and the existing performance gate requires selected-player/search response below 100 ms.
- No runtime `debugger`, `eval`, FIXME/HACK marker, or stray client diagnostic console path was found. The three server-side `console.error` calls are intentional fail-closed diagnostics for authenticated research, status, and news refresh failures.
- `public/thunder-bowl/app.mjs` is approximately 5,700 lines and is the principal maintainability debt. A broad pre-draft refactor would violate the mission gate by increasing regression risk without improving draft speed. Decompose it after the 2026 auction behind existing system tests, beginning with modal, runner-up, and render-section controllers.
- Dependency advisories are reviewed below; force-downgrading Netlify packages is not an acceptable release fix.

## Operator-only departure gates

1. Rotate the private-room and Draft Board codes exposed in older public Git history; verify old codes fail and new codes work.
2. Promote next week's final governed 716-player projection pack only after its audit, value scan, Monte Carlo, and rehearsal gates pass.
3. Run the all-player morning intelligence capture and seal/download the offline lockbox on the draft MacBook.
4. Download and verify a current recovery bundle on that MacBook.
5. A physical two-screen, noisy-room, and real-network-loss rehearsal remains useful but is optional and must not be confused with automated evidence.

## Deferred data decision

More historic draft seasons exist, but manager-history expansion requires confirmed identity mappings for `Big Pimpin → Fumble Brewskis → The Bungles` and `Whoopass → Three Amigos`, plus 2012/2014 completeness reconciliation. Current four-season empirically shrunk tendencies remain safer than guessed aliases. This does not block draft operation.

## Reproducible release evidence

Final command results:

- JavaScript syntax sweep: **PASS**, 138 runtime/test/script `.js` and `.mjs` files.
- Automated tests: **PASS**, 301/301.
- Production build: **PASS**, 716 players, 12 teams, private/public field isolation intact.
- Chrome/live readiness: **PASS** for the role matrix above. The isolated `qa:thunder` server also booted and served its authenticated local shell; it is an operator server by design, not a self-terminating test, and was stopped cleanly after verification.
- Pack audit: **PASS**, exact active bytes approved; 716 players, 177 keeper candidates, 12 keeper teams, all $1,212 allocated, zero blocking issues, zero warnings, and zero silent strategy-value changes.
- Valuation audit: **PASS**, zero VBD-formula mismatches. It continues to disclose 79 major projection-source disagreements, two registered legacy identity-curve repairs, and the quarantined Draft Dominator configuration mismatches; none is silently granted value authority.
- Position-run backtest: **PASS as a quarantine gate**, 563 chronological sales; 17.4% precision and 13.2% recall. The signal remains display-only with zero VBD/Max/WTP effect.
- Full-auction rehearsal: **PASS**, 168 sales; replay p95 0.4707 ms, search p95 0.0321 ms, reconnect 0.9898 ms.
- Foolproof roster rehearsal: **PASS** in 58.6 ms; legal completion remained 100% in every scenario and inflation correctly degraded the strong-roster forecast to a warning rather than inventing safety.
- Keeper/auction catastrophe rehearsal: **PASS**, 24 keepers, 144 sales; replay p95 0.5314 ms, reconnect 1.2064 ms, recovery 27.6078 ms.
- Dependency audit: **REVIEWED**, three high-severity entries from `image-size` through Netlify development dependencies. Thunder Bowl exposes no application route that decodes ICNS/JXL/HEIF input. The offered fix is a breaking `@netlify/blobs` downgrade, so `npm audit fix --force` was correctly rejected; monitor for an upstream patched release.
- Git whitespace/diff check: **PASS**. Line-ending notices reflect the repository's Windows checkout policy, not whitespace errors.
