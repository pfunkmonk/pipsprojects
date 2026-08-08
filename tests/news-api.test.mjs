import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNewsSnapshot,
  mergeNewsArchive,
  newsCacheKeys,
  parseRotoWireNews,
  validateNewsSnapshot,
} from "../netlify/functions/_lib/news-store.mjs";
import newsHandler from "../netlify/functions/thunder-news.mjs";

const fixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>RotoWire.com Latest NFL News</title>
  <item>
    <guid>nfl-gibbs-1</guid>
    <title>Jahmyr Gibbs: Limited by back issue</title>
    <link>https://www.rotowire.com//football/player/jahmyr-gibbs-16609</link>
    <description>Gibbs was limited during individual work &amp; remains day-to-day.</description>
    <pubDate>Mon, 03 Aug 2026 3:44:00 PM PDT</pubDate>
  </item>
  <item>
    <guid>nfl-laporta-1</guid>
    <title><![CDATA[Sam LaPorta: Working with first team]]></title>
    <link>https://www.rotowire.com/football/player/sam-laporta-16874</link>
    <description><![CDATA[LaPorta remained with the starters Monday.]]></description>
    <pubDate>Mon, 03 Aug 2026 2:20:00 PM PDT</pubDate>
  </item>
</channel></rss>`;

test("RotoWire RSS parser preserves exact source-linked player news", () => {
  const items = parseRotoWireNews(fixture);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Jahmyr Gibbs: Limited by back issue");
  assert.equal(items[0].description, "Gibbs was limited during individual work & remains day-to-day.");
  assert.equal(new URL(items[0].url).hostname, "www.rotowire.com");
  assert.equal(new URL(items[0].url).pathname, "/football/player/jahmyr-gibbs-16609");
  assert.equal(items[1].title, "Sam LaPorta: Working with first team");
  assert.match(items[0].publishedAt, /^2026-08-03T/);
});

test("news snapshot is provenance-complete, cached in ten-minute buckets, and value-neutral", () => {
  const snapshot = buildNewsSnapshot(fixture, "2026-08-04T04:15:00Z");
  assert.equal(validateNewsSnapshot(snapshot), snapshot);
  assert.equal(snapshot.modelEffect, "none");
  assert.equal(snapshot.refreshMinutes, 10);
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.archiveItemCount, 2);
  assert.match(snapshot.rawSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(newsCacheKeys("2026-08-04T04:15:00Z"), newsCacheKeys("2026-08-04T04:19:59Z"));
  assert.notDeepEqual(newsCacheKeys("2026-08-04T04:15:00Z"), newsCacheKeys("2026-08-04T04:20:00Z"));
  for (const item of snapshot.items) {
    for (const forbidden of ["projectedPoints", "vbd", "intrinsicValue", "marketValue", "maxBid", "keeperValue", "recommendedBid"]) {
      assert.equal(forbidden in item, false);
    }
  }
});

test("RotoWire items accumulate across refreshes for the draft-morning archive", () => {
  const first = parseRotoWireNews(fixture)[0];
  const later = { ...parseRotoWireNews(fixture)[1], id: "later-item", publishedAt: "2026-08-04T20:00:00Z" };
  const archived = mergeNewsArchive([later], [first], "2026-08-04T21:00:00Z");
  assert.deepEqual(archived.map((item) => item.id), ["later-item", "nfl-gibbs-1"]);
});

test("news validation rejects hostile links and value-bearing payloads", () => {
  const hostile = buildNewsSnapshot(fixture, "2026-08-04T04:15:00Z");
  hostile.items[0].url = "https://example.com/not-the-source";
  assert.throws(() => validateNewsSnapshot(hostile), /unexpected link host/);

  const valueBearing = buildNewsSnapshot(fixture, "2026-08-04T04:15:00Z");
  valueBearing.items[0].recommendedBid = 99;
  assert.throws(() => validateNewsSnapshot(valueBearing), /attempted to supply recommendedBid/);
});

test("the player-news endpoint rejects unauthenticated requests before external work", async () => {
  const response = await newsHandler(new Request("https://pipsprojects.com/api/thunder-bowl/news"));
  assert.equal(response.status, 401);
});
