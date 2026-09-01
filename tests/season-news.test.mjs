import test from "node:test";
import assert from "node:assert/strict";

import { collectLatestPlayerNews, safeNewsUrl } from "../public/thunder-bowl/season/season-news.mjs";

test("player news combines exact RotoWire, CBS, and Footballguys matches newest first", () => {
  const news = {
    items: [
      { title: "Caleb Williams: Full practice", description: "Williams practiced in full.", publishedAt: "2026-08-31T18:00:00Z", url: "https://www.rotowire.com/football/player/caleb-williams-17000" },
      { title: "Caleb Johnson: Limited", description: "A different player.", publishedAt: "2026-08-31T20:00:00Z", url: "https://www.rotowire.com/football/player/caleb-johnson-17001" },
    ],
  };
  const research = {
    cbsNews: { items: [{ playerName: "Caleb Williams", title: "Williams starts Week 1", description: "Chicago confirmed the starter.", lastSeenAt: "2026-08-31T19:00:00Z", url: "https://www.cbssports.com/fantasy/football/news/caleb-williams-update/" }] },
    fbgNews: { items: [{ playerNames: ["Caleb Williams"], title: "Bears | Caleb Williams update", description: "Working with the first team.", footballguysView: "Williams remains a strong fantasy starter.", lastSeenAt: "2026-08-31T17:00:00Z", url: "https://www.footballguys.com/player/Caleb-Williams" }] },
  };
  const items = collectLatestPlayerNews("Caleb Williams", news, research);
  assert.deepEqual(items.map((item) => item.source), ["CBS", "RotoWire", "Footballguys"]);
  assert.equal(items.length, 3);
  assert.match(items[2].summary, /strong fantasy starter/);
});

test("player news accepts suffix differences but rejects unsafe story links", () => {
  const news = { items: [{ title: "Marvin Harrison Jr.: Cleared", description: "Cleared to play.", publishedAt: "2026-08-31T18:00:00Z", url: "javascript:alert(1)" }] };
  const items = collectLatestPlayerNews("Marvin Harrison", news, null);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, null);
  assert.equal(safeNewsUrl("http://example.com/story"), null);
});
