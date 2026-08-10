# Thunder Bowl 2026 valuation and VBD discrepancy audit

- Pack: `tb26-tb-accuracy-consensus-20260809-v1-20260809224311-weekly-assets-20260810033019-priority-v1` (716 players; as of 2026-08-10T03:30:19.000Z)
- FBG August 8 weekly coverage: 604/716 ({"QB":78,"RB":115,"WR":209,"TE":127,"K":43,"DST":32})
- FBG auction-value coverage: 400/716 (supplied ranks 1-400)
- Candidate projection coverage: 416/716
- FBG weekly rows with at least one negative projected week: 148/604
- FBG Draft Dominator configuration compatibility: **MISMATCH** (23 settings)
- Starter-baseline VBD formula mismatches: 0/716
- Legacy player-identity curve repairs of at least $3: 2/716
- Players whose starter/replacement classification reverses against every available external source: 1/716

## Systemic findings

1. The live pack's primary projection is the registered Thunder Bowl Consensus: a near-equal accuracy-weighted blend of the dated Footballguys, CBS, and FantasyPros rows available for each player. Missing sources renormalize rather than becoming zero.
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

| Pos | FBG-CBS matches | Median FBG minus CBS | Rank agreement | FBG-FP matches | Median FBG minus FP | Rank agreement |
|---|---:|---:|---:|---:|---:|---:|
| QB | 76 | -1.6 | 0.831 | 74 | 0.0 | 0.904 |
| RB | 119 | -11.2 | 0.887 | 111 | -7.1 | 0.949 |
| WR | 186 | -19.2 | 0.875 | 167 | -6.9 | 0.950 |
| TE | 109 | -19.9 | 0.879 | 100 | -12.2 | 0.921 |
| K | 44 | -7.2 | 0.844 | 0 |  |  |
| DST | 32 | -25.2 | 0.785 | 0 |  |  |

## Flag counts

| Flag | Players |
|---|---:|
| FBG_NEGATIVE_WEEK | 148 |
| PROJECTION_SOURCE_RANGE_50 | 79 |
| MARKET_RANK_VS_MFL_12 | 46 |
| CANDIDATE_MODEL_OUTLIER | 37 |
| TEAM_CONFLICT_FBG | 15 |
| BENCH_DEMAND_VALUE | 5 |
| FBG_LATEST_ZERO | 4 |
| PRIMARY_OUTSIDE_CONSENSUS | 3 |
| LEGACY_CURVE_IDENTITY_REPAIR | 2 |
| MARKET_RANK_VS_FBG_12 | 2 |
| STARTER_VBD_SOURCE_DISAGREEMENT | 1 |

## Largest projection disagreements

