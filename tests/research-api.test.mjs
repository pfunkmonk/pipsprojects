import test from "node:test";
import assert from "node:assert/strict";
import {
  CBS_NEWS_URLS,
  FBG_NEWS_URL,
  buildResearchSnapshot,
  mergeCbsNewsArchive,
  mergeFootballguysNewsArchive,
  parseFootballguysNews,
  parseCbsPlayerNews,
  parseFootballguysDepthChart,
  researchCacheKeys,
  validateResearchSnapshot,
} from "../netlify/functions/_lib/research-store.mjs";
import researchHandler from "../netlify/functions/thunder-research.mjs";

const teamCodes = ["ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC", "LV", "LAC", "LAR", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SF", "SEA", "TB", "TEN", "WAS"];

function fbgFixture() {
  const teams = teamCodes.map((team, teamIndex) => {
    const rows = ["qb", "rb", "wr", "te", "pk"].map((position) => {
      const players = Array.from({ length: 3 }, (_, index) => `<a href="https://www.footballguys.com/player/${team}+${position}+${index}/Id${teamIndex}${position}${index}" class="player ${index === 0 ? "starter text-success" : "text-secondary"}">${team} ${position.toUpperCase()} Player ${index + 1}${team === "ARI" && position === "rb" && index === 0 ? " (Q)" : ""}</a>`).join(", ");
      return `<li class="depth-chart-pos depth-chart-cat-off depth-chart-pos-${position} depth-chart-fantasy"><span class="pos-label">${position.toUpperCase()}:</span>${players}</li>`;
    }).join("");
    return `<div class="depth-chart col col-12 col-lg-6" id="depth_chart_${team}"><span class="team-header">${team}</span><ul>${rows}</ul></div>`;
  }).join("");
  return `<!doctype html><title>Depth Charts - Footballguys</title><p class="fs-6">last updated August 4 2026</p>${teams}`;
}

function cbsFixture(position, playerName = "Chase Brown") {
  return `<!doctype html><title>NFL Player News</title><h1>NFL Player News</h1><ul id="playerNewsContent"><li><div class="row"><div class="players-annotated"><p><a href="/nfl/players/1/${playerName.toLowerCase().replaceAll(" ", "-")}/fantasy/">${playerName}</a> <span> ${position} | CIN</span></p></div><div class="player-news-desc"><time class="eyebrow">12H ago</time><h4><a href="/fantasy/football/news/${position.toLowerCase()}-update/">Bengals' ${playerName}: Working with starters</a></h4><span class="byline">By RotoWire Staff</span><div class="latest-updates"><p>${playerName} worked with the first unit Tuesday.</p></div></div></div></li></ul>`;
}

function fbgNewsFixture(playerName = "Chase Brown") {
  const stories = Array.from({ length: 12 }, (_, index) => `<a name="${1372500 + index}"></a><a href="news.php?team=cin"><img src="team.svg" /></a><span style="color:#4A8432; font-size:18px">Bengals | ${playerName} update ${index + 1}</span>&nbsp;&nbsp;Mon Aug 10, 0${index % 9}:30 PM<p>Cincinnati Bengals RB ${playerName} worked with the first unit.</p><p><table class="data"><tr><td class="la"><b>Footballguys view</b>: ${playerName} remains a useful fantasy option.</td></tr></table></p><a href="https://example.com/story">Link to story</a><br /><a href="https://www.footballguys.com/player/${playerName.replaceAll(" ", "+")}/TestId" target="_blank">${playerName} player page</a><br /><hr /><p />`).join("");
  return `<!doctype html><title>Latest News - Footballguys</title><b>Footballguys view</b>${stories}`;
}

test("Footballguys parser captures all teams, fantasy depth order, starter, and status", () => {
  const parsed = parseFootballguysDepthChart(fbgFixture());
  assert.equal(parsed.teams, 32);
  assert.equal(parsed.entries.length, 480);
  assert.equal(parsed.updatedText, "last updated August 4 2026");
  const arizonaStarter = parsed.entries.find((entry) => entry.playerName === "ARI RB Player 1");
  assert.deepEqual({ order: arizonaStarter.depthOrder, starter: arizonaStarter.starter, status: arizonaStarter.status }, { order: 1, starter: true, status: "Q" });
});

test("Footballguys news parser preserves player identity, summary, and Footballguys View", () => {
  const parsed = parseFootballguysNews(fbgNewsFixture());
  assert.equal(parsed.length, 12);
  assert.deepEqual(parsed[0].playerNames, ["Chase Brown"]);
  assert.match(parsed[0].description, /first unit/);
  assert.match(parsed[0].footballguysView, /useful fantasy option/);
  assert.equal(new URL(parsed[0].url).origin + new URL(parsed[0].url).pathname + new URL(parsed[0].url).search, FBG_NEWS_URL);
});

test("CBS parser preserves internal summaries and optional source links", () => {
  const [item] = parseCbsPlayerNews(cbsFixture("RB"), "RB");
  assert.equal(item.playerName, "Chase Brown");
  assert.equal(item.ageText, "12H ago");
  assert.match(item.description, /first unit/);
  assert.equal(new URL(item.url).hostname, "www.cbssports.com");
});

test("combined research snapshot is cached, provenance-complete, and value neutral", () => {
  const snapshot = buildResearchSnapshot({ fbgHtml: fbgFixture(), fbgNewsHtml: fbgNewsFixture(), cbsPages: ["QB", "RB", "WR", "TE", "K"].map((position) => cbsFixture(position, `${position} Example`)) }, "2026-08-04T20:00:00Z");
  assert.equal(validateResearchSnapshot(snapshot), snapshot);
  assert.equal(snapshot.modelEffect, "none");
  assert.equal(snapshot.depthChart.teamCount, 32);
  assert.equal(snapshot.schemaVersion, 3);
  assert.equal(snapshot.fbgNews.currentItemCount, 12);
  assert.equal(snapshot.cbsNews.archiveItemCount, 5);
  assert.equal(snapshot.cbsNews.sourceUrls.length, CBS_NEWS_URLS.length);
  assert.deepEqual(researchCacheKeys("2026-08-04T20:01:00Z"), researchCacheKeys("2026-08-04T20:29:59Z"));
  assert.notDeepEqual(researchCacheKeys("2026-08-04T20:29:59Z"), researchCacheKeys("2026-08-04T20:30:00Z"));
  snapshot.cbsNews.items[0].recommendedBid = 44;
  assert.throws(() => validateResearchSnapshot(snapshot), /recommendedBid/);
});

test("CBS news accumulates into a bounded rolling archive instead of forgetting earlier players", () => {
  const first = parseCbsPlayerNews(cbsFixture("RB", "Chase Brown"), "RB")[0];
  const second = { ...parseCbsPlayerNews(cbsFixture("RB", "James Cook"), "RB")[0], id: "james-cook-news" };
  const firstCapture = mergeCbsNewsArchive([first], [], "2026-08-04T20:00:00Z");
  const secondCapture = mergeCbsNewsArchive([second], firstCapture, "2026-08-05T20:00:00Z");
  assert.deepEqual(secondCapture.map((item) => item.playerName), ["James Cook", "Chase Brown"]);
  assert.equal(secondCapture[1].firstSeenAt, "2026-08-04T20:00:00Z");
  assert.equal(secondCapture[1].lastSeenAt, "2026-08-04T20:00:00Z");
});

test("Footballguys news uses the same bounded rolling archive contract", () => {
  const [first] = parseFootballguysNews(fbgNewsFixture("Chase Brown"));
  const [second] = parseFootballguysNews(fbgNewsFixture("James Cook"));
  second.id = "fbg-james-cook-news";
  const firstCapture = mergeFootballguysNewsArchive([first], [], "2026-08-04T20:00:00Z");
  const secondCapture = mergeFootballguysNewsArchive([second], firstCapture, "2026-08-05T20:00:00Z");
  assert.deepEqual(secondCapture.map((item) => item.playerNames[0]), ["James Cook", "Chase Brown"]);
  assert.equal(secondCapture[1].firstSeenAt, "2026-08-04T20:00:00Z");
  assert.equal(secondCapture[1].lastSeenAt, "2026-08-04T20:00:00Z");
});

test("the internal research endpoint rejects unauthenticated requests before external work", async () => {
  const response = await researchHandler(new Request("https://pipsprojects.com/api/thunder-bowl/research"));
  assert.equal(response.status, 401);
});
