# Thunder Bowl In-Season GM implementation plan

## Reuse

- Private `tb26_session` authentication, secure response headers, same-origin write checks, and role-isolation inventory.
- The production-locked 717-player pack, player identity normalization, exact Thunder Bowl starter requirements, weekly projection shapes, projection-source accuracy weights, 2026 divisions/schedule, and final append-only auction ledger.
- Strong-consistency Netlify Blob patterns, last-known-good fallback, offline IndexedDB, the API-excluding service worker, and the least-privilege CBS Chrome helper.
- Existing Footballguys depth/news and public CBS news collectors as evidence-only inputs.

## New work

- A versioned canonical in-season source contract for authenticated CBS all-team rosters/availability and optional manual Footballguys weekly exports.
- Exact weekly lineup optimization; waiver add/drop marginal lineup and resilience scoring; two-sided rest-of-season trade evaluation with salaries and keeper contracts.
- An append-only private Tuesday recommendation store and history, Denver-aware scheduled public refresh, idempotency by season/week/source/schema, and stale/partial recovery.
- A private `/thunder-bowl/season/` working surface with one public refresh action, one explicit private CBS sync action, compact evidence dialogs, offline last-known-good recovery, and no static/private payload leakage.

## Build order

1. Pure time, source, lineup, waiver, trade, and recommendation modules with fixtures.
2. Private Blob store plus snapshot, refresh/sync, and scheduled collector functions.
3. Authenticated route, responsive UI, evidence dialogs, CBS helper bridge, imports/exports, and service-worker shell support.
4. Security, failure, idempotency, offline, accessibility, responsive, regression, and backtest/archive gates.
5. Guide/handoff/product-plan updates, full QA, commit, push, and production verification.

## Known risks and fail-closed choices

- CBS documents E-Reports but no supported unattended private-league API; Footballguys' current CBS connection uses a browser extension. Private league sync therefore remains visibly user-triggered.
- Exact in-season waiver pricing/contracts, trade salary-transfer rules, and deadlines are not present in the repository. Advice omits price authority and labels trades `EXPLORE` until those CBS rules are confirmed.
- Comparable historical premium weekly snapshots do not exist. No historical accuracy is invented; the release creates the append-only 2026 archive needed for future time-forward validation.
- The final Week 1 baseline comes from the production append-only ledger; live CBS becomes authority as soon as the owner syncs it.

## Release gates

- Parser and identity drift, missing-not-zero, exact lineup, availability/drop legality, two-sided trade/salary/contract, Denver DST/idempotency, stale/failure/offline recovery, role isolation, CSP/cache, keyboard/dialog, zoom/responsive, full current tests/build/rehearsals, and deployed-route checks.
