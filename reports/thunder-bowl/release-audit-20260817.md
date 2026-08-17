# Thunder Bowl release audit — August 17, 2026

## Scope

Release wrap for the refreshed 716-player practice pack
`tb26-tb-cbs-fbg-refresh-20260812-20260812225551-m-weekly-assets-20260816234243-priority-v1-assets-v1`.
The product mission gate remained controlling: faster than paper under auction pressure, no shadow value engine, and system-boundary fixes instead of player-specific patches.

## Findings and system fixes

1. **Weekly-asset manifest coverage compared JSON serialization rather than meaning.** The refreshed source set added `PFF` and `BLEND`, while older manifests could omit zero-count keys. Exact serialization made a valid pack fail depending on object key presence/order. Coverage validation now compares the supported semantic key set, accepts only omitted zero counts, and rejects unsupported keys, non-integer/negative counts, and real count drift. A regression test covers both backward compatibility and fail-closed drift.
2. **The projection challenger command was not runnable from the documented no-argument release gate.** Required paths were command-line-only, the current unified model no longer carried derived lag columns, and the default Windows Python lacked the optional scientific packages. The challenger now has governed default paths with an environment override, reconstructs lag evidence with explicit prior-season shifts, fails with named schema/input errors, and runs through a dependency-aware wrapper. `requirements-backtests.txt` documents the portable fallback install. This remains challenger-only and cannot promote a live projection.
3. **The field guide did not explain the new deterministic CBS handoff.** It now names the exact Admin action, six-column contract, keeper/void exclusion, validation behavior, and the separate audit export.
4. **The fixed Manual backup sale bar could cover the lowest decision signals at the 1536×960 stress viewport.** The desktop HUD now uses a governed six-column grid: roster safety and the market/run strip share a compact bounded row, the six bid facts balance across two rows, and the sale-entry status is compacted without shrinking its controls. Browser geometry now proves every bid-critical value ends above the fixed sale bar with no horizontal overflow.
5. **The player-intelligence dismiss layer depended on a narrow event target.** Dismissal now belongs to the dialog boundary and closes from the explicit full-screen layer, its gutter hitbox, or any pointer coordinates outside the intelligence card. Inside-card interaction remains unaffected.

## Browser and boundary QA

- Live public hub, Draft Day setup, Draft Day auctioneer login, Draft Day board login, and Thunder Bowl private login were inspected in Chrome at the MacBook-equivalent desktop size. A local 1536×960 authenticated stress pass exposed and then cleared the fixed-bar overlap described above; the final geometry has no horizontal overflow and every bid-critical HUD value ends above the sale bar.
- Unauthenticated live requests to the private pack, private status, auctioneer snapshot, and Draft Day auctioneer snapshot all returned `401`.
- Live static responses carried the strict content-security policy, `nosniff`, no-referrer policy, and zero-age revalidation.
- The public project card exposes separate Pip, Auctioneer, Draft Board, Draft Day setup, Draft Day auctioneer, and Draft Day board entrances.
- The isolated authenticated command center loaded all 716 players and 12 teams with no page overflow or console diagnostics. Typo search `Jamyhr Gibs` returned Jahmyr Gibbs first; the BID/HOLD/PASS HUD remained above the fold.
- The player-intelligence window opened from a player right-click and closed from the outside gutter without requiring the X button. Keeper Strategy, the CBS Auction Import CSV action, and the protected Clear all player placements control were present in the authenticated local workflow.
- In isolated Manual backup, selling Jahmyr Gibbs to Dogs of War for `$34` changed Dogs cash from `$104` to `$70`, recorded the exact last sale, removed the player from availability, and enabled append-only correction. The private runner-up prompt excluded Dogs of War, and the Admin correction saved Big Head without altering the public ledger.
- No production keeper, trade, nomination, sale, runner-up, or correction was written during this audit.
- The newly opened live private-command-center tab did not inherit an authenticated Thunder Bowl session, so no signed-in production mutation test was attempted. The isolated workflow plus authenticated HTTP/unit contracts supply the destructive-path evidence; a final operator sign-in and read-only smoke check remains part of the departure gate.

## Automated and professional-development gates

- `npm.cmd test`: **372/372 pass** after rebasing the concurrent Draft Day lifecycle release.
- `npm.cmd run build`: **716 public player identities, 12 teams, private/public isolation pass**.
- Candidate audit: approved; 716 players; 177 keeper candidates; 12 manager profiles; `$1,212` market allocation reconciled.
- Valuation audit: zero VBD-formula mismatches and zero legacy-curve repairs. Draft Dominator configuration differences remain quarantined comparison evidence with no model authority.
- Full auction rehearsal: **168 sales**, replay p95 below 1 ms.
- Keeper/catastrophe rehearsal: **24 keepers + 144 sales**, all recovery gates pass.
- Foolproof roster rehearsal: legal completion 100% in every published scenario; inflation stress correctly degrades strong-roster confidence without improving any value.
- Auction-advice Monte Carlo: **36 players × 608 stochastic paths/rollouts**, p95 below 100 ms.
- Historical market, league price curve, position-run, priority-week, and projection challenger backtests all completed. The weak position-run signal remains display-only; the projection challenger remains ineligible for live promotion.
- Syntax check: every tracked JavaScript/MJS file parsed successfully.
- Production dependency audit: zero known vulnerabilities.
- Static hygiene scan found no runtime debugger/eval/dynamic-function injection or stray application console diagnostics. The large command-center orchestrator was deliberately not broadly refactored this close to the auction; the mission gate favors measured post-season modularization over release-risk churn.

## Remaining operator-only departure gates

1. Rotate the historically exposed private-room and Draft Board access codes in Netlify and verify old-code rejection.
2. Promote and lock only the final governed projection pack when it arrives.
3. Sign in on the MacBook, capture/seal all player intelligence, and download the recovery bundle.
4. Complete the short physical two-screen/Wi-Fi rehearsal if time permits. Automation must not falsely certify those human actions.
