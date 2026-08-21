# Thunder Bowl pack refresh audit

- Audited: 2026-08-21T14:45:15.572Z
- Candidate: `tb26-tb-weekly-source-consensus-20260821-v1-20260821144515` (716 players, 177 keeper rows)
- Decision: **PASS**
- Market allocation: $1212 / $1212
- Changes: 0 added, 0 removed, 66 material

## Blocking issues

- None

## Warnings

- Accepted 'Thunder Bowl Consensus' as a candidate projection source; Thunder Bowl recomputed every strategy value.

## Largest material player changes

- Drake Maye (QB): projection -17.3, market $-5, max $-5
- Breece Hall (RB): projection -15.6, market $-5, max $-5
- Ashton Jeanty (RB): projection -5.5, market $-5, max $-5
- Nico Collins (WR): projection +5.2, market +$5, max +$5
- Chase Brown (RB): projection -2.6, market +$5, max +$5
- Cam Skattebo (RB): projection -23.7, market $-4, max $-4
- Justin Jefferson (WR): projection +3.6, market +$4, max +$4
- A.J. Brown (WR): projection -11.5, market $-3, max $-3
- Rashee Rice (WR): projection -10.4, market $-3, max $-3
- George Pickens (WR): projection -8.2, market $-3, max $-3
- Lamar Jackson (QB): projection -6.8, market +$3, max +$3
- Tetairoa McMillan (WR): projection +6.6, market +$3, max +$3
- Tucker Kraft (TE): projection +6.1, market +$3, max +$3
- Travis Kelce (TE): projection -2.6, market $-3, max $-3
- Philadelphia Eagles (DST): projection -23.7, market $-2, max $-2
- Los Angeles Rams (DST): projection -27.8, market $-1, max $-1
- Keenan Allen (WR): projection +111.8, market +$0, max +$0
- John Metchie III (WR): projection -97.3, market +$0, max +$0
- Zane Gonzalez (K): projection -88.2, market +$0, max +$0
- Kevin Austin Jr. (WR): projection -84.3, market +$0, max +$0
- Jake Moody (K): projection -76.4, market +$0, max +$0
- Darren Waller (TE): projection +76.1, market +$0, max +$0
- Drew Stevens (K): projection +62, market +$0, max +$0
- Ben Sauls (K): projection -61.6, market +$0, max +$0
- Jordyn Tyson (WR): projection -53.2, market +$0, max +$0
- Dominic Zvada (K): projection +48, market +$0, max +$0
- Malik Benson (WR): projection +46.9, market +$0, max +$0
- Blake Grupe (K): projection -45.6, market +$0, max +$0
- Deshaun Watson (QB): projection +44.4, market +$0, max +$0
- Bub Means (WR): projection -42.1, market +$0, max +$0
- Michael Penix Jr. (QB): projection +37.2, market +$0, max +$0
- Xavier Hutchinson (WR): projection +37.1, market +$0, max +$0
- Darnell Mooney (WR): projection -36.7, market +$0, max +$0
- Nick Westbrook-Ikhine (WR): projection -33.3, market +$0, max +$0
- Xavier Weaver (WR): projection -32.1, market +$0, max +$0
- Brandon McManus (K): projection -30.2, market +$0, max +$0
- Najee Harris (RB): projection +29.1, market +$0, max +$0
- Jonah Coleman (RB): projection +28.8, market +$0, max +$0
- Daniel Carlson (K): projection -28.6, market +$0, max +$0
- Caleb Douglas (WR): projection +28.4, market +$0, max +$0
- Johnny Wilson (WR): projection -27.6, market +$0, max +$0
- Ja'Tavion Sanders (TE): projection -27.5, market +$0, max +$0
- Tyrell Shavers (WR): projection -27.5, market +$0, max +$0
- Jacksonville Jaguars (DST): projection +27.3, market +$0, max +$0
- Omar Cooper Jr. (WR): projection -27.1, market +$0, max +$0
- Jake Bobo (WR): projection -26.9, market +$0, max +$0
- Matt Gay (K): projection +26.4, market +$0, max +$0
- Trey Smack (K): projection +26.2, market +$0, max +$0
- Kirk Cousins (QB): projection +26, market +$0, max +$0
- Shedeur Sanders (QB): projection -25.8, market +$0, max +$0

