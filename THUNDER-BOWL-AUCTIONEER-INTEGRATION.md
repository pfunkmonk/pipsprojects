# Thunder Bowl auctioneer integration

## Outcome

The Thunder Bowl site now has three synchronized, deliberately separate surfaces:

1. `/thunder-bowl/` — Mike's private command center, including VBD, projections, targets, notes, keeper strategy, and the existing offline-first ledger.
2. `/thunder-bowl/auctioneer/` — a restricted auctioneer console for recording sales and corrections. It exposes only public auction information and uses its own access code and signed session cookie.
3. `/thunder-bowl/draft-board/` — the league-facing code gate that opens `/thunder-bowl/board`, the token/session-protected, read-only projector board. It shows the twelve teams, keeper/draft stickers, prices, cash, maximum legal bids, nomination order, recent sales, and the shared clock.

All three experiences derive auction truth from the existing Thunder Bowl event ledger. The integration does not create a second sale database and does not copy private VBD or strategy fields into the auctioneer or board payloads.

## Authoritative roster rule

- A legal Week 1 roster has at least eight players: 1 QB, 2 RB, 2 WR, 1 TE, 1 K, and 1 DST.
- A team may stop as soon as that legal lineup is complete, even with unspent money.
- A team may continue through a maximum of fourteen players; the six additional players are optional.
- The legal-maximum calculation reserves $1 only for players still required to reach eight and satisfy the starter positions. It does not reserve money for optional bench slots.
- The maximum legal bid is candidate-position aware. Buying a still-needed position can release one dollar of reserve; buying another position cannot.

## Data and synchronization design

- Existing keeper, cap-transfer, auction-sale, void, and correction events remain the canonical append-only ledger.
- Auctioneer-only operating state—finished teams, staged nomination, and clock changes—is validated and stored beside the native events in the same strongly consistent Netlify Blobs document.
- Every write uses a revision check, compare-and-set commit, idempotency key, full replay, and legality validation before becoming visible.
- The command center and auctioneer poll the shared revision. The projector uses its display token and receives a strictly sanitized public snapshot.
- The nomination clock is server-anchored. Pause, resume, reset, duration changes, and post-sale restart therefore remain consistent across computers.
- The public board keeps only its last sanitized snapshot locally as a read-only outage display. It never receives the available-player pool, VBD, projections, targets, avoids, personal prices, notes, injuries, opponent profiles, or audit detail.

## Required Netlify environment variables

Set these in the production site's environment before deployment:

- `THUNDER_BOWL_ACCESS_CODE` — existing private command-center code.
- `THUNDER_BOWL_AUCTIONEER_ACCESS_CODE` — the separate six-digit auctioneer code. Keep it only in Netlify/local process environment; never commit it.
- `THUNDER_BOWL_DRAFT_BOARD_ACCESS_CODE` — the separate read-only league viewer code. Keep it only in Netlify/local process environment; never commit it.
- `THUNDER_BOWL_SESSION_SECRET` — existing signing secret of at least 32 characters.
- `THUNDER_BOWL_DISPLAY_TOKEN` — existing random projector token.

`.env.example` contains names and placeholders only.

## Local verification

From the repository root:

```powershell
npm test
npm run build
npm run rehearsal:catastrophe
npm run dev
```

Then verify:

1. Sign in to `/thunder-bowl/auctioneer/` with the separate auctioneer code.
2. Open the board from the console rather than typing or sharing a bare URL; this preserves the display token.
3. Enter a deliberately impossible bid and confirm the preview is marked illegal, the final action changes to `Blocked · max $X` and is disabled, and a stale/direct command is still rejected with the player-specific maximum legal bid.
4. Record a legal $1 test sale in an isolated rehearsal ledger and verify the player, price, cash, nominator, and clock on the second screen.
5. Exercise edit, two-step undo, restore, finish, and reopen before draft day.

## Draft-day operating model

- Use the private command center on Mike's MacBook for strategy and as the offline-capable authority.
- Give the auctioneer only the restricted console login.
- Open the tokenized board on the projector computer and leave it full-screen.
- If the auctioneer console loses cloud access, it becomes read-only and clearly disables recording. Record through the command-center laptop until synchronization returns.
- If the projector loses access, it continues showing the last sanitized board snapshot; it cannot alter the draft.
- Export a recovery file and a current intelligence backup on draft morning.

## Release status

The integration is deployed at `https://pipsprojects.com`. On August 11, 2026, signed-in production Chrome QA passed the separate private, auctioneer, and Draft Board sign-ins; 12-team/716-player restricted snapshots; token/session projector access; private-field firewall; cloud synchronization; keeper declaration/undo; atomic multi-player trade/undo; manual/auctioneer switching; internal player intelligence; and public-board rendering without adding a production sale.

That audit found two release-candidate defects in the then-live client: two-error names did not honor the UI's typo promise, and the auctioneer could preview an illegal amount while leaving the final action enabled (the server still rejected it). The source release candidate now uses one shared fuzzy ranker across all three lookup surfaces and one shared pending-sale legality calculation across preview and button state, with the server as a final backstop. These source fixes are not represented as live until separately pushed and deployed. See `reports/thunder-bowl/release-audit-20260811.md`.

The pack-pinned automatic catastrophe rehearsal satisfies the technical rehearsal gate with 24 keepers, 144 auction sales, auctioneer/manual failover, outage merge, recovery, latency, and public/private isolation. A physical two-computer speaking-speed rehearsal remains useful but optional and is never represented as automated evidence. The actual departure blockers are rotating the private-room and Draft Board codes exposed in public Git history, the final promoted projection pack, and a fresh all-player intelligence capture and recovery download on the draft laptop.

## Open dependency advisory

As of August 9, 2026, `npm audit` reports three high-severity package entries caused by two denial-of-service advisories in `image-size@2.0.2`, a transitive dependency of `@netlify/blobs` through `@netlify/dev-utils`. GitHub lists every published `image-size` version as affected and no patched version. Thunder Bowl does not accept or decode uploaded ICNS, JXL, or HEIF buffers, so the vulnerable parser is not reachable through an application route. Do not use `npm audit fix --force`: its current proposal is a breaking Netlify Blobs downgrade. Re-audit immediately before deployment and take Netlify's patched dependency as soon as one is available.

- https://github.com/advisories/GHSA-w3rx-r6r6-pgpr
- https://github.com/advisories/GHSA-5p2g-fcmc-qvqq
