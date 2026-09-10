import test from "node:test";
import assert from "node:assert/strict";

import { buildTeamNewsFeed, collectLatestPlayerNews, collectPlayerNewsHistory, safeNewsUrl } from "../public/thunder-bowl/season/season-news.mjs";

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

test("player news history is not truncated while the compact player popup remains bounded", () => {
  const news = { items: Array.from({ length: 14 }, (_, index) => ({
    id: `story-${index}`,
    title: `Caleb Williams: Update ${index}`,
    description: `Saved update ${index}.`,
    publishedAt: `2026-08-${String(index + 1).padStart(2, "0")}T18:00:00Z`,
    url: `https://www.rotowire.com/football/player/caleb-williams-${index}`,
  })) };
  const history = collectPlayerNewsHistory("Caleb Williams", news);
  assert.equal(history.length, 14);
  assert.equal(history[0].title, "Caleb Williams: Update 13");
  assert.equal(collectLatestPlayerNews("Caleb Williams", news).length, 10);
});

test("team news includes only current roster players, groups shared stories, and sorts newest first", () => {
  const roster = [
    { playerId: "caleb", name: "Caleb Williams", position: "QB", nflTeam: "CHI" },
    { playerId: "rome", name: "Rome Odunze", position: "WR", nflTeam: "CHI" },
  ];
  const news = { items: [
    { id: "caleb", title: "Caleb Williams: Ready", description: "Ready for Week 1.", publishedAt: "2026-09-01T18:00:00Z", url: "https://www.rotowire.com/football/player/caleb-williams-1" },
    { id: "caleb-earlier", title: "Caleb Williams: Practiced", description: "Practiced earlier in the week.", publishedAt: "2026-08-31T18:00:00Z", url: "https://www.rotowire.com/football/player/caleb-williams-1" },
    { id: "other", title: "James Cook: Ready", description: "Not on Dogs of War.", publishedAt: "2026-09-01T20:00:00Z", url: "https://www.rotowire.com/football/player/james-cook-1" },
  ] };
  const shared = { id: "fbg-shared", playerNames: ["Caleb Williams", "Rome Odunze"], title: "Bears | Offense update", description: "Both players practiced.", footballguysView: "Both remain on track.", firstSeenAt: "2026-09-01T19:00:00Z", lastSeenAt: "2026-09-01T21:00:00Z", url: "https://www.footballguys.com/news.php?pos=sp#1" };
  const feed = buildTeamNewsFeed(roster, news, { fbgNews: { items: [shared] }, cbsNews: { items: [] } });
  assert.equal(feed.length, 3);
  assert.equal(feed[0].title, "Bears | Offense update");
  assert.deepEqual(feed[0].players.map((player) => player.name), ["Caleb Williams", "Rome Odunze"]);
  assert.equal(feed[1].players[0].name, "Caleb Williams");
  assert.equal(feed[2].title, "Caleb Williams: Practiced");
  assert.equal(feed.some((item) => /James Cook/.test(item.title)), false);
});
