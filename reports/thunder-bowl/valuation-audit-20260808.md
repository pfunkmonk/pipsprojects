# Thunder Bowl 2026 valuation and VBD discrepancy audit

- Pack: `tb26-provisional-20260808-v11` (716 players; as of 2026-08-08T19:00:00-06:00)
- FBG August 8 weekly coverage: 604/716 ({"QB":78,"RB":115,"WR":209,"TE":127,"K":43,"DST":32})
- FBG auction-value coverage: 400/716 (supplied ranks 1-400)
- Candidate projection coverage: 416/716
- FBG weekly rows with at least one negative projected week: 148/604
- FBG Draft Dominator configuration compatibility: **MISMATCH** (23 settings)
- Starter-baseline VBD formula mismatches: 0/716
- Legacy player-identity curve repairs of at least $3: 22/716
- Players whose starter/replacement classification reverses against every available external source: 3/716

## Systemic findings

1. The live pack's primary projection is the August 3 Footballguys raw-category feed rescored for Thunder Bowl. The August 8 weekly export uses a different scoring setup and contains artificial negative reconciliation weeks; its season totals cannot replace the Thunder Bowl-scored primary.
2. The supplied FBG auction PDF was generated from an incompatible Draft Dominator setup: 18 rounds, three starting WRs, non-PPR scoring, 4-point passing TDs, one-point sacks, and other scoring differences. Its ranks remain a directional opinion; its dollars are not Thunder Bowl dollars.
3. The application market estimate uses validated historical roster counts and position spending. The bid ceiling remains the classic starter-VBD room curve because historical-depth VBD failed held-out decision utility.
4. Runtime price curves are reassigned monotonically within each position by projected points. This repairs legacy identity anomalies (for example, a low-ranked player carrying a higher player's old dollar value) without inventing extra room dollars.
5. MFL AAV aggregates mixed budget sizes. It is used as a within-position ranking signal, never compared dollar-for-dollar with Thunder Bowl's $100 cap.
6. The separate candidate projection model remains quarantined. Its own handoff documents incomplete pack coverage and unsupported K/DST/durability behavior.

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
| K | 10 | 4.4 | 0.430 | 0 |  |  |
| DST | 0 |  |  | 0 |  |  |

## Flag counts

| Flag | Players |
|---|---:|
| FBG_NEGATIVE_WEEK | 148 |
| PROJECTION_SOURCE_RANGE_50 | 69 |
| PRIMARY_OUTSIDE_CONSENSUS | 47 |
| MARKET_RANK_VS_MFL_12 | 40 |
| CANDIDATE_MODEL_OUTLIER | 37 |
| LEGACY_CURVE_IDENTITY_REPAIR | 22 |
| TEAM_CONFLICT_FBG | 15 |
| MARKET_RANK_VS_FBG_12 | 8 |
| BENCH_DEMAND_VALUE | 6 |
| FBG_LATEST_ZERO | 5 |
| STARTER_VBD_SOURCE_DISAGREEMENT | 3 |

## Largest projection disagreements

| Player | Pos | Primary (Aug 3) | FBG weekly (Aug 8) | CBS | FantasyPros | Source range | Candidate | Flags |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| John Metchie III | WR | 10.2 (Footballguys) | 10.4 | 162.2 | 162.3 | 152.1 | 120.6 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS|CANDIDATE_MODEL_OUTLIER |
| Kirk Cousins | QB | 155.0 (Footballguys) | 163.4 | 47.2 | 53.8 | 107.8 | 57.0 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Elic Ayomanor | WR | 34.3 (Footballguys) | 23.4 | 134.1 | 75.4 | 99.8 | 107.1 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Stefon Diggs | WR | 99.6 (Footballguys) | 87.1 | 0.0 | - | 99.6 | - | TEAM_CONFLICT_FBG|PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| James Conner | RB | 25.5 (Footballguys) | 19.9 | 122.1 | 61.6 | 96.6 | 73.8 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Fernando Mendoza | QB | 116.4 (Footballguys) | 125.4 | 212.5 | 212.8 | 96.4 | 204.1 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS|MARKET_RANK_VS_MFL_12 |
| Chimere Dike | WR | 30.5 (Footballguys) | 19.4 | 123.2 | 75.1 | 92.7 | 108.3 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Shedeur Sanders | QB | 112.3 (Footballguys) | 123.5 | 201.7 | 149.9 | 89.4 | 89.2 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS|CANDIDATE_MODEL_OUTLIER |
| Brandon Aiyuk | WR | 86.0 (Footballguys) | 22.6 | 0.0 | - | 86.0 | - | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Demarcus Robinson | WR | 10.7 (Footballguys) | 4.9 | 96.6 | 52.7 | 85.9 | 67.7 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| AJ Dillon | RB | 8.8 (Footballguys) | 6.8 | 92.9 | 94.5 | 85.7 | 79.0 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Christian Kirk | WR | 57.2 (Footballguys) | 29.1 | 141.9 | 94.3 | 84.7 | 98.7 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Deshaun Watson | QB | 146.4 (Footballguys) | 154.8 | 63.8 | 117.6 | 82.6 | 70.4 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50|CANDIDATE_MODEL_OUTLIER |
| Calvin Austin III | WR | 18.8 (Footballguys) | 16.4 | 101.2 | 60.0 | 82.4 | 83.9 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Jawhar Jordan | RB | 13.9 (Footballguys) | 9.7 | 92.4 | 50.1 | 78.5 | 19.4 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Troy Franklin | WR | 64.3 (Footballguys) | 39.6 | 140.8 | 96.4 | 76.5 | 122.9 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Tua Tagovailoa | QB | 192.7 (Footballguys) | 191.5 | 263.5 | 187.8 | 75.7 | 181.7 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50 |
| Tank Dell | WR | 101.8 (Footballguys) | 64.3 | 177.4 | 141.1 | 75.6 | 115.1 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Emari Demercado | RB | 26.7 (Footballguys) | 16.1 | 100.5 | 82.4 | 73.8 | 71.5 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Tory Horton | WR | 49.5 (Footballguys) | 31.0 | 123.0 | 94.7 | 73.5 | 54.9 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Isaiah Williams | WR | 7.3 (Footballguys) | 4.1 | 80.5 | 9.7 | 73.2 | - | PROJECTION_SOURCE_RANGE_50 |
| Tyreek Hill | WR | 72.4 (Footballguys) | 20.5 | 0.0 | - | 72.4 | - | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Deebo Samuel Sr. | WR | 104.0 (Footballguys) | 98.1 | 176.0 | 174.4 | 72.0 | 147.3 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Antonio Williams | WR | 63.5 (Footballguys) | 37.9 | 135.0 | 125.7 | 71.5 | 124.7 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS|MARKET_RANK_VS_MFL_12 |
| Adam Randall | RB | 35.7 (Footballguys) | 31.4 | 106.2 | 66.2 | 70.5 | 87.7 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Will Kacmarek | TE | 13.0 (Footballguys) | 6.9 | 83.3 | 61.9 | 70.3 | 74.1 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Xavier Hutchinson | WR | 23.7 (Footballguys) | 15.1 | 93.5 | 63.9 | 69.8 | 73.3 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Jordan James | RB | 52.6 (Footballguys) | 40.8 | 121.4 | 92.0 | 68.8 | 105.0 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |
| Jahdae Walker | WR | 35.2 (Footballguys) | 17.9 | 102.5 | 56.2 | 67.3 | 31.8 | PROJECTION_SOURCE_RANGE_50 |
| Ashton Dulin | WR | 32.9 (Footballguys) | 21.2 | 99.9 | 78.7 | 67.0 | 62.4 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS |

## Replacement-line source disagreements

These are the source differences most capable of changing VBD rather than merely shifting every player at a position by a similar number of points.

| Player | Pos | FBG VBD | CBS VBD | FantasyPros VBD | Market | Max | Flags |
|---|---:|---:|---:|---:|---:|---:|---|
| Mark Andrews | TE | 8.5 | -17.6 | -4.1 | $5 | $3 | STARTER_VBD_SOURCE_DISAGREEMENT |
| Dallas Goedert | TE | -4.5 | 17.5 | 12.2 | $3 | $2 | FBG_NEGATIVE_WEEK|PROJECTION_SOURCE_RANGE_50|STARTER_VBD_SOURCE_DISAGREEMENT |
| Justin Herbert | QB | 8.3 | -5.0 | -4.3 | $5 | $3 | STARTER_VBD_SOURCE_DISAGREEMENT |

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
| Justin Joly | TE | -140.7 | $1 | $1 | $1 | 103/71 | $4.03 | 103/22 | MARKET_RANK_VS_MFL_12 |
| Antonio Williams | WR | -147.3 | $1 | $1 | $1 | 109/99 | $8.58 | 109/35 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS|MARKET_RANK_VS_MFL_12 |
| Nate Boerkircher | TE | -139.2 | $1 | $1 | $1 | 96/68 | $2.01 | 96/35 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Jonah Coleman | RB | -158.4 | $1 | $1 | $1 | 72/67 | $14.95 | 72/18 | MARKET_RANK_VS_MFL_12 |
| Eli Raridon | TE | -129.4 | $1 | $1 | $1 | 71/59 | $4.97 | 71/18 | MARKET_RANK_VS_MFL_12 |
| Omar Cooper Jr. | WR | -103.1 | $1 | $1 | $1 | 66/66 | $14.75 | 66/17 | MARKET_RANK_VS_MFL_12 |
| Makai Lemon | WR | -63.2 | $1 | $1 | $1 | 53/53 | $27.20 | 53/5 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| KC Concepcion | WR | -60.6 | $1 | $1 | $1 | 51/52 | $20.64 | 51/7 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Ty Simpson | QB | -314.8 | $1 | $1 | - | 50/- | $12.98 | 50/8 | MARKET_RANK_VS_MFL_12 |
| Jordyn Tyson | WR | -42.3 | $1 | $1 | $1 | 41/43 | $31.59 | 41/2 | MARKET_RANK_VS_MFL_12 |
| Eli Stowers | TE | -100.7 | $1 | $1 | $1 | 42/43 | $12.37 | 42/5 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Drew Allar | QB | -323.0 | $1 | $1 | - | 71/- | $3.82 | 71/34 | MARKET_RANK_VS_MFL_12 |
| Max Klare | TE | -115.4 | $1 | $1 | $1 | 48/48 | $6.42 | 48/12 | MARKET_RANK_VS_MFL_12 |
| Luther Burden III | WR | 7.7 | $9 | $7 | $5 | 19/20 | $5.46 | 19/52 | MARKET_RANK_VS_MFL_12 |
| Oscar Delp | TE | -124.2 | $1 | $1 | $1 | 56/57 | $3.63 | 56/24 | MARKET_RANK_VS_MFL_12 |
| Fernando Mendoza | QB | -216.9 | $1 | $1 | - | 33/- | $35.27 | 33/1 | PROJECTION_SOURCE_RANGE_50|PRIMARY_OUTSIDE_CONSENSUS|MARKET_RANK_VS_MFL_12 |
| Carnell Tate | WR | -12.4 | $5 | $3 | $2 | 29/31 | $38.62 | 29/1 | MARKET_RANK_VS_MFL_12 |
| Jadarian Price | RB | -26.0 | $8 | $5 | $6 | 28/27 | $36.55 | 28/2 | FBG_NEGATIVE_WEEK|BENCH_DEMAND_VALUE|LEGACY_CURVE_IDENTITY_REPAIR|MARKET_RANK_VS_MFL_12 |
| Denzel Boston | WR | -80.0 | $1 | $1 | $1 | 57/60 | $10.79 | 57/31 | FBG_NEGATIVE_WEEK|MARKET_RANK_VS_MFL_12 |
| Blake Grupe | K | 16.0 | $2 | $2 | $1 | 4/29 | - | 4/- | MARKET_RANK_VS_FBG_12 |
| Ladd McConkey | WR | 14.0 | $10 | $10 | $6 | 15/17 | $8.13 | 15/39 | MARKET_RANK_VS_MFL_12 |
| Chris Boswell | K | -26.0 | $1 | $1 | $1 | 29/16 | $1.61 | 29/8 | MARKET_RANK_VS_FBG_12|MARKET_RANK_VS_MFL_12 |
| Tetairoa McMillan | WR | 10.7 | $10 | $9 | $5 | 17/19 | $8.29 | 17/37 | MARKET_RANK_VS_MFL_12 |
| Bucky Irving | RB | 6.0 | $11 | $8 | $10 | 21/22 | $6.21 | 21/41 | MARKET_RANK_VS_MFL_12 |
| Jake Elliott | K | -18.0 | $1 | $1 | $1 | 25/19 | $1.63 | 25/7 | MARKET_RANK_VS_MFL_12 |
| Kenyon Sadiq | TE | -26.8 | $1 | $1 | $1 | 20/17 | $17.17 | 20/2 | MARKET_RANK_VS_MFL_12 |
| Dalton Schultz | TE | -27.0 | $1 | $1 | $1 | 21/23 | $1.85 | 21/38 | MARKET_RANK_VS_MFL_12 |
| Malik Nabers | WR | 15.0 | $11 | $10 | $3 | 14/22 | $10.87 | 14/30 | CANDIDATE_MODEL_OUTLIER|MARKET_RANK_VS_MFL_12 |
| Brian Thomas Jr. | WR | -26.0 | $4 | $2 | $1 | 33/32 | $5.78 | 33/49 | MARKET_RANK_VS_MFL_12 |
| De'Von Achane | RB | 69.2 | $23 | $31 | $25 | 6/10 | $12.14 | 6/21 | MARKET_RANK_VS_MFL_12 |

## Runtime invariants checked

- Historical-demand market values were computed for all 716 players.
- Starter-count VBD was independently recomputed for every player; mismatches: 0.
- Runtime market and bid curves are monotone within position; material legacy identity repairs: 22.
- Initial expected auction purchases: 144.
- Demand-only auction allocation reconciles: $1212 / $1212.
- Bid authority: `classic_starter_vbd_control`.
