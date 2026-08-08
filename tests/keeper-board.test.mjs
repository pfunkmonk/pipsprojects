import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildKeeperBoard, buildKeeperTradeMarket, keeperBoardCsv, keeperContractTenure, keeperTradeScenario } from "../public/thunder-bowl/keeper-board.mjs";

const pack = JSON.parse(await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8"));

function candidate(playerId, playerName, teamId, surplus, keeperYear = 2) {
  return { playerId, playerName, position: "RB", teamId, priorSalary: 1, keeperSalary: 2, keeperYear, marketValue: Math.max(1, surplus + 2), surplus, evidenceStatus: "test evidence" };
}

test("keeper contract tenure states used and remaining years explicitly", () => {
  assert.deepEqual(keeperContractTenure(1), {
    upcomingYear: 1,
    maxYears: 3,
    yearsUsed: 0,
    yearsLeft: 3,
    eligible: true,
    yearLabel: "Year 1 of 3",
    shortLabel: "0 used · 3 left",
  });
  assert.equal(keeperContractTenure(2).yearsLeft, 2);
  assert.deepEqual(keeperContractTenure(3), {
    upcomingYear: 3,
    maxYears: 3,
    yearsUsed: 2,
    yearsLeft: 1,
    eligible: true,
    yearLabel: "Year 3 of 3",
    shortLabel: "2 used · 1 left",
  });
  assert.deepEqual(keeperContractTenure(4), {
    upcomingYear: 4,
    maxYears: 3,
    yearsUsed: 3,
    yearsLeft: 0,
    eligible: false,
    yearLabel: "Contract expired",
    shortLabel: "3 used · 0 left",
  });
});

test("trade range uses incremental top-two portfolio surplus for both teams", () => {
  const synthetic = {
    schemaVersion: 1,
    packId: "keeper-board-test",
    asOf: "2026-08-04T05:00:00.000Z",
    leagueConfig: { teams: [{ id: "seller", name: "Seller" }, { id: "buyer", name: "Buyer" }] },
    keeperCandidates: [
      candidate("target", "Target", "seller", 10),
      candidate("seller-two", "Seller Two", "seller", 9),
      candidate("seller-alt", "Seller Alt", "seller", 1),
      candidate("buyer-one", "Buyer One", "buyer", 0),
    ],
  };
  const row = buildKeeperBoard(synthetic).find((item) => item.playerId === "target");
  assert.equal(row.sellerFloor, 9);
  assert.equal(row.bestBuyerCeiling, 9);
  assert.equal(row.negotiable, true);
  assert.equal(row.tradeRead, "$9-$9 current cap range");
  assert.deepEqual(row.bestBuyers, ["Buyer"]);
});

test("forced-pool contracts and negative-surplus players never acquire invented trade value", () => {
  const rows = buildKeeperBoard(pack);
  const forced = rows.find((row) => row.currentTeamId === "dogs-of-war" && row.playerName === "James Cook III");
  assert.equal(forced.eligible, false);
  assert.equal(forced.strategy, "Forced pool");
  assert.equal(forced.bestBuyerCeiling, 0);
  assert.equal(forced.tradeRead, "Ineligible - must return to pool");
  for (const row of rows.filter((item) => item.surplus <= 0)) assert.equal(row.bestBuyerCeiling, 0);
});

test("the current board covers every source candidate and preserves value/ledger isolation", () => {
  const rows = buildKeeperBoard(pack);
  assert.equal(rows.length, pack.keeperCandidates.length);
  assert.equal(new Set(rows.map((row) => row.currentTeamId)).size, 12);
  assert.ok(rows.every((row) => row.modelEffect === "none" && row.ledgerEffect === "none"));
  const dogs = rows.filter((row) => row.currentTeamId === "dogs-of-war");
  assert.equal(dogs[0].playerName, "Chase Brown");
  assert.equal(dogs[0].strategy, "Current top-two keeper");
  assert.equal(dogs[0].contractYearsUsed, 2);
  assert.equal(dogs[0].contractYearsLeft, 1);
  assert.equal(dogs[0].contractYearLabel, "Year 3 of 3");
  assert.equal(dogs[1].playerName, "DJ Moore");
  assert.equal(dogs[1].strategy, "Current top-two keeper");
});

test("CSV is complete, quoted, and spreadsheet-formula safe", () => {
  const rows = buildKeeperBoard(pack);
  rows[0] = { ...rows[0], playerName: "=HYPERLINK(\"bad\")", evidenceStatus: "comma, quote \" and newline\nproof" };
  const csv = keeperBoardCsv(rows);
  assert.equal(csv.split("\r\n").filter(Boolean).length, rows.length + 1);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /"comma, quote "" and newline\nproof"/);
  assert.match(csv, /Best Buyer Ceiling/);
  assert.match(csv, /Contract Years Used,Eligible Years Left,Contract Status/);
  assert.match(csv, /Pack As Of/);
});

