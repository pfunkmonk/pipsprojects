# Thunder Bowl 2026 valuation and VBD discrepancy audit

- Pack: `tb26-tb-weekly-source-consensus-20260821-v1-20260821144515` (716 players; as of 2026-08-21T14:45:15.162Z)
- Current four-source weekly assets as of: 2026-08-21
- Legacy FBG weekly cross-check coverage: 604/716 ({"QB":78,"RB":115,"WR":209,"TE":127,"K":43,"DST":32})
- FBG auction-value coverage: 400/716 (supplied ranks 1-400)
- Candidate projection coverage: 416/716
- FBG weekly rows with at least one negative projected week: 148/604
- FBG Draft Dominator configuration compatibility: **MISMATCH** (23 settings)
- Starter-baseline VBD formula mismatches: 0/716
- Legacy player-identity curve repairs of at least $3: 2/716
- Players whose starter/replacement classification reverses against every available external source: 0/716

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
| QB | 33 | -8.4 | 0.895 | 73 | -2.2 | 0.902 | 7 | 18.7 | 1.000 |
| RB | 67 | -8.9 | 0.975 | 101 | -10.1 | 0.953 | 39 | -5.6 | 0.972 |
| WR | 110 | -12.6 | 0.938 | 167 | -7.9 | 0.942 | 38 | -11.6 | 0.954 |
| TE | 43 | -21.9 | 0.957 | 101 | -11.8 | 0.924 | 14 | -19.8 | 0.789 |
| K | 0 |  |  | 0 |  |  | 0 |  |  |
| DST | 0 |  |  | 0 |  |  | 0 |  |  |

## Flag counts

| Flag | Players |
|---|---:|
| FBG_NEGATIVE_WEEK | 148 |
| CANDIDATE_MODEL_OUTLIER | 49 |
| MARKET_RANK_VS_MFL_12 | 38 |
| PROJECTION_SOURCE_RANGE_50 | 28 |
| TEAM_CONFLICT_FBG | 15 |
| MARKET_RANK_VS_FBG_12 | 5 |
| FBG_LATEST_ZERO | 4 |
| LEGACY_CURVE_IDENTITY_REPAIR | 2 |

## Largest projection disagreements

