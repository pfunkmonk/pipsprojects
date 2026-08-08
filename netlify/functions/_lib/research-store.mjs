import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const STORE_NAME = "thunder-bowl-2026-research";
const SCHEMA_VERSION = 2;
const CACHE_MINUTES = 30;
const CBS_ARCHIVE_WINDOW_DAYS = 45;
const CBS_ARCHIVE_MAX_ITEMS = 1_500;
export const FBG_DEPTH_URL = "https://www.footballguys.com/depth-charts";
export const CBS_NEWS_URLS = ["QB", "RB", "WR", "TE", "K"].map((position) => `https://www.cbssports.com/fantasy/football/players/news/${position}/`);

function store() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code.replace(/^x/i, ""), /^x/i.test(code) ? 16 : 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteSourceUrl(value, source) {
  const url = new URL(value, source);
  if (url.protocol !== "https:") throw new Error("Research source returned a non-HTTPS link.");
  return url.toString();
}

function safeUrl(value, hosts) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !hosts.includes(url.hostname)) throw new Error("Research source returned an unexpected link host.");
  return url.toString();
}

export function parseFootballguysDepthChart(html) {
  if (typeof html !== "string" || !/<title>Depth Charts - Footballguys<\/title>/i.test(html) || !/id="depth_chart_ARI"/i.test(html)) {
    throw new Error("Footballguys depth-chart response failed its page contract.");
  }
  const updatedText = decodeHtml(html.match(/<p class="fs-6">(last updated[^<]+)<\/p>/i)?.[1]);
  const entries = [];
  const teams = new Set();
  for (const teamMatch of html.matchAll(/<div class="depth-chart[^"]*" id="depth_chart_([A-Z]{2,3})">([\s\S]*?)<\/ul><\/div>/gi)) {
    const nflTeam = teamMatch[1].toUpperCase();
    teams.add(nflTeam);
    const teamBlock = teamMatch[2];
    for (const positionMatch of teamBlock.matchAll(/<li class="depth-chart-pos[^"]*depth-chart-pos-([a-z]+)[^"]*depth-chart-fantasy[^"]*">([\s\S]*?)<\/li>/gi)) {
      const position = positionMatch[1].toUpperCase() === "PK" ? "K" : positionMatch[1].toUpperCase();
      if (!["QB", "RB", "WR", "TE", "K"].includes(position)) continue;
      let depthOrder = 0;
      for (const playerMatch of positionMatch[2].matchAll(/<a href="([^"]+)" class="([^"]*\bplayer\b[^"]*)">([\s\S]*?)<\/a>/gi)) {
        depthOrder += 1;
        const label = decodeHtml(playerMatch[3]);
        const statusMatch = label.match(/\s+\((IR-R|PUP|NFI|SUS|IR|Q|D|O|EX)\)$/i);
        const playerName = statusMatch ? label.slice(0, statusMatch.index).trim() : label;
        if (!playerName || playerName.length > 120) throw new Error("Footballguys depth chart contains invalid player text.");
        entries.push({
          playerName,
          nflTeam,
          position,
          depthOrder,
          starter: /\bstarter\b/i.test(playerMatch[2]),
          status: statusMatch?.[1]?.toUpperCase() || null,
          url: safeUrl(absoluteSourceUrl(playerMatch[1], FBG_DEPTH_URL), ["footballguys.com", "www.footballguys.com"]),
        });
      }
    }
  }
  if (teams.size !== 32 || entries.length < 400 || entries.length > 1_500) throw new Error(`Footballguys depth chart has unexpected coverage (${teams.size} teams, ${entries.length} fantasy players).`);
  const identities = new Set(entries.map((entry) => `${entry.nflTeam}|${entry.position}|${entry.playerName.toLowerCase()}`));
  if (identities.size !== entries.length) throw new Error("Footballguys depth chart contains duplicate fantasy-player identities.");
  return { updatedText, teams: teams.size, entries };
}

