# Thunder Bowl 2026 valuation and VBD discrepancy audit

- Pack: `tb26-final-supplemental-catalog-20260829132049` (717 players; as of 2026-08-29T13:20:49.394Z)
- Current four-source weekly assets as of: 2026-08-29
- Legacy FBG weekly cross-check coverage: 605/717 ({"QB":78,"RB":115,"WR":209,"TE":128,"K":43,"DST":32})
- FBG auction-value coverage: 400/717 (supplied ranks 1-400)
- Candidate projection coverage: 416/717
- FBG weekly rows with at least one negative projected week: 148/605
- FBG Draft Dominator configuration compatibility: **MISMATCH** (23 settings)
- Starter-baseline VBD formula mismatches: 0/717
- Legacy player-identity curve repairs of at least $3: 0/717
- Players whose starter/replacement classification reverses against every available external source: 0/717

## Systemic findings

1. The live pack's primary projection is the registered Thunder Bowl Consensus: an availability-aware blend of current Footballguys, CBS, FantasyPros, and PFF weekly assets. Footballguys and CBS retain measured inverse-MAE weights; FantasyPros and PFF use neutral priors until sufficient historical calibration exists. Missing source-weeks renormalize and never become zero.
2. The supplied FBG auction PDF was generated from an incompatible Draft Dominator setup: 18 rounds, three starting WRs, non-PPR scoring, 4-point passing TDs, one-point sacks, and other scoring differences. Its ranks remain a directional opinion; its dollars are not Thunder Bowl dollars.
3. The application market estimate uses validated historical roster counts and position spending. The bid ceiling remains the classic starter-VBD room curve because historical-depth VBD failed held-out decision utility.
4. Runtime price curves are reassigned monotonically within each position by projected points. This repairs legacy identity anomalies (for example, a low-ranked player carrying a higher player's old dollar value) without inventing extra room dollars.
5. MFL AAV aggregates mixed budget sizes. It is used as a within-position ranking signal, never compared dollar-for-dollar with Thunder Bowl's $100 cap.
6. The separate handoff model remains a comparison-only challenger. Mean reversion, durability, weather, analog, and schedule total-point corrections remain quarantined because they failed or lacked the production gate.

## FBG Draft Dominator configuration mismatches

| Setting | Thunder Bowl | Supplied DDF |
|---|---:|---:|
| NumRounds | 14 | 18 |
| StartersWR | 2 | 3 |
| QBPassYard | 0.04 | 0.05 |
| QBPassInt | -2 | -1 |
| QBPassTD1 | 6 | 4 |
| RBRecRec | 1 | 0 |
| WRRecRec | 1 | 0 |
| TERecRec | 1 | 0 |
| QBFumbles | -2 | 0 |
| RBFumbles | -2 | 0 |
| WRFumbles | -2 | 0 |
| TEFumbles | -2 | 0 |
| DEFSack | 2 | 1 |
| DEFInt | 2 | 1 |
| DEFForcedFumble | 0 | 1 |
| FGMade3 | 3 | 4 |
| DefPoints1 | 10 | 5 |
| DefPoints2 | 8 | 4 |
| DefPoints3 | 6 | 3 |
| DefPoints4 | 4 | 2 |
| DefPoints5 | 0 | 1 |
| DefPoints6 | -4 | 0 |
| DefPoints7 | -6 | 0 |

## Projection-source calibration by position

Point totals have systematic level differences, but VBD subtracts a same-position replacement line. Rank agreement is therefore more important than raw-point agreement. Spearman values closer to 1 indicate stronger ordering agreement.

| Pos | FBG-CBS matches | Median FBG minus CBS | Rank agreement | FBG-FP matches | Median FBG minus FP | Rank agreement | FBG-PFF matches | Median FBG minus PFF | Rank agreement |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| QB | 34 | -7.7 | 0.912 | 73 | 0.9 | 0.896 | 8 | 13.1 | 0.952 |
| RB | 67 | -11.2 | 0.968 | 105 | -10.2 | 0.951 | 40 | -10.5 | 0.970 |
| WR | 108 | -11.3 | 0.940 | 164 | -8.4 | 0.942 | 38 | -10.7 | 0.949 |
| TE | 42 | -20.6 | 0.940 | 104 | -11.4 | 0.918 | 14 | -17.6 | 0.670 |
| K | 0 |  |  | 0 |  |  | 0 |  |  |
| DST | 0 |  |  | 0 |  |  | 0 |  |  |

## Flag counts

| Flag | Players |
|---|---:|
| FBG_NEGATIVE_WEEK | 148 |
| CANDIDATE_MODEL_OUTLIER | 54 |
| MARKET_RANK_VS_MFL_12 | 39 |
| PROJECTION_SOURCE_RANGE_50 | 27 |
| TEAM_CONFLICT_FBG | 16 |
| FBG_LATEST_ZERO | 3 |
| MARKET_RANK_VS_FBG_12 | 3 |

## Largest projection disagreements

| Player | Pos | Thunder | FBG current | Legacy FBG check | CBS current | FantasyPros current | PFF current | Source range | Challenger | Flags |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Fernando Mendoza | QB | 185.3 | 119.3 | 125.4 | 227.1 | 210.8 | - | 107.8 | 204.1 | PROJECTION_SOURCE_RANGE_50|MARKET_RANK_VS_MFL_12 |
| Bub Means | WR | 64.6 | 5.5 | 0.0 | 82.6 | 106.6 | - | 101.1 | 26.9 | FBG_LATEST_ZERO|PROJECTION_SOURCE_RANGE_50|CANDIDATE_MODEL_OUTLIER |
| Kirk Cousins | QB | 109.7 | 151.3 | 163.4 | 124.5 | 53.1 | - | 98.2 | 57.0 | PROJECTION_SOURCE_RANGE_50|CANDIDATE_MODEL_OUTLIER |
| Christian Kirk | WR | 85.0 | 36.8 | 29.1 | 134.3 | 84.9 | - | 97.5 | 98.7 | PROJECTION_SOURCE_RANGE_50 |
| Antonio Williams | WR | 77.5 | 17.3 | 37.9 | 112.4 | 103.8 | - | 95.1 | 124.7 | PROJECTION_SOURCE_RANGE_50|MARKET_RANK_VS_MFL_12 |
| AJ Dillon | RB | 59.5 | 9.2 | 6.8 | 70.1 | 99.8 | - | 90.6 | 79.0 | PROJECTION_SOURCE_RANGE_50 |
| Troy Franklin | WR | 99.1 | 57.6 | 39.6 | 140.4 | 100.1 | - | 82.8 | 122.9 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50 |
| Chimere Dike | WR | 72.6 | 29.3 | 19.4 | 110.2 | 79.3 | - | 80.9 | 108.3 | PROJECTION_SOURCE_RANGE_50 |
| James Conner | RB | 72.1 | 39.9 | 19.9 | 115.2 | 62.2 | - | 75.3 | 73.8 | PROJECTION_SOURCE_RANGE_50 |
| Rashee Rice | WR | 254.6 | 221.5 | - | 296.1 | 268.4 | 233.1 | 74.6 | 154.5 | PROJECTION_SOURCE_RANGE_50|CANDIDATE_MODEL_OUTLIER|MARKET_RANK_VS_MFL_12 |
| Tyrone Tracy Jr. | RB | 95.0 | 58.8 | 92.1 | 132.5 | 94.5 | - | 73.7 | 129.4 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50 |
| Jordan James | RB | 77.8 | 43.0 | 40.8 | 115.4 | 75.8 | - | 72.4 | 105.0 | PROJECTION_SOURCE_RANGE_50 |
| Tory Horton | WR | 89.3 | 50.4 | 31.0 | 120.6 | 97.8 | - | 70.2 | 54.9 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50|CANDIDATE_MODEL_OUTLIER |
| Malik Benson | WR | 70.0 | 29.0 | 2.3 | 98.2 | 83.6 | - | 69.2 | - | PROJECTION_SOURCE_RANGE_50 |
| Carnell Tate | WR | 185.6 | 196.8 | 127.5 | 148.8 | 178.5 | 217.8 | 69.0 | 155.3 | PROJECTION_SOURCE_RANGE_50|MARKET_RANK_VS_MFL_12 |
| Elic Ayomanor | WR | 90.0 | 63.0 | 23.4 | 128.3 | 79.5 | - | 65.3 | 107.1 | PROJECTION_SOURCE_RANGE_50 |
| De'Zhaun Stribling | WR | 138.2 | 98.5 | 63.0 | 156.5 | 160.2 | - | 61.7 | 130.9 | PROJECTION_SOURCE_RANGE_50 |
| Puka Nacua | WR | 337.7 | 313.7 | - | 373.9 | 339.8 | 324.2 | 60.2 | 295.7 | PROJECTION_SOURCE_RANGE_50 |
| Jaxon Smith-Njigba | WR | 318.9 | 286.2 | - | 346.2 | 326.3 | 317.6 | 60.0 | 321.1 | PROJECTION_SOURCE_RANGE_50 |
| Jahdae Walker | WR | 51.1 | 20.6 | 17.9 | 75.9 | 57.4 | - | 55.3 | 31.8 | PROJECTION_SOURCE_RANGE_50 |
| Hollywood Brown | WR | 53.5 | 26.3 | 22.0 | - | 81.0 | - | 54.7 | - | PROJECTION_SOURCE_RANGE_50 |
| Jeremiyah Love | RB | 228.8 | 203.2 | 184.2 | 216.6 | 255.9 | 239.7 | 52.7 | 220.1 | PROJECTION_SOURCE_RANGE_50|MARKET_RANK_VS_MFL_12 |
| Josh Allen | QB | 394.3 | 406.1 | 405.3 | 390.5 | 415.9 | 364.4 | 51.5 | 388.5 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50 |
| Ja'Kobi Lane | WR | 118.6 | 89.8 | 31.6 | 141.2 | 125.4 | - | 51.4 | 102.7 | PROJECTION_SOURCE_RANGE_50 |
| Justin Jefferson | WR | 263.8 | 252.7 | 165.4 | 239.2 | 272.5 | 290.5 | 51.3 | 233.4 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50 |
| Harold Fannin Jr. | TE | 199.5 | 172.3 | 103.8 | 222.7 | 198.6 | 205.0 | 50.4 | 185.8 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50 |
| Tank Dell | WR | 111.1 | 82.2 | 64.3 | 132.5 | 119.2 | - | 50.3 | 115.1 | PROJECTION_SOURCE_RANGE_50 |

## Replacement-line source disagreements

These are the source differences most capable of changing VBD rather than merely shifting every player at a position by a similar number of points.

| Player | Pos | Thunder VBD | CBS VBD | FantasyPros VBD | PFF VBD | Market | Max | Flags |
|---|---:|---:|---:|---:|---:|---:|---:|---|

## Investigated high-variance cases

| Case | Evidence and disposition |
|---|---|
| Kirk Cousins / Fernando Mendoza | Their disagreement is mostly a workload split, not a missing-team total. The Raiders named Cousins the opening-camp QB1 and Mendoza worked with the second unit. Retain FBG's current allocation, flag the competition, and refresh before draft day. [Raiders camp report](https://www.raiders.com/news/kirk-cousins-2026-raiders-training-camp-qb1-klint-kubiak-fernando-mendoza) |
| James Conner | The low FBG projection is plausibly an injury-duration judgment: Arizona says he is still rehabbing the major 2025 foot injury. Do not mechanically average the optimistic CBS number upward. [Cardinals report](https://www.azcardinals.com/news/after-rough-year-cardinals-mike-lafleur-look-at-running-back-room) |
| John Metchie III | He is on Carolina's roster, but the team's own position preview places him in the bubble group behind two established starters. FBG's low role projection is defensible; CBS/FantasyPros are a ceiling scenario, not grounds for an automatic override. [Panthers position preview](https://www.panthers.com/news/panthers-pre-training-camp-2026-positional-preview-offense) |
| Brandon Aiyuk | San Francisco lists him Reserve/Left Squad and outside the 90-man roster. CBS's zero and FBG's small projection are scenario disagreement; the current $1 market/max avoids a false bid signal. [49ers camp update](https://www.49ers.com/news/report-day-takeaways-john-lynch-shares-team-updates-ahead-of-training-camp-2026) |
| Tyreek Hill | He is a free agent rehabbing major multi-ligament knee surgery without a return timetable. The FBG/CBS disagreement is uncertainty, not a safe 72-point expectation; current $1 treatment is appropriate pending a signing and medical update. [NFL update](https://amp.nfl.com/news/tyreek-hill-free-agent-update-injury-no-power-left-leg) |
| Stefon Diggs | CBS's August 3 zero predates his reported August 5 Washington deal; the August 8 FBG team is newer. His team label should refresh in the next projection build, but his present $1 price means no current room-dollar distortion. [Signing report](https://as.com/us/nfl/stefon-diggs-jugara-con-los-washington-commanders-f202608-n/) |
| Five August 8 FBG zero rows | Official rosters still list Theo Wease, Bub Means, Kevin Austin, Tylan Wallace, and Tyrell Shavers. The zeros reflect role/injury judgments rather than identity deletion; all five remain $1 players. [Dolphins](https://www.miamidolphins.com/team/rosters), [Saints](https://www.neworleanssaints.com/team/rosters), [Browns](https://www.clevelandbrowns.com/team/players-roster/tylan-wallace/), [Bills](https://www.buffalobills.com/team/players-roster/tyrell-shavers/) |

## Largest auction-value disagreements

| Player | Pos | VBD | Market | Max | FBG raw $ | Market/FBG pos rank | MFL mixed-budget AAV | Market/MFL pos rank | Flags |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Justin Joly | TE | -164.2 | $1 | $1 | $1 | 120/71 | $4.03 | 120/22 | MARKET_RANK_VS_MFL_12 |
| Max Klare | TE | -153.6 | $1 | $1 | $1 | 94/48 | $6.42 | 94/12 | MARKET_RANK_VS_MFL_12 |
| Jordyn Tyson | WR | -93.9 | $1 | $1 | $1 | 72/43 | $31.59 | 72/2 | CANDIDATE_MODEL_OUTLIER|MARKET_RANK_VS_MFL_12 |
| Omar Cooper Jr. | WR | -114.6 | $1 | $1 | $1 | 85/66 | $14.75 | 85/17 | MARKET_RANK_VS_MFL_12 |
| Antonio Williams | WR | -134.2 | $1 | $1 | $1 | 100/99 | $8.58 | 100/35 | PROJECTION_SOURCE_RANGE_50|MARKET_RANK_VS_MFL_12 |
| Oscar Delp | TE | -147.0 | $1 | $1 | $1 | 78/57 | $3.63 | 78/24 | MARKET_RANK_VS_MFL_12 |
| Makai Lemon | WR | -69.8 | $1 | $1 | $1 | 58/53 | $27.20 | 58/5 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Eli Stowers | TE | -135.5 | $1 | $1 | $1 | 57/43 | $12.37 | 57/5 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Jonah Coleman | RB | -122.8 | $1 | $1 | $1 | 64/67 | $14.95 | 64/18 | MARKET_RANK_VS_MFL_12 |
| Eli Raridon | TE | -137.3 | $1 | $1 | $1 | 60/59 | $4.97 | 60/18 | MARKET_RANK_VS_MFL_12 |
| Drew Allar | QB | -328.5 | $1 | $1 | - | 73/- | $3.82 | 73/34 | MARKET_RANK_VS_MFL_12 |
| KC Concepcion | WR | -45.1 | $1 | $1 | $1 | 45/52 | $20.64 | 45/7 | FBG_NEGATIVE_WEEK|CANDIDATE_MODEL_OUTLIER|MARKET_RANK_VS_MFL_12 |
| Carnell Tate | WR | -25.8 | $2 | $2 | $2 | 35/31 | $38.62 | 35/1 | PROJECTION_SOURCE_RANGE_50|MARKET_RANK_VS_MFL_12 |
| Nate Boerkircher | TE | -145.0 | $1 | $1 | $1 | 69/68 | $2.01 | 69/35 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Ty Simpson | QB | -316.0 | $1 | $1 | - | 38/- | $12.98 | 38/8 | MARKET_RANK_VS_MFL_12 |
| Luther Burden III | WR | 2.2 | $5 | $6 | $5 | 23/20 | $5.46 | 23/52 | MARKET_RANK_VS_MFL_12 |
| Fernando Mendoza | QB | -153.5 | $1 | $1 | - | 30/- | $35.27 | 30/1 | PROJECTION_SOURCE_RANGE_50|MARKET_RANK_VS_MFL_12 |
| Jadarian Price | RB | -7.5 | $5 | $5 | $6 | 28/27 | $36.55 | 28/2 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Bucky Irving | RB | 27.6 | $8 | $9 | $10 | 19/22 | $6.21 | 19/41 | MARKET_RANK_VS_MFL_12 |
| Kenyon Sadiq | TE | -49.0 | $1 | $1 | $1 | 24/17 | $17.17 | 24/2 | MARKET_RANK_VS_MFL_12 |
| Ladd McConkey | WR | 16.0 | $7 | $8 | $6 | 18/17 | $8.13 | 18/39 | MARKET_RANK_VS_MFL_12 |
| Denzel Boston | WR | -57.3 | $1 | $1 | $1 | 52/60 | $10.79 | 52/31 | FBG_NEGATIVE_WEEK|CANDIDATE_MODEL_OUTLIER|MARKET_RANK_VS_MFL_12 |
| Tetairoa McMillan | WR | 17.5 | $8 | $9 | $5 | 17/19 | $8.29 | 17/37 | MARKET_RANK_VS_MFL_12 |
| Dalton Schultz | TE | -32.7 | $1 | $1 | $1 | 19/23 | $1.85 | 19/38 | MARKET_RANK_VS_MFL_12 |
| Emeka Egbuka | WR | 6.2 | $6 | $6 | $6 | 20/18 | $8.24 | 20/38 | MARKET_RANK_VS_MFL_12 |
| Ja'Tavion Sanders | TE | -133.3 | $1 | $1 | $1 | 54/36 | - | 54/- | MARKET_RANK_VS_FBG_12 |
| Oronde Gadsden | TE | -71.1 | $1 | $1 | $1 | 31/21 | $6.13 | 31/14 | MARKET_RANK_VS_MFL_12 |
| De'Von Achane | RB | 98.3 | $27 | $34 | $25 | 5/10 | $12.14 | 5/21 | MARKET_RANK_VS_MFL_12 |
| Evan Engram | TE | -61.6 | $1 | $1 | $1 | 28/31 | $1.08 | 28/44 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Malik Nabers | WR | 21.0 | $9 | $10 | $3 | 15/22 | $10.87 | 15/30 | CANDIDATE_MODEL_OUTLIER|MARKET_RANK_VS_MFL_12 |

## Runtime invariants checked

- Historical-demand market values were computed for all 717 players.
- Starter-count VBD was independently recomputed for every player; mismatches: 0.
- Runtime market and bid curves are monotone within position; material legacy identity repairs: 0.
- Initial expected auction purchases: 144.
- Demand-only auction allocation reconciles: $1212 / $1212.
- Bid authority: `classic_starter_vbd_control`.
