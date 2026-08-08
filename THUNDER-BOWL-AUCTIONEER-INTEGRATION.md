# Thunder Bowl auctioneer integration

## Outcome

The Thunder Bowl site now has three synchronized, deliberately separate surfaces:

1. `/thunder-bowl/` — Mike's private command center, including VBD, projections, targets, notes, keeper strategy, and the existing offline-first ledger.
2. `/thunder-bowl/auctioneer/` — a restricted auctioneer console for recording sales and corrections. It exposes only public auction information and uses its own access code and signed session cookie.
3. `/thunder-bowl/board` — the token-protected, read-only projector board. It shows the twelve teams, keeper/draft stickers, prices, cash, maximum legal bids, nomination order, recent sales, and the shared clock.

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
3. Enter a deliberately impossible bid and confirm that it is rejected with the player-specific maximum legal bid.
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

The integration is committed locally only. It has not been pushed or deployed. Before production release, set the auctioneer environment value, run the full test/build gates, and complete one real two-computer projector rehearsal on the venue network or a comparable hotspot.

## Open dependency advisory

As of August 8, 2026, `npm audit` reports two high-severity denial-of-service advisories in `image-size@2.0.2`, a transitive dependency of `@netlify/blobs` through `@netlify/dev-utils`. GitHub lists every published `image-size` version as affected and no patched version. Thunder Bowl does not accept or decode uploaded ICNS, JXL, or HEIF buffers, so the vulnerable parser is not reachable through an application route. Do not use `npm audit fix --force`: its current proposal is a breaking Netlify Blobs downgrade. Re-audit immediately before deployment and take Netlify's patched dependency as soon as one is available.

- https://github.com/advisories/GHSA-w3rx-r6r6-pgpr
- https://github.com/advisories/GHSA-5p2g-fcmc-qvqq