export function parseCbsPlayerNews(html, position) {
  if (typeof html !== "string" || !/id="playerNewsContent"/i.test(html) || !/NFL Player News/i.test(html)) {
    throw new Error(`CBS ${position} player-news response failed its page contract.`);
  }
  const items = [];
  for (const match of html.matchAll(/<li>\s*<div class="row">([\s\S]*?)<\/li>/gi)) {
    const block = match[1];
    const identity = block.match(/<div class="players-annotated">[\s\S]*?<p><a href="([^"]+)">([\s\S]*?)<\/a>\s*<span>\s*([A-Z]+)\s*\|\s*([A-Z]{2,3})\s*<\/span>/i);
    const headline = block.match(/<h4><a href="([^"]+)">([\s\S]*?)<\/a><\/h4>/i);
    const update = block.match(/<div class="latest-updates">([\s\S]*?)<\/div>/i);
    if (!identity || !headline || !update) continue;
    const playerName = decodeHtml(identity[2]);
    const title = decodeHtml(headline[2]);
    const description = decodeHtml(update[1]).slice(0, 1_600);
    const ageText = decodeHtml(block.match(/<time class="eyebrow">([\s\S]*?)<\/time>/i)?.[1]);
    const byline = decodeHtml(block.match(/<span class="byline">([\s\S]*?)<\/span>/i)?.[1]) || "CBS Sports";
    const url = safeUrl(absoluteSourceUrl(headline[1], "https://www.cbssports.com"), ["cbssports.com", "www.cbssports.com"]);
    if (!playerName || playerName.length > 120 || !title || title.length > 240 || !description || !ageText) continue;
    items.push({
      id: createHash("sha256").update(url).digest("hex").slice(0, 24),
      playerName,
      position: identity[3],
      nflTeam: identity[4],
      title,
      description,
      ageText,
      byline,
      url,
    });
  }
  if (!items.length || items.length > 30) throw new Error(`CBS ${position} player-news response has unexpected item coverage.`);
  return items;
}

export function mergeCbsNewsArchive(currentItems, priorItems = [], capturedAt = new Date().toISOString()) {
  const capturedTimestamp = Date.parse(capturedAt);
  if (!Number.isFinite(capturedTimestamp) || !Array.isArray(currentItems) || !Array.isArray(priorItems)) throw new Error("CBS news archive input is invalid.");
  const oldestAllowed = capturedTimestamp - CBS_ARCHIVE_WINDOW_DAYS * 86_400_000;
  const priorById = new Map(priorItems.map((item) => [item.id, item]));
  const merged = new Map();
  for (const item of currentItems) {
    const prior = priorById.get(item.id);
    merged.set(item.id, {
      ...item,
      firstSeenAt: Number.isFinite(Date.parse(prior?.firstSeenAt)) ? prior.firstSeenAt : capturedAt,
      lastSeenAt: capturedAt,
    });
  }
  for (const item of priorItems) {
    if (merged.has(item.id)) continue;
    const lastSeenAt = Date.parse(item.lastSeenAt || item.firstSeenAt || "");
    if (!Number.isFinite(lastSeenAt) || lastSeenAt < oldestAllowed) continue;
    merged.set(item.id, item);
  }
  return [...merged.values()]
    .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt) || left.playerName.localeCompare(right.playerName))
    .slice(0, CBS_ARCHIVE_MAX_ITEMS);
}

export function buildResearchSnapshot({ fbgHtml, cbsPages, priorSnapshot = null }, capturedAt = new Date().toISOString()) {
  if (!Number.isFinite(Date.parse(capturedAt)) || !Array.isArray(cbsPages) || cbsPages.length !== CBS_NEWS_URLS.length) throw new Error("Research snapshot input is incomplete.");
  const depth = parseFootballguysDepthChart(fbgHtml);
  const news = cbsPages.flatMap((page, index) => parseCbsPlayerNews(page, ["QB", "RB", "WR", "TE", "K"][index]));
  const currentNews = [...new Map(news.map((item) => [item.id, item])).values()];
  const archivedNews = mergeCbsNewsArchive(currentNews, priorSnapshot?.cbsNews?.items || [], capturedAt);
  return {
    schemaVersion: SCHEMA_VERSION,
    source: "Footballguys depth charts and CBS Sports player news",
    authority: "supplemental role and news evidence; no value effect",
    capturedAt,
    refreshMinutes: CACHE_MINUTES,
    modelEffect: "none",
    depthChart: {
      source: "Footballguys Depth Charts",
      sourceUrl: FBG_DEPTH_URL,
      updatedText: depth.updatedText,
      teamCount: depth.teams,
      rawSha256: createHash("sha256").update(fbgHtml).digest("hex"),
      entries: depth.entries,
    },
    cbsNews: {
      source: "CBS Sports NFL Player News",
      sourceUrls: CBS_NEWS_URLS,
      rawSha256: createHash("sha256").update(cbsPages.join("\n")).digest("hex"),
      archiveWindowDays: CBS_ARCHIVE_WINDOW_DAYS,
      currentItemCount: currentNews.length,
      archiveItemCount: archivedNews.length,
      items: archivedNews,
    },
  };
}