| Player | Pos | Thunder | FBG current | Legacy FBG check | CBS current | FantasyPros current | PFF current | Source range | Challenger | Flags |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Fernando Mendoza | QB | 186.2 | 116.1 | 125.4 | 230.8 | 213.0 | - | 114.7 | 204.1 | PROJECTION_SOURCE_RANGE_50|MARKET_RANK_VS_MFL_12 |
| Tua Tagovailoa | QB | 192.5 | 143.1 | 191.5 | 247.8 | 187.8 | - | 104.7 | 181.7 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50 |
| Bub Means | WR | 63.9 | 3.8 | 0.0 | 82.2 | 106.5 | - | 102.7 | 26.9 | FBG_LATEST_ZERO|PROJECTION_SOURCE_RANGE_50|CANDIDATE_MODEL_OUTLIER |
| Kirk Cousins | QB | 111.7 | 154.3 | 163.4 | 127.1 | 53.3 | - | 101.0 | 57.0 | PROJECTION_SOURCE_RANGE_50|CANDIDATE_MODEL_OUTLIER |
| Christian Kirk | WR | 88.5 | 41.1 | 29.1 | 135.0 | 90.5 | - | 93.9 | 98.7 | PROJECTION_SOURCE_RANGE_50 |
| AJ Dillon | RB | 59.9 | 8.7 | 6.8 | 72.3 | 99.5 | - | 90.8 | 79.0 | PROJECTION_SOURCE_RANGE_50 |
| Troy Franklin | WR | 97.6 | 56.2 | 39.6 | 140.5 | 97.0 | - | 84.3 | 122.9 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50 |
| Malik Benson | WR | 68.2 | 18.8 | 2.3 | 102.3 | 84.4 | - | 83.5 | - | PROJECTION_SOURCE_RANGE_50 |
| James Conner | RB | 68.2 | 30.8 | 19.9 | 113.1 | 61.5 | - | 82.3 | 73.8 | PROJECTION_SOURCE_RANGE_50 |
| Chimere Dike | WR | 75.3 | 34.0 | 19.4 | 113.6 | 79.3 | - | 79.6 | 108.3 | PROJECTION_SOURCE_RANGE_50 |
| Antonio Williams | WR | 84.8 | 36.4 | 37.9 | 114.9 | 103.9 | - | 78.5 | 124.7 | PROJECTION_SOURCE_RANGE_50|MARKET_RANK_VS_MFL_12 |
| Rashee Rice | WR | 255.0 | 218.3 | - | 295.5 | 274.1 | 232.9 | 77.2 | 154.5 | PROJECTION_SOURCE_RANGE_50|CANDIDATE_MODEL_OUTLIER|MARKET_RANK_VS_MFL_12 |
| Elic Ayomanor | WR | 87.2 | 54.7 | 23.4 | 128.3 | 79.5 | - | 73.6 | 107.1 | PROJECTION_SOURCE_RANGE_50 |
| Ja'Kobi Lane | WR | 112.5 | 71.7 | 31.6 | 141.1 | 125.4 | - | 69.4 | 102.7 | PROJECTION_SOURCE_RANGE_50 |
| Carnell Tate | WR | 186.0 | 197.8 | 127.5 | 149.3 | 178.4 | 217.9 | 68.6 | 155.3 | PROJECTION_SOURCE_RANGE_50|MARKET_RANK_VS_MFL_12 |
| Jordan James | RB | 79.7 | 48.3 | 40.8 | 115.7 | 75.9 | - | 67.4 | 105.0 | PROJECTION_SOURCE_RANGE_50 |
| Tory Horton | WR | 85.7 | 48.0 | 31.0 | 115.2 | 94.7 | - | 67.2 | 54.9 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50 |
| Puka Nacua | WR | 341.3 | 311.4 | - | 374.6 | 355.5 | 324.4 | 63.2 | 295.7 | PROJECTION_SOURCE_RANGE_50 |
| Josh Allen | QB | 392.4 | 407.8 | 405.3 | 390.3 | 415.9 | 355.4 | 60.5 | 388.5 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50 |
| De'Zhaun Stribling | WR | 135.5 | 98.2 | 63.0 | 157.4 | 151.7 | - | 59.2 | 130.9 | PROJECTION_SOURCE_RANGE_50 |
| Jaxon Smith-Njigba | WR | 317.7 | 285.3 | - | 344.1 | 324.5 | 317.6 | 58.8 | 321.1 | PROJECTION_SOURCE_RANGE_50 |
| Hollywood Brown | WR | 51.5 | 22.4 | 22.0 | - | 80.9 | - | 58.5 | - | PROJECTION_SOURCE_RANGE_50 |
| Keenan Allen | WR | 131.3 | 97.5 | 11.4 | 155.5 | 141.5 | - | 58.0 | - | PROJECTION_SOURCE_RANGE_50 |
| Jahdae Walker | WR | 50.1 | 20.6 | 17.9 | 72.9 | 57.5 | - | 52.3 | 31.8 | PROJECTION_SOURCE_RANGE_50 |
| Jacoby Brissett | QB | 257.7 | 231.0 | 246.8 | 282.0 | 260.7 | - | 51.0 | 167.0 | PROJECTION_SOURCE_RANGE_50|CANDIDATE_MODEL_OUTLIER |
| Justin Jefferson | WR | 263.5 | 251.6 | 165.4 | 239.7 | 272.2 | 290.5 | 50.8 | 233.4 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50 |
| Demarcus Robinson | WR | 40.5 | 9.0 | 4.9 | 59.7 | 53.4 | - | 50.7 | 67.7 | PROJECTION_SOURCE_RANGE_50 |
| Chris Bell | WR | 94.1 | 68.8 | 34.6 | 119.1 | 94.9 | - | 50.3 | - | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50 |

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
| Justin Joly | TE | -161.8 | $1 | $1 | $1 | 120/71 | $4.03 | 120/22 | MARKET_RANK_VS_MFL_12 |
| Max Klare | TE | -152.7 | $1 | $1 | $1 | 97/48 | $6.42 | 97/12 | MARKET_RANK_VS_MFL_12 |
| Omar Cooper Jr. | WR | -117.6 | $1 | $1 | $1 | 89/66 | $14.75 | 89/17 | MARKET_RANK_VS_MFL_12 |
| Jordyn Tyson | WR | -93.3 | $1 | $1 | $1 | 72/43 | $31.59 | 72/2 | CANDIDATE_MODEL_OUTLIER|MARKET_RANK_VS_MFL_12 |
| Antonio Williams | WR | -126.0 | $1 | $1 | $1 | 98/99 | $8.58 | 98/35 | PROJECTION_SOURCE_RANGE_50|MARKET_RANK_VS_MFL_12 |
| Oscar Delp | TE | -145.0 | $1 | $1 | $1 | 79/57 | $3.63 | 79/24 | MARKET_RANK_VS_MFL_12 |
| Makai Lemon | WR | -69.2 | $1 | $1 | $1 | 58/53 | $27.20 | 58/5 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Eli Stowers | TE | -131.5 | $1 | $1 | $1 | 56/43 | $12.37 | 56/5 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Jonah Coleman | RB | -121.7 | $1 | $1 | $1 | 62/67 | $14.95 | 62/18 | MARKET_RANK_VS_MFL_12 |
| KC Concepcion | WR | -57.0 | $1 | $1 | $1 | 50/52 | $20.64 | 50/7 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Eli Raridon | TE | -135.6 | $1 | $1 | $1 | 61/59 | $4.97 | 61/18 | MARKET_RANK_VS_MFL_12 |
| Drew Allar | QB | -328.2 | $1 | $1 | - | 71/- | $3.82 | 71/34 | MARKET_RANK_VS_MFL_12 |
| Nate Boerkircher | TE | -143.4 | $1 | $1 | $1 | 70/68 | $2.01 | 70/35 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Carnell Tate | WR | -24.8 | $2 | $2 | $2 | 35/31 | $38.62 | 35/1 | PROJECTION_SOURCE_RANGE_50|MARKET_RANK_VS_MFL_12 |
| Fernando Mendoza | QB | -152.4 | $1 | $1 | - | 31/- | $35.27 | 31/1 | PROJECTION_SOURCE_RANGE_50|MARKET_RANK_VS_MFL_12 |
| Ty Simpson | QB | -315.6 | $1 | $1 | - | 38/- | $12.98 | 38/8 | MARKET_RANK_VS_MFL_12 |
| Luther Burden III | WR | 3.0 | $5 | $6 | $5 | 24/20 | $5.46 | 24/52 | MARKET_RANK_VS_MFL_12 |
| Jadarian Price | RB | -7.9 | $5 | $5 | $6 | 28/27 | $36.55 | 28/2 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Denzel Boston | WR | -60.6 | $1 | $1 | $1 | 54/60 | $10.79 | 54/31 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Bucky Irving | RB | 27.6 | $8 | $9 | $10 | 19/22 | $6.21 | 19/41 | MARKET_RANK_VS_MFL_12 |
| Ladd McConkey | WR | 14.5 | $7 | $8 | $6 | 18/17 | $8.13 | 18/39 | MARKET_RANK_VS_MFL_12 |
| Ja'Tavion Sanders | TE | -131.2 | $1 | $1 | $1 | 57/36 | - | 57/- | MARKET_RANK_VS_FBG_12 |
| Tetairoa McMillan | WR | 17.2 | $8 | $9 | $5 | 17/19 | $8.29 | 17/37 | MARKET_RANK_VS_MFL_12 |
| Kenyon Sadiq | TE | -45.5 | $1 | $1 | $1 | 22/17 | $17.17 | 22/2 | MARKET_RANK_VS_MFL_12 |
| Dalton Schultz | TE | -27.5 | $1 | $1 | $1 | 18/23 | $1.85 | 18/38 | MARKET_RANK_VS_MFL_12 |
| Emeka Egbuka | WR | 7.6 | $6 | $6 | $6 | 20/18 | $8.24 | 20/38 | MARKET_RANK_VS_MFL_12 |
| De'Von Achane | RB | 98.0 | $27 | $34 | $25 | 5/10 | $12.14 | 5/21 | MARKET_RANK_VS_MFL_12 |
| Malik Nabers | WR | 23.9 | $10 | $10 | $3 | 14/22 | $10.87 | 14/30 | CANDIDATE_MODEL_OUTLIER|MARKET_RANK_VS_MFL_12 |
| Evan Engram | TE | -63.8 | $1 | $1 | $1 | 29/31 | $1.08 | 29/44 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Jeremiyah Love | RB | 43.9 | $12 | $13 | $14 | 15/17 | $51.56 | 15/1 | MARKET_RANK_VS_MFL_12 |

## Runtime invariants checked

- Historical-demand market values were computed for all 716 players.
- Starter-count VBD was independently recomputed for every player; mismatches: 0.
- Runtime market and bid curves are monotone within position; material legacy identity repairs: 2.
- Initial expected auction purchases: 144.
- Demand-only auction allocation reconciles: $1212 / $1212.
- Bid authority: `classic_starter_vbd_control`.