test("trade market ranks a third-keeper acquisition against Dogs of War's current second keeper", () => {
  const synthetic = {
    schemaVersion: 1,
    packId: "keeper-market-test",
    asOf: "2026-08-04T05:00:00.000Z",
    leagueConfig: {
      teams: [
        { id: "dogs-of-war", name: "Dogs of War" },
        { id: "deep-roster", name: "Deep Roster" },
        { id: "empty-roster", name: "Empty Roster" },
      ],
    },
    keeperCandidates: [
      { ...candidate("dogs-one", "Chase Brown", "dogs-of-war", 18), keeperSalary: 3, marketValue: 21 },
      { ...candidate("dogs-two", "James Cook", "dogs-of-war", 8), keeperSalary: 11, marketValue: 19 },
      { ...candidate("dogs-three", "Dogs Trade Bait", "dogs-of-war", 5), keeperSalary: 10, marketValue: 15 },
      { ...candidate("deep-one", "Deep One", "deep-roster", 25), keeperSalary: 5, marketValue: 30 },
      { ...candidate("deep-two", "Deep Two", "deep-roster", 20), keeperSalary: 7, marketValue: 27 },
      { ...candidate("target", "Third Keeper Target", "deep-roster", 15), keeperSalary: 10, marketValue: 25 },
      candidate("empty-one", "Empty One", "empty-roster", 0),
      candidate("empty-two", "Empty Two", "empty-roster", 0),
      candidate("empty-three", "Empty Three", "empty-roster", 0),
    ],
  };
  const market = buildKeeperTradeMarket(synthetic);
  const target = market.acquire.find((row) => row.playerId === "target");
  assert.equal(market.currentPortfolioValue, 26);
  assert.equal(market.completeTradeDiscovery, true);
  assert.deepEqual(market.currentPortfolio.map((row) => row.playerName), ["Chase Brown", "James Cook"]);
  assert.equal(target.ownerKeeperRank, 3);
  assert.equal(target.contractYearLabel, "Year 2 of 3");
  assert.equal(target.contractYearsUsed, 1);
  assert.equal(target.contractYearsLeft, 2);
  assert.equal(target.offerFloor, 1);
  assert.equal(target.offerCeiling, 6);
  assert.equal(target.incrementalSurplus, 7);
  assert.equal(target.displacedPlayer.playerName, "James Cook");
  const twoDollarDeal = keeperTradeScenario(target, 2);
  assert.deepEqual(twoDollarDeal, {
    capAmount: 2,
    allInCost: 12,
    playerNetSurplus: 13,
    portfolioGain: 5,
    withinRange: true,
  });
});

test("trade-away market finds surplus outside Dogs of War's top two and names the best buyer", () => {
  const synthetic = {
    schemaVersion: 1,
    packId: "keeper-market-sell-test",
    asOf: "2026-08-04T05:00:00.000Z",
    leagueConfig: {
      teams: [
        { id: "dogs-of-war", name: "Dogs of War" },
        { id: "empty-roster", name: "Empty Roster" },
      ],
    },
    keeperCandidates: [
      candidate("dogs-one", "Dogs One", "dogs-of-war", 18),
      candidate("dogs-two", "Dogs Two", "dogs-of-war", 8),
      { ...candidate("dogs-three", "Dogs Trade Bait", "dogs-of-war", 5), keeperSalary: 10, marketValue: 15 },
      candidate("empty-one", "Empty One", "empty-roster", 0),
    ],
  };
  const market = buildKeeperTradeMarket(synthetic);
  const tradeBait = market.tradeAway.find((row) => row.playerId === "dogs-three");
  assert.equal(tradeBait.protectedKeeper, false);
  assert.equal(market.completeTradeDiscovery, false);
  assert.equal(tradeBait.sellerPortfolioLoss, 0);
  assert.equal(tradeBait.offerFloor, 1);
  assert.equal(tradeBait.offerCeiling, 4);
  assert.equal(tradeBait.bestBuyerTeamName, "Empty Roster");
  assert.equal(keeperTradeScenario(tradeBait, 2).portfolioGain, 2);
  assert.ok(market.acquire.every((row) => row.modelEffect === "none" && row.ledgerEffect === "none"));
  assert.ok(market.tradeAway.every((row) => row.modelEffect === "none" && row.ledgerEffect === "none"));
});