## Per-source weekly asset intake

```json
{
  "modelId": "tb-weekly-source-consensus-20260821-v1",
  "sourceAsOf": "2026-08-21T14:45:07.709Z",
  "exportedAt": "2026-08-21T14:45:15.162Z",
  "combinedSha256": "e7a2cb6cc7085dc7d7ea2815784df9f92d5ad5ce87c04b793697c8f2fbb4e7e8",
  "sourceCoverage": {
    "Footballguys": {
      "rows": 10710,
      "players": 595,
      "usableRows": 10132,
      "missingRows": 0,
      "byeRows": 578,
      "sha256": "f88963b3f609663fe9fb463c3b4596bf87ec49fd7ee6fcfc244a3d4c83c73ce0"
    },
    "CBS": {
      "rows": 4267,
      "players": 251,
      "usableRows": 3400,
      "missingRows": 621,
      "byeRows": 246,
      "sha256": "67556ed0b5cef37030c26672528d09c8eafbd1fa075f2be964a99722ccfb741b"
    },
    "FantasyPros": {
      "rows": 8478,
      "players": 471,
      "usableRows": 8019,
      "missingRows": 0,
      "byeRows": 459,
      "sha256": "5ed29f787cbbd3a0341b799024db976868018cc938ea7fb9a6ff3c2be812b3b3"
    },
    "PFF": {
      "rows": 1764,
      "players": 98,
      "usableRows": 1666,
      "missingRows": 0,
      "byeRows": 98,
      "sha256": "84f667bf63cf303e8724886aa63c24a8dc71a3e6fbc5e7c5d886187733654dd8"
    }
  },
  "players": 716,
  "playersWithFreshRows": 627,
  "fallbackPlayers": 89,
  "changedPlayers": 624,
  "scoringFingerprint": "tb26-ppr-6pt-pass-td-minus2-int-2pt-sack-50fg-v1",
  "missingRowsTreatedAsZero": 0,
  "automaticCorrectionDelta": 0,
  "pffWeightPolicy": "neutral midpoint pending comparable historical archive",
  "systematicCollapseSignals": {
    "Footballguys": 1,
    "CBS": 0,
    "FantasyPros": 0,
    "PFF": 0
  },
  "sourceDisagreementCount75": 12,
  "largestSourceDisagreements": [
    {
      "playerId": "fbg:MendFe00",
      "name": "Fernando Mendoza",
      "position": "QB",
      "spread": 114.7
    },
    {
      "playerId": "fbg:TagoTu00",
      "name": "Tua Tagovailoa",
      "position": "QB",
      "spread": 104.7
    },
    {
      "playerId": "cbs:3123413",
      "name": "Bub Means",
      "position": "WR",
      "spread": 102.7
    },
    {
      "playerId": "fbg:CousKi00",
      "name": "Kirk Cousins",
      "position": "QB",
      "spread": 101
    },
    {
      "playerId": "fbg:KirkCh00",
      "name": "Christian Kirk",
      "position": "WR",
      "spread": 93.9
    },
    {
      "playerId": "fbg:DillA.00",
      "name": "AJ Dillon",
      "position": "RB",
      "spread": 90.8
    },
    {
      "playerId": "fbg:FranTr00",
      "name": "Troy Franklin",
      "position": "WR",
      "spread": 84.3
    },
    {
      "playerId": "fbg:BensMa00",
      "name": "Malik Benson",
      "position": "WR",
      "spread": 83.5
    },
    {
      "playerId": "fbg:ConnJa00",
      "name": "James Conner",
      "position": "RB",
      "spread": 82.3
    },
    {
      "playerId": "fbg:DikeCh00",
      "name": "Chimere Dike",
      "position": "WR",
      "spread": 79.6
    },
    {
      "playerId": "fbg:WillAn02",
      "name": "Antonio Williams",
      "position": "WR",
      "spread": 78.5
    },
    {
      "playerId": "fbg:RiceRa01",
      "name": "Rashee Rice",
      "position": "WR",
      "spread": 77.2
    }
  ]
}
```
