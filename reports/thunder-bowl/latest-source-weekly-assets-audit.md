# Thunder Bowl pack refresh audit

- Audited: 2026-08-29T12:46:35.907Z
- Candidate: `tb26-tb-weekly-source-consensus-20260829-v1-20260829124635` (716 players, 177 keeper rows)
- Decision: **PASS**
- Market allocation: $1212 / $1212
- Changes: 0 added, 0 removed, 27 material

## Blocking issues

- None

## Warnings

- Accepted 'Thunder Bowl Consensus' as a candidate projection source; Thunder Bowl recomputed every strategy value.

## Largest material player changes

- Ashton Jeanty (RB): projection -32.3, market $-9, max $-9
- Nico Collins (WR): projection -7.6, market $-5, max $-5
- Harold Fannin Jr. (TE): projection +6.9, market +$5, max +$5
- Saquon Barkley (RB): projection +0.7, market +$4, max +$4
- Tyler Warren (TE): projection +0, market $-4, max $-4
- Tucker Kraft (TE): projection -3.6, market $-3, max $-3
- George Pickens (WR): projection +2.3, market +$3, max +$3
- Theo Wease Jr. (WR): projection -97.9, market +$0, max +$0
- Tua Tagovailoa (QB): projection -68.5, market +$0, max +$0
- Daniel Carlson (K): projection +57.8, market +$0, max +$0
- Tylan Wallace (WR): projection -57.7, market +$0, max +$0
- Charlie Smyth (K): projection -57.5, market +$0, max +$0
- Calvin Austin III (WR): projection -56.8, market +$0, max +$0
- MarShawn Lloyd (RB): projection +43.4, market +$0, max +$0
- Michael Penix Jr. (QB): projection +38.3, market +$0, max +$0
- Mike Washington Jr. (RB): projection +32.5, market +$0, max +$0
- Dominic Lovett (WR): projection -31.8, market +$0, max +$0
- Cedrick Wilson Jr. (WR): projection -27.7, market +$0, max +$0
- Kayshon Boutte (WR): projection +27.6, market +$0, max +$0
- Kyle Williams (WR): projection +26.5, market +$0, max +$0
- Cedric Tillman (WR): projection -26, market +$0, max +$0
- Olamide Zaccheaus (WR): projection -24.8, market +$0, max +$0
- Najee Harris (RB): projection +23.3, market +$0, max +$0
- Mack Hollins (WR): projection +22.9, market +$0, max +$0
- Carlos Washington Jr. (RB): projection -22.5, market +$0, max +$0
- DeMario Douglas (WR): projection +20.6, market +$0, max +$0
- Tyrone Tracy Jr. (RB): projection -20.2, market +$0, max +$0

## Per-source weekly asset intake

```json
{
  "modelId": "tb-weekly-source-consensus-20260829-v1",
  "sourceAsOf": "2026-08-29T12:46:24.953Z",
  "exportedAt": "2026-08-29T12:46:35.477Z",
  "combinedSha256": "1087b66bc3023a642db02a0f7951033ea311038ea810c404f94f1f56e45ae39d",
  "sourceCoverage": {
    "Footballguys": {
      "rows": 10980,
      "players": 610,
      "usableRows": 10389,
      "missingRows": 0,
      "byeRows": 591,
      "sha256": "d54a8ae5b249c751fa8375acbd16b4af36c40b03f388a0925d212aeb6495c0f3"
    },
    "CBS": {
      "rows": 4233,
      "players": 249,
      "usableRows": 3394,
      "missingRows": 592,
      "byeRows": 247,
      "sha256": "90350be08308715ab933b3359961fb08dd65ceacdf4038caa4752c53922ea757"
    },
    "FantasyPros": {
      "rows": 8442,
      "players": 469,
      "usableRows": 7986,
      "missingRows": 0,
      "byeRows": 456,
      "sha256": "fe11c89785eb313a98b70898c4833204e570c5ff659b904c181882af3c4eb21b"
    },
    "PFF": {
      "rows": 1800,
      "players": 100,
      "usableRows": 1700,
      "missingRows": 0,
      "byeRows": 100,
      "sha256": "6fe86d97ef1d2870e4f6a89a76de5b5b1415f9ac2825fee088c49dd6ab16248c"
    }
  },
  "players": 716,
  "playersWithFreshRows": 636,
  "fallbackPlayers": 80,
  "changedPlayers": 503,
  "scoringFingerprint": "tb26-ppr-6pt-pass-td-minus2-int-2pt-sack-50fg-v1",
  "missingRowsTreatedAsZero": 0,
  "automaticCorrectionDelta": 0,
  "pffWeightPolicy": "neutral midpoint pending comparable historical archive",
  "systematicCollapseSignals": {
    "Footballguys": 0,
    "CBS": 0,
    "FantasyPros": 0,
    "PFF": 0
  },
  "sourceDisagreementCount75": 9,
  "largestSourceDisagreements": [
    {
      "playerId": "fbg:MendFe00",
      "name": "Fernando Mendoza",
      "position": "QB",
      "spread": 107.8
    },
    {
      "playerId": "cbs:3123413",
      "name": "Bub Means",
      "position": "WR",
      "spread": 101.1
    },
    {
      "playerId": "fbg:CousKi00",
      "name": "Kirk Cousins",
      "position": "QB",
      "spread": 98.2
    },
    {
      "playerId": "fbg:KirkCh00",
      "name": "Christian Kirk",
      "position": "WR",
      "spread": 97.5
    },
    {
      "playerId": "fbg:WillAn02",
      "name": "Antonio Williams",
      "position": "WR",
      "spread": 95.1
    },
    {
      "playerId": "fbg:DillA.00",
      "name": "AJ Dillon",
      "position": "RB",
      "spread": 90.6
    },
    {
      "playerId": "fbg:FranTr00",
      "name": "Troy Franklin",
      "position": "WR",
      "spread": 82.8
    },
    {
      "playerId": "fbg:DikeCh00",
      "name": "Chimere Dike",
      "position": "WR",
      "spread": 80.9
    },
    {
      "playerId": "fbg:ConnJa00",
      "name": "James Conner",
      "position": "RB",
      "spread": 75.3
    }
  ]
}
```
