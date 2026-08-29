import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateAuctioneerOperationalEvents } from "../netlify/functions/_lib/ledger-store.mjs";

const boardSource = await readFile(new URL("../public/thunder-bowl/board/board.mjs", import.meta.url), "utf8");

function stagedPlayer(player) {
  return [{
    id: "nomination-test",
    type: "NOMINATION_STAGED",
    createdAt: "2026-08-29T16:00:00.000Z",
    actorLabel: "Auctioneer",
    player,
  }];
}

test("the canonical staged-nomination contract carries a valid bye week to the public board", () => {
  const [event] = validateAuctioneerOperationalEvents(stagedPlayer({
    id: "fbg:GibbJa00",
    name: "Jahmyr Gibbs",
    position: "RB",
    nflTeam: "DET",
    byeWeek: 8,
  }));
  assert.deepEqual(event.player, {
    id: "fbg:GibbJa00",
    name: "Jahmyr Gibbs",
    position: "RB",
    nflTeam: "DET",
    byeWeek: 8,
  });
});

test("legacy staged nominations remain readable and malformed bye weeks fail closed", () => {
  const [legacy] = validateAuctioneerOperationalEvents(stagedPlayer({
    id: "legacy-player",
    name: "Legacy Player",
    position: "TE",
    nflTeam: "FA",
  }));
  assert.equal(legacy.player.byeWeek, undefined);
  assert.throws(() => validateAuctioneerOperationalEvents(stagedPlayer({
    id: "bad-bye",
    name: "Bad Bye",
    position: "WR",
    nflTeam: "GB",
    byeWeek: 19,
  })), /bye week is invalid/i);
});

test("the large public nomination card renders player, position, NFL team, and bye", () => {
  assert.match(boardSource, /snapshot\.stagedNomination\.name/);
  assert.match(boardSource, /snapshot\.stagedNomination\.position/);
  assert.match(boardSource, /snapshot\.stagedNomination\.nflTeam/);
  assert.match(boardSource, /BYE \$\{snapshot\.stagedNomination\.byeWeek\}/);
});
