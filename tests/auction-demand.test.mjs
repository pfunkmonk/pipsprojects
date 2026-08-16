import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { replayDraft } from "../public/thunder-bowl/state-engine.mjs";
import {
  HISTORICAL_AUCTION_DEMAND,
  calculateAuctionDemandMarket,
  expectedAdditionalPlayers,
} from "../public/thunder-bowl/auction-demand.mjs";

const pack = JSON.parse(await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8"));
const marketBacktest = JSON.parse(await readFile(new URL("../reports/thunder-bowl/auction-market-position-calibration-20260808.json", import.meta.url), "utf8"));

test("historical demand encodes 48 usable team-seasons without assuming 14 purchases per team", () => {
  assert.deepEqual(HISTORICAL_AUCTION_DEMAND.seasons, [2021, 2022, 2023, 2025]);
  assert.equal(HISTORICAL_AUCTION_DEMAND.teamSeasons, 48);
  assert.equal(expectedAdditionalPlayers(HISTORICAL_AUCTION_DEMAND, "RB", 0), 179 / 48);
  assert.equal(expectedAdditionalPlayers(HISTORICAL_AUCTION_DEMAND, "WR", 0), 166 / 48);
  assert.equal(expectedAdditionalPlayers(HISTORICAL_AUCTION_DEMAND, "RB", 2), 83 / 48);
  assert.equal(expectedAdditionalPlayers(HISTORICAL_AUCTION_DEMAND, "WR", 2), 70 / 48);
  assert.deepEqual(HISTORICAL_AUCTION_DEMAND.priceProfile.seasons, [2012, 2015, 2017, 2018, 2019, 2021, 2022, 2023, 2024, 2025]);
  assert.equal(HISTORICAL_AUCTION_DEMAND.priceProfile.purchaseRows, 1252);
  assert.equal(HISTORICAL_AUCTION_DEMAND.priceProfile.recencyHalfLifeSeasons, 8);
  assert.equal(HISTORICAL_AUCTION_DEMAND.marketBlend.historicalPriceCurveWeight, 0.6);
});

test("runtime blend evidence matches the canonical matched-purchase backtest", () => {
  assert.equal(HISTORICAL_AUCTION_DEMAND.marketBlend.sourceAuctionPurchases, marketBacktest.developmentPurchases);
  assert.equal(HISTORICAL_AUCTION_DEMAND.marketBlend.evaluatedAuctionPurchases, marketBacktest.developmentMatchedPurchases);
  assert.deepEqual(
    {
      classicPriceMae: HISTORICAL_AUCTION_DEMAND.marketBlend.classicPriceMae,
      globalDemandPriceMae: HISTORICAL_AUCTION_DEMAND.marketBlend.globalDemandPriceMae,
      positionBudgetPriceMae: HISTORICAL_AUCTION_DEMAND.marketBlend.positionBudgetPriceMae,
      blendedPriceMae: HISTORICAL_AUCTION_DEMAND.marketBlend.blendedPriceMae,
    },
    {
      classicPriceMae: marketBacktest.developmentMatchedWeightedMae.classic,
      globalDemandPriceMae: marketBacktest.developmentMatchedWeightedMae.globalDemand,
      positionBudgetPriceMae: marketBacktest.developmentMatchedWeightedMae.positionBudget,
      blendedPriceMae: marketBacktest.developmentMatchedWeightedMae.blendedPositionBudget,
    },
  );
  assert.deepEqual(
    HISTORICAL_AUCTION_DEMAND.marketBlend.coarseBaselineInterval,
    {
      developmentRows: marketBacktest.conformalCalibration.developmentRows,
      targetCoverage: marketBacktest.conformalCalibration.coverageTarget,
      leaveOneSeasonOutCoverage: marketBacktest.conformalCalibration.leaveOneSeasonOut.coverage80,
      globalRadius: marketBacktest.conformalCalibration.globalRadius80,
      positionRadius: Object.fromEntries(Object.entries(marketBacktest.conformalCalibration.positionRadius80).map(([position, row]) => [position, row.radius])),
      role: "baseline price safety band only; not WTP-challenger calibration",
    },
  );
});

test("initial auction curve uses historical roster demand and preserves all room dollars", () => {
  const market = calculateAuctionDemandMarket(pack, replayDraft([]));
  assert.equal(market.modelEffect, "validated_historical_auction_market_only");
  assert.equal(market.bidAuthority, "classic_starter_vbd_control");
  assert.equal(market.expectedRemainingPurchases, 144);
  assert.equal(market.positionImpacts.QB.replacementRank, 18);
  assert.equal(market.positionImpacts.RB.replacementRank, 45);
  assert.equal(market.positionImpacts.WR.replacementRank, 42);
  assert.equal(market.positionImpacts.TE.replacementRank, 15);
  assert.equal(market.positionImpacts.K.replacementRank, 12);
  assert.equal(market.positionImpacts.DST.replacementRank, 12);
  assert.deepEqual(market.positionBudgets, { QB: 107, RB: 531, WR: 411, TE: 110, K: 22, DST: 31 });
  assert.equal(Object.values(market.positionBudgets).reduce((sum, value) => sum + value, 0), market.remainingRoomDollars);
  assert.equal(market.demandAllocatedRoomDollars, market.remainingRoomDollars);
});

test("auction values and bid ceilings are monotone by projected points within every position", () => {
  const market = calculateAuctionDemandMarket(pack, replayDraft([]));
  for (const position of Object.keys(pack.leagueConfig.starterRequirements)) {
    const rows = pack.players
      .filter((player) => player.position === position)
      .sort((left, right) => right.projectedPoints - left.projectedPoints || left.id.localeCompare(right.id));
    for (let index = 1; index < rows.length; index += 1) {
      assert.ok(
        market.valuesByPlayerId[rows[index - 1].id] >= market.valuesByPlayerId[rows[index].id],
        `${rows[index - 1].name} cannot be worth less than lower-projected ${rows[index].name} at ${position}`,
      );
      assert.ok(
        market.bidCeilingsByPlayerId[rows[index - 1].id] >= market.bidCeilingsByPlayerId[rows[index].id],
        `${rows[index - 1].name} cannot have a lower bid ceiling than lower-projected ${rows[index].name} at ${position}`,
      );
    }
  }
});

test("replacement-level lineup VBD no longer collapses viable backups to arbitrary one-dollar values", () => {
  const market = calculateAuctionDemandMarket(pack, replayDraft([]));
  const david = pack.players.find((player) => player.name === "David Montgomery");
  const outzs = pack.players.find((player) => player.name === "Robbie Ouzts");
  const mclaurin = pack.players.find((player) => player.name === "Terry McLaurin");
  assert.ok(Math.abs(david.vbd) <= 5);
  assert.ok(market.valuesByPlayerId[david.id] >= 5);
  assert.ok(market.valuesByPlayerId[david.id] > market.valuesByPlayerId[outzs.id]);
  assert.ok(market.valuesByPlayerId[mclaurin.id] > 1);
});

test("position spending prevents DST inflation and repairs legacy player-identity dollar anomalies", () => {
  const market = calculateAuctionDemandMarket(pack, replayDraft([]));
  const denver = pack.players.find((player) => player.name === "Denver Broncos");
  const houston = pack.players.find((player) => player.name === "Houston Texans");
  const ameer = pack.players.find((player) => player.name === "Ameer Abdullah");
  const gibbs = pack.players.find((player) => player.name === "Jahmyr Gibbs");

  assert.equal(market.valuesByPlayerId[denver.id], 5);
  assert.ok(market.valuesByPlayerId[houston.id] >= 3 && market.valuesByPlayerId[houston.id] <= 6);
  assert.equal(market.valuesByPlayerId[ameer.id], 1);
  assert.equal(market.bidCeilingsByPlayerId[ameer.id], 1);
  assert.ok(market.valuesByPlayerId[gibbs.id] >= 30);
  assert.ok(market.valuesByPlayerId[gibbs.id] <= market.bidCeilingsByPlayerId[gibbs.id]);
  assert.equal(market.bidCeilingsByPlayerId[gibbs.id], gibbs.maxBid);
});
