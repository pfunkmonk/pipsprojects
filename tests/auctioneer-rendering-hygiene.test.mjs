import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("public application renderers never inject ledger text through innerHTML", async () => {
  const renderers = await Promise.all([
    readFile(new URL("../public/thunder-bowl/auctioneer/auctioneer.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/board/board.mjs", import.meta.url), "utf8"),
  ]);
  for (const source of renderers) {
    assert.doesNotMatch(source, /\.innerHTML\s*=/, "Build UI with textContent/createTextNode so ledger text cannot become markup.");
  }
});
