# Thunder Bowl 2026 projection handoff

The CSV template is the only supported boundary from the separate projection-upgrade application into Thunder Bowl.

## Projection application responsibilities

1. Preserve all 716 template rows and every identity column exactly.
2. Replace `model_id` with an immutable build ID and fill the same timezone-bearing `source_as_of` and `exported_at` timestamps on every row.
3. Preserve the Thunder Bowl scoring fingerprint and `candidate_only` authority.
4. Fill the raw source projections. `raw_consensus_points` must equal the arithmetic mean of the source values actually supplied; missing means blank, not zero.
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