export function validateResearchSnapshot(value) {
  if (!value || value.schemaVersion !== SCHEMA_VERSION || value.modelEffect !== "none" || value.refreshMinutes !== CACHE_MINUTES || !Number.isFinite(Date.parse(value.capturedAt))) throw new Error("Research snapshot failed its source contract.");
  if (value.depthChart?.sourceUrl !== FBG_DEPTH_URL || value.depthChart?.teamCount !== 32 || !/^[a-f0-9]{64}$/.test(value.depthChart?.rawSha256 || "") || !Array.isArray(value.depthChart?.entries) || value.depthChart.entries.length < 400) throw new Error("Research depth-chart provenance is invalid.");
  if (!Array.isArray(value.cbsNews?.sourceUrls) || value.cbsNews.sourceUrls.join("|") !== CBS_NEWS_URLS.join("|") || !/^[a-f0-9]{64}$/.test(value.cbsNews?.rawSha256 || "") || value.cbsNews?.archiveWindowDays !== CBS_ARCHIVE_WINDOW_DAYS || !Number.isSafeInteger(value.cbsNews?.currentItemCount) || value.cbsNews.currentItemCount < 1 || !Number.isSafeInteger(value.cbsNews?.archiveItemCount) || value.cbsNews.archiveItemCount !== value.cbsNews?.items?.length || value.cbsNews.archiveItemCount > CBS_ARCHIVE_MAX_ITEMS || !Array.isArray(value.cbsNews?.items)) throw new Error("Research CBS-news provenance is invalid.");
  for (const entry of value.depthChart.entries) {
    if (!entry.playerName || !entry.nflTeam || !["QB", "RB", "WR", "TE", "K"].includes(entry.position) || !Number.isInteger(entry.depthOrder) || entry.depthOrder < 1) throw new Error("Research depth-chart entry is invalid.");
    safeUrl(entry.url, ["footballguys.com", "www.footballguys.com"]);
  }
  for (const item of value.cbsNews.items) {
    if (!item.id || !item.playerName || !item.title || !item.description || !item.ageText || !Number.isFinite(Date.parse(item.firstSeenAt)) || !Number.isFinite(Date.parse(item.lastSeenAt))) throw new Error("Research CBS-news item is invalid.");
    safeUrl(item.url, ["cbssports.com", "www.cbssports.com"]);
  }
  for (const forbidden of ["projectedPoints", "vbd", "intrinsicValue", "marketValue", "maxBid", "keeperValue", "recommendedBid"]) {
    if (forbidden in value || value.depthChart.entries.some((entry) => forbidden in entry) || value.cbsNews.items.some((item) => forbidden in item)) throw new Error(`Research snapshot attempted to supply ${forbidden}.`);
  }
  return value;
}

export function researchCacheKeys(at = new Date().toISOString()) {
  const timestamp = Date.parse(at);
  if (!Number.isFinite(timestamp)) throw new Error("Research cache timestamp is invalid.");
  const bucket = Math.floor(timestamp / (CACHE_MINUTES * 60_000));
  return { bucketKey: `combined/v${SCHEMA_VERSION}/${bucket}`, latestKey: `combined/v${SCHEMA_VERSION}/latest` };
}

async function readStored(key) {
  const entry = await store().getWithMetadata(key, { consistency: "strong", type: "json" });
  return entry?.data ? validateResearchSnapshot(entry.data) : null;
}

async function sourceHtml(url) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ThunderBowl/1.0; private personal fantasy draft tool)", Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.ok) {
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("html")) throw new Error(`${new URL(url).hostname} returned unexpected content type '${contentType}'.`);
      return response.text();
    }
    if (attempt === 0 && [406, 429, 503].includes(response.status)) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      continue;
    }
    throw new Error(`${new URL(url).hostname} returned ${response.status}.`);
  }
  throw new Error(`${new URL(url).hostname} could not be refreshed.`);
}

export async function currentResearchSnapshot({ force = false } = {}) {
  const { bucketKey, latestKey } = researchCacheKeys();
  const cached = force ? null : await readStored(bucketKey);
  if (cached) return cached;
  try {
    const priorSnapshot = await readStored(latestKey);
    const fbgHtml = await sourceHtml(FBG_DEPTH_URL);
    const cbsPages = [];
    for (const url of CBS_NEWS_URLS) {
      cbsPages.push(await sourceHtml(url));
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const snapshot = validateResearchSnapshot(buildResearchSnapshot({ fbgHtml, cbsPages, priorSnapshot }));
    let winner = snapshot;
    if (force) {
      await store().setJSON(bucketKey, snapshot);
    } else {
      const write = await store().setJSON(bucketKey, snapshot, { onlyIfNew: true });
      winner = write.modified ? snapshot : await readStored(bucketKey);
    }
    const validated = validateResearchSnapshot(winner);
    await store().setJSON(latestKey, validated);
    return validated;
  } catch (error) {
    const latest = await readStored(latestKey);
    if (latest) return { ...latest, staleFallback: true, refreshError: error.message };
    throw error;
  }
}
