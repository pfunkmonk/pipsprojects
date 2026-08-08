# Thunder Bowl scarcity and confidence QA — 2026-08-05

## Product result

The selected-player card now derives four fast, current-pool reads without changing the model:

- same-position players remaining in the selected player's tier;
- the next available lower-tier player and today's effective bid limit;
- the difference between the selected and alternate effective bid limits;
- the exact spread among dated projection sources, with a high flag at 25 points or more.

Sold players are absent because the calculation receives only the replayed ledger's currently available pool. The read recalculates when the selected player, room inflation, legal maximum, personal hard stop, or drafted-player pool changes.

## Authority boundary

- `modelEffect: none`.
- The engine reads existing tier, rank, source projections, market state, legal maximum, and personal hard stop.
- It cannot write projected points, VBD, intrinsic value, market value, maximum bid, keeper value, annotations, events, or the public board.
- Missing alternatives or source comparisons display an explicit unavailable state instead of inventing evidence.

## Verification

- Unit and web suite: 142/142 pass.
- Production build: 716 players, 12 teams, private/public isolation intact.
- Full auction: 168 sales; replay p95 0.4409 ms; search p95 0.0425 ms; reconnect 1.1717 ms.
- Catastrophe rehearsal: 24 keepers plus 144 sales; replay p95 0.4485 ms; reconnect 1.1766 ms; recovery 17.2261 ms.
- Local browser: Jahmyr Gibbs showed 12 Tier-1 RBs, Jeremiyah Love as the next lower tier at $14, a $17 cliff after the saved $31 personal hard stop, and a 46.9-point high source spread. Bijan Robinson recalculated to a $24 cliff and 58.1-point high spread.
- Production at 1024×640: search remained clear at 372-422 px, fixed sale controls remained at 504-633 px, no horizontal overflow, and diagnostics were empty.

## Production

- Release `20260805c`.
- Offline shell `thunder-bowl-shell-v45`.
- Netlify deploy `6a734c1ef7cede2d93f1c31d`.
