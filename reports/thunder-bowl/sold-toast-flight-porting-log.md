# SOLD Toast-to-Sticker Flight — Implementation and Porting Log

## Product intent

Keep the completed sale readable long enough for every manager to register it, then visually connect the transaction to the exact roster sticker it creates. The effect is presentation-only: it never writes auction state, changes the ledger, or guesses a destination.

## Final behavior

- Hold the existing `SOLD` spotlight for **5,000 ms**.
- Render the new roster sticker immediately so board geometry and salary totals remain correct, but keep that one sticker visually hidden while the spotlight is present.
- After the hold, measure both the spotlight and the new sticker with `getBoundingClientRect()`.
- Animate a visual clone for **900 ms** using translation plus independent X/Y scale, landing on the actual assignment sticker in the winning team's column.
- Remove the clone and reveal/pulse the real sticker on landing.
- With reduced motion enabled, hold for five seconds and reveal the sticker without flying it.
- Remove the arrival pulse/outline after **2,800 ms**, including in reduced-motion mode, so a completed sale cannot remain highlighted forever.

## System rules and edge cases

- The destination is found by permanent sale assignment ID (`data-assignment-id`), never by team name, player name, column number, or roster depth.
- Normal board re-renders during the five-second hold preserve the pending assignment ID and keep the destination sticker hidden.
- A second sale arriving before the first animation finishes completes the older sale immediately and gives the newest sale the full five-second spotlight. This avoids a stale queue during a fast auction.
- A missing or invalid destination rectangle fails soft: the spotlight closes and the real sticker is revealed.
- A browser without the Web Animations API uses the same fail-soft instant landing as reduced-motion mode.
- A resize during the 900 ms flight completes the landing immediately, because continuing toward stale coordinates would be misleading.
- The spotlight remains below the measured manager-information row throughout its hold.

## What worked

- Reusing the board's existing assignment IDs provided a deterministic link from sale to roster sticker.
- Keeping the real sticker in layout at zero opacity prevented row or column jumps when it was revealed.
- A cloned spotlight allowed the authoritative DOM and live board state to remain untouched during animation.
- A pure `calculateSaleFlight()` helper made the transform math directly unit-testable and portable.

## Approaches rejected or superseded

- **Hard-coded team coordinates:** breaks across full-screen mode, smaller screens, and different roster depths.
- **Animating the real spotlight node:** risks fighting its responsive safe-zone rules and aria-live behavior.
- **Moving the actual roster sticker:** creates layout gaps and couples presentation to board state.
- **Queueing every sale for 5.9 seconds:** can leave the public board showing stale transactions when sales happen quickly.
- **Hiding with `display: none`:** removes destination geometry, so there is no reliable landing rectangle.

## Files changed

- `public/thunder-bowl/board/board.mjs` — lifecycle, hold, clone flight, landing, rapid-sale and resize recovery.
- `public/thunder-bowl/board/board-layout.mjs` — pure rectangle-to-transform calculation.
- `public/thunder-bowl/board/board-transactions.css` — pending sticker and flight-clone presentation.
- `public/thunder-bowl/board/index.html`, `public/thunder-bowl/board.html`, `public/thunder-bowl/service-worker.js` — release cache bust.
- `tests/public-board-layout.test.mjs` — timing, geometry, reduced-motion, destination, and CSS contracts.

## Copy-ready porting checklist

1. Give every rendered roster sticker the permanent sale/assignment ID.
2. Detect only genuinely new sales; do not replay the effect for historical sales on page load.
3. Before rendering the new board revision, record the new assignment ID as pending.
4. Render its destination sticker at full size with opacity zero and `aria-hidden="true"`.
5. Show the sale spotlight for 5,000 ms.
6. Measure the visible spotlight and pending sticker only after the board has rendered.
7. Clone the spotlight, strip duplicate element IDs, make the clone fixed-position and non-interactive, then animate to the destination transform for 900 ms.
8. Remove the clone, remove the pending class/`aria-hidden`, and pulse the real sticker.
9. Add fail-soft branches for reduced motion, missing geometry, rapid sales, and resize during flight.
10. Verify at desktop, small-screen, and full-screen sizes with at least two different winning teams and roster depths.

## QA record

- Focused automated tests: **23/23 passed** for board layout, auctioneer integration, and nomination contracts.
- Desktop and 1280×720 demo sales: spotlight remained visible at 4.55 seconds, flight existed at 5.2 seconds, and the real sticker was visible with no pending clone at 6.1 seconds.
- Destination geometry at 1280×720: spotlight `620×164` at `(330,191)` landed on the measured Big Head sticker `106×36` at `(1067,255)`.
- Manager-row safety: spotlight top `191px`; measured manager-header bottom `181px`.
- Overflow: none at 1280×720.
- Reduced motion: five-second hold remained; no flight clone was created; the destination sticker revealed normally.
- Rapid-sale stress: Lamar Jackson was revealed immediately when Jonathan Taylor arrived; Taylor received the current spotlight and landed normally. No stale pending stickers remained.
- Browser console: no warnings or errors.
- Full repository suite: all feature-related tests pass. The shared working tree is also being changed by the owner's parallel in-season project; its current catastrophe-rehearsal hash and in-season shell contract failures remain outside these files and were not papered over or committed with this feature.