| Player | Pos | Thunder | FBG (Aug 3) | FBG weekly (Aug 8) | CBS | FantasyPros | Source range | Challenger | Flags |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| John Metchie III | WR | 111.0 | 10.2 | 10.4 | 162.2 | 162.3 | 152.1 | 120.6 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS|CANDIDATE_MODEL_OUTLIER |
| Kirk Cousins | QB | 85.7 | 155.0 | 163.4 | 47.2 | 53.8 | 107.8 | 57.0 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Denver Broncos | DST | 228.8 | 177.7 | 146.6 | 281.0 | - | 103.3 | - | PROJECTION_SOURCE_RANGE_50 |
| Elic Ayomanor | WR | 80.9 | 34.3 | 23.4 | 134.1 | 75.4 | 99.8 | 107.1 | PROJECTION_SOURCE_RANGE_50 |
| Stefon Diggs | WR | 50.4 | 99.6 | 87.1 | 0.0 | - | 99.6 | - | TEAM_CONFLICT_FBG|PROJECTION_SOURCE_RANGE_50 |
| James Conner | RB | 69.4 | 25.5 | 19.9 | 122.1 | 61.6 | 96.6 | 73.8 | PROJECTION_SOURCE_RANGE_50 |
| Fernando Mendoza | QB | 180.2 | 116.4 | 125.4 | 212.5 | 212.8 | 96.4 | 204.1 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS|MARKET_RANK_VS_MFL_12 |
| Chimere Dike | WR | 75.9 | 30.5 | 19.4 | 123.2 | 75.1 | 92.7 | 108.3 | PROJECTION_SOURCE_RANGE_50 |
| Los Angeles Rams | DST | 195.5 | 150.1 | 117.7 | 242.0 | - | 91.9 | - | PROJECTION_SOURCE_RANGE_50 |
| Shedeur Sanders | QB | 154.3 | 112.3 | 123.5 | 201.7 | 149.9 | 89.4 | 89.2 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50|CANDIDATE_MODEL_OUTLIER |
| Riley Patterson | K | 74.0 | 30.0 | 34.7 | 119.0 | - | 89.0 | 103.1 | PROJECTION_SOURCE_RANGE_50 |
| Houston Texans | DST | 218.9 | 175.2 | 149.4 | 263.6 | - | 88.4 | - | PROJECTION_SOURCE_RANGE_50 |
| Philadelphia Eagles | DST | 188.8 | 145.5 | 121.2 | 233.0 | - | 87.5 | - | PROJECTION_SOURCE_RANGE_50 |
| Brandon Aiyuk | WR | 43.5 | 86.0 | 22.6 | 0.0 | - | 86.0 | - | PROJECTION_SOURCE_RANGE_50 |
| Demarcus Robinson | WR | 53.0 | 10.7 | 4.9 | 96.6 | 52.7 | 85.9 | 67.7 | PROJECTION_SOURCE_RANGE_50 |
| AJ Dillon | RB | 65.1 | 8.8 | 6.8 | 92.9 | 94.5 | 85.7 | 79.0 | PROJECTION_SOURCE_RANGE_50 |
| Christian Kirk | WR | 97.5 | 57.2 | 29.1 | 141.9 | 94.3 | 84.7 | 98.7 | PROJECTION_SOURCE_RANGE_50 |
| Deshaun Watson | QB | 109.6 | 146.4 | 154.8 | 63.8 | 117.6 | 82.6 | 70.4 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50|CANDIDATE_MODEL_OUTLIER |
| Calvin Austin III | WR | 59.7 | 18.8 | 16.4 | 101.2 | 60.0 | 82.4 | 83.9 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50 |
| Blake Grupe | K | 111.8 | 71.5 | 82.8 | 153.0 | - | 81.5 | 131.6 | PROJECTION_SOURCE_RANGE_50|STARTER_VBD_SOURCE_DISAGREEMENT |
| Seattle Seahawks | DST | 204.6 | 165.0 | 136.8 | 245.2 | - | 80.2 | - | PROJECTION_SOURCE_RANGE_50 |
| Jawhar Jordan | RB | 51.8 | 13.9 | 9.7 | 92.4 | 50.1 | 78.5 | 19.4 | PROJECTION_SOURCE_RANGE_50 |
| Troy Franklin | WR | 100.2 | 64.3 | 39.6 | 140.8 | 96.4 | 76.5 | 122.9 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50 |
| Tua Tagovailoa | QB | 214.4 | 192.7 | 191.5 | 263.5 | 187.8 | 75.7 | 181.7 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50 |
| Tank Dell | WR | 139.8 | 101.8 | 64.3 | 177.4 | 141.1 | 75.6 | 115.1 | PROJECTION_SOURCE_RANGE_50 |
| Emari Demercado | RB | 69.6 | 26.7 | 16.1 | 100.5 | 82.4 | 73.8 | 71.5 | PROJECTION_SOURCE_RANGE_50 |
| Tory Horton | WR | 88.8 | 49.5 | 31.0 | 123.0 | 94.7 | 73.5 | 54.9 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50 |
| Isaiah Williams | WR | 32.2 | 7.3 | 4.1 | 80.5 | 9.7 | 73.2 | - | PROJECTION_SOURCE_RANGE_50 |
| Tyreek Hill | WR | 36.6 | 72.4 | 20.5 | 0.0 | - | 72.4 | - | PROJECTION_SOURCE_RANGE_50 |
| Deebo Samuel Sr. | WR | 151.2 | 104.0 | 98.1 | 176.0 | 174.4 | 72.0 | 147.3 | PROJECTION_SOURCE_RANGE_50 |

## Replacement-line source disagreements

These are the source differences most capable of changing VBD rather than merely shifting every player at a position by a similar number of points.

