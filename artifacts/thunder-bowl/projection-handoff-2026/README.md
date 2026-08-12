# Thunder Bowl 2026 projection handoff

The CSV template is the only supported boundary from the separate projection-upgrade application into Thunder Bowl.

## Projection application responsibilities

1. Preserve all 716 template rows and every identity column exactly.
2. Replace `model_id` with an immutable build ID and fill the same timezone-bearing `source_as_of` and `exported_at` timestamps on every row.
3. Preserve the Thunder Bowl scoring fingerprint and `candidate_only` authority.
4. Fill the raw source projections. `raw_consensus_points` must equal Thunder Bowl's registered accuracy-weighted consensus of the source values actually supplied (currently FBG 33.7%, FantasyPros 33.3%, CBS 33.0% when all three are present); missing means blank, not zero, and available weights renormalize automatically.
5. Fill every named adjustment. Use `0` when a layer makes no adjustment.
6. Fill the modified projection and 80% uncertainty bounds. All adjustment columns must reconcile exactly to the modified projection.
7. Explain the fallback whenever fewer than two premium sources exist.
8. Optionally supply Weeks 1–18. Weekly values require one blank bye and must sum to the modified projection.

## Thunder Bowl responsibilities

Run:

```text
npm run refresh:thunder-projections -- completed-handoff.csv candidate-pack.json
```

The importer fails closed on coverage, identity, metadata, scoring, authority, arithmetic, interval, fallback, or weekly errors. It creates a candidate pack and audit only. It does not replace the active pack, and the source application cannot write VBD, Market, Max, keeper surplus, bids, or ledger events.

When the active pack already contains validated weekly assets and the handoff omits weekly point columns, the importer preserves the weekly shape and proportionally rebases it to each new season projection. Zero-point deep players remain valid and retain complete bye-aware weekly coverage. Fresh premium-source values replace their dated evidence rows; blanks mean absent and never preserve a stale value.

The Admin page is the review, download, and final-lock surface. Its JSON import accepts only a complete already-audited Thunder Bowl pack; it is intentionally not a raw projection or source-data bypass.