| Player | Pos | Thunder VBD | CBS VBD | FantasyPros VBD | Market | Max | Flags |
|---|---:|---:|---:|---:|---:|---:|---|
| Blake Grupe | K | -20.1 | 16.0 | - | $1 | $1 | PROJECTION_SOURCE_RANGE_50|STARTER_VBD_SOURCE_DISAGREEMENT |

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
| Justin Joly | TE | -152.7 | $1 | $1 | $1 | 101/71 | $4.03 | 101/22 | MARKET_RANK_VS_MFL_12 |
| Oscar Delp | TE | -150.9 | $1 | $1 | $1 | 99/57 | $3.63 | 99/24 | MARKET_RANK_VS_MFL_12 |
| Jonah Coleman | RB | -163.3 | $1 | $1 | $1 | 83/67 | $14.95 | 83/18 | MARKET_RANK_VS_MFL_12 |
| Max Klare | TE | -143.7 | $1 | $1 | $1 | 73/48 | $6.42 | 73/12 | MARKET_RANK_VS_MFL_12 |
| Omar Cooper Jr. | WR | -92.1 | $1 | $1 | $1 | 70/66 | $14.75 | 70/17 | MARKET_RANK_VS_MFL_12 |
| KC Concepcion | WR | -70.7 | $1 | $1 | $1 | 57/52 | $20.64 | 57/7 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Makai Lemon | WR | -58.6 | $1 | $1 | $1 | 50/53 | $27.20 | 50/5 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Jordyn Tyson | WR | -42.4 | $1 | $1 | $1 | 45/43 | $31.59 | 45/2 | MARKET_RANK_VS_MFL_12 |
| Eli Raridon | TE | -130.9 | $1 | $1 | $1 | 58/59 | $4.97 | 58/18 | MARKET_RANK_VS_MFL_12 |
| Carnell Tate | WR | -34.5 | $1 | $1 | $2 | 40/31 | $38.62 | 40/1 | MARKET_RANK_VS_MFL_12 |
| Eli Stowers | TE | -113.4 | $1 | $1 | $1 | 44/43 | $12.37 | 44/5 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Antonio Williams | WR | -104.2 | $1 | $1 | $1 | 74/99 | $8.58 | 74/35 | PROJECTION_SOURCE_RANGE_50|MARKET_RANK_VS_MFL_12 |
| Denzel Boston | WR | -86.5 | $1 | $1 | $1 | 67/60 | $10.79 | 67/31 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Drew Allar | QB | -336.8 | $1 | $1 | - | 70/- | $3.82 | 70/34 | MARKET_RANK_VS_MFL_12 |
| Nate Boerkircher | TE | -137.0 | $1 | $1 | $1 | 65/68 | $2.01 | 65/35 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Fernando Mendoza | QB | -167.2 | $1 | $1 | - | 31/- | $35.27 | 31/1 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS|MARKET_RANK_VS_MFL_12 |
| Luther Burden III | WR | 3.2 | $7 | $5 | $5 | 23/20 | $5.46 | 23/52 | MARKET_RANK_VS_MFL_12 |
| Jadarian Price | RB | -12.1 | $7 | $4 | $6 | 30/27 | $36.55 | 30/2 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Ty Simpson | QB | -317.7 | $1 | $1 | - | 36/- | $12.98 | 36/8 | MARKET_RANK_VS_MFL_12 |
| Bucky Irving | RB | 24.3 | $12 | $8 | $10 | 20/22 | $6.21 | 20/41 | MARKET_RANK_VS_MFL_12 |
| Emeka Egbuka | WR | 12.2 | $9 | $7 | $6 | 18/18 | $8.24 | 18/38 | MARKET_RANK_VS_MFL_12 |
| Kenyon Sadiq | TE | -43.0 | $1 | $1 | $1 | 22/17 | $17.17 | 22/2 | MARKET_RANK_VS_MFL_12 |
| Dalton Schultz | TE | -26.8 | $1 | $1 | $1 | 19/23 | $1.85 | 19/38 | MARKET_RANK_VS_MFL_12 |
| Tetairoa McMillan | WR | 12.6 | $9 | $8 | $5 | 19/19 | $8.29 | 19/37 | MARKET_RANK_VS_MFL_12 |
| Ladd McConkey | WR | 6.6 | $8 | $6 | $6 | 22/17 | $8.13 | 22/39 | MARKET_RANK_VS_MFL_12 |
| De'Von Achane | RB | 98.1 | $24 | $34 | $25 | 5/10 | $12.14 | 5/21 | MARKET_RANK_VS_MFL_12 |
| Rashee Rice | WR | 55.8 | $17 | $18 | $10 | 8/11 | $12.07 | 8/24 | PROJECTION_SOURCE_RANGE_50|CANDIDATE_MODEL_OUTLIER|LEGACY_CURVE_IDENTITY_REPAIR|MARKET_RANK_VS_MFL_12 |
| Evan Engram | TE | -63.2 | $1 | $1 | $1 | 28/31 | $1.08 | 28/44 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Jameson Williams | WR | 5.0 | $8 | $6 | $8 | 21/14 | $8.51 | 21/36 | FBG_NEGATIVE_WEEK|CANDIDATE_MODEL_OUTLIER|MARKET_RANK_VS_MFL_12 |
| Malik Nabers | WR | 16.3 | $10 | $9 | $3 | 16/22 | $10.87 | 16/30 | CANDIDATE_MODEL_OUTLIER|MARKET_RANK_VS_MFL_12 |

## Runtime invariants checked

- Historical-demand market values were computed for all 716 players.
- Starter-count VBD was independently recomputed for every player; mismatches: 0.
- Runtime market and bid curves are monotone within position; material legacy identity repairs: 2.
- Initial expected auction purchases: 144.
- Demand-only auction allocation reconciles: $1212 / $1212.
- Bid authority: `classic_starter_vbd_control`.
