import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const STORE_NAME = "thunder-bowl-2026-news";
export const SOURCE_URL = "https://www.rotowire.com/rss/news.php?sport=NFL";
const NEWS_SCHEMA_VERSION = 2;
const CACHE_MINUTES = 10;
const ARCHIVE_WINDOW_DAYS = 45;
const ARCHIVE_MAX_ITEMS = 1_000;

function store() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

function decodeXml(value) {
  return String(value || "")
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/i, "$1")
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code.replace(/^x/i, ""), /^x/i.test(code) ? 16 : 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function tagText(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeXml(match?.[1]);
}

function safeRotoWireUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !["rotowire.com", "www.rotowire.com"].includes(url.hostname)) {
    throw new Error("RotoWire news item contains an unexpected link host.");
  }
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  return url.toString();
}

export function parseRotoWireNews(xml) {
  if (typeof xml !== "string" || !/<rss\b/i.test(xml) || !/<channel\b/i.test(xml)) {
    throw new Error("RotoWire NFL RSS response is not an RSS document.");
  }
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match, index) => {
    const block = match[1];
    const title = tagText(block, "title");
    const description = tagText(block, "description");
    const publishedAt = new Date(tagText(block, "pubDate"));
    if (!title || title.length > 240 || !description || description.length > 2_000 || !Number.isFinite(publishedAt.getTime())) {
      throw new Error(`RotoWire NFL RSS item ${index + 1} has invalid text or date evidence.`);
    }
    return {
      id: tagText(block, "guid") || createHash("sha256").update(`${title}|${publishedAt.toISOString()}`).digest("hex").slice(0, 24),
      title,
      description,
      url: safeRotoWireUrl(tagText(block, "link")),
      publishedAt: publishedAt.toISOString(),
    };
  });
  if (!items.length || items.length > 100) throw new Error("RotoWire NFL RSS response has an unexpected item count.");
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("RotoWire NFL RSS response contains duplicate item ids.");
  return items;
}

export function mergeNewsArchive(currentItems, priorItems = [], capturedAt = new Date().toISOString()) {
  const capturedTimestamp = Date.parse(capturedAt);
  if (!Number.isFinite(capturedTimestamp) || !Array.isArray(currentItems) || !Array.isArray(priorItems)) throw new Error("News archive input is invalid.");
  const oldestAllowed = capturedTimestamp - ARCHIVE_WINDOW_DAYS * 86_400_000;
  const merged = new Map();
  for (const item of [...currentItems, ...priorItems]) {
    const publishedAt = Date.parse(item.publishedAt);
    if (!Number.isFinite(publishedAt) || publishedAt < oldestAllowed || merged.has(item.id)) continue;
    merged.set(item.id, item);
  }
  return [...merged.values()]
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, ARCHIVE_MAX_ITEMS);
}

export function buildNewsSnapshot(xml, capturedAt = new Date().toISOString(), priorSnapshot = null) {
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("News capture timestamp is invalid.");
  const currentItems = parseRotoWireNews(xml);
  const items = mergeNewsArchive(currentItems, priorSnapshot?.items || [], capturedAt);
  return {
    schemaVersion: NEWS_SCHEMA_VERSION,
    source: "RotoWire NFL player news RSS",
    sourceUrl: SOURCE_URL,
    authority: "supplemental player news; no value effect",
    capturedAt,
    refreshMinutes: CACHE_MINUTES,
    archiveWindowDays: ARCHIVE_WINDOW_DAYS,
    currentItemCount: currentItems.length,
    archiveItemCount: items.length,
    modelEffect: "none",
    rawSha256: createHash("sha256").update(xml).digest("hex"),
    items,
  };
}

export function validateNewsSnapshot(value) {
  if (!value || value.schemaVersion !== NEWS_SCHEMA_VERSION || value.source !== "RotoWire NFL player news RSS" || value.sourceUrl !== SOURCE_URL || value.modelEffect !== "none") {
    throw new Error("Stored player-news snapshot has an invalid source contract.");
  }
  if (!Number.isFinite(Date.parse(value.capturedAt)) || value.refreshMinutes !== CACHE_MINUTES || value.archiveWindowDays !== ARCHIVE_WINDOW_DAYS || !Number.isSafeInteger(value.currentItemCount) || value.currentItemCount < 1 || !Number.isSafeInteger(value.archiveItemCount) || value.archiveItemCount !== value.items?.length || value.archiveItemCount > ARCHIVE_MAX_ITEMS || !/^[a-f0-9]{64}$/.test(value.rawSha256 || "") || !Array.isArray(value.items)) {
    throw new Error("Stored player-news snapshot has invalid provenance.");
  }
  const ids = new Set();
  for (const [index, item] of value.items.entries()) {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)) throw new Error(`Stored player-news item ${index + 1} has an invalid id.`);
    ids.add(item.id);
    if (typeof item.title !== "string" || !item.title || item.title.length > 240 || typeof item.description !== "string" || !item.description || item.description.length > 2_000) {
      throw new Error(`Stored player-news item ${index + 1} has invalid text.`);
    }
    safeRotoWireUrl(item.url);
    if (!Number.isFinite(Date.parse(item.publishedAt))) throw new Error(`Stored player-news item ${index + 1} has an invalid date.`);
    for (const forbidden of ["projectedPoints", "vbd", "intrinsicValue", "marketValue", "maxBid", "keeperValue", "recommendedBid"]) {
      if (forbidden in item) throw new Error(`Stored player-news item attempted to supply ${forbidden}.`);
    }
  }
  return value;
}

export function newsCacheKeys(at = new Date().toISOString()) {
  const timestamp = Date.parse(at);
  if (!Number.isFinite(timestamp)) throw new Error("News cache timestamp is invalid.");
  const bucket = Math.floor(timestamp / (CACHE_MINUTES * 60_000));
  return { bucketKey: `rotowire/v${NEWS_SCHEMA_VERSION}/${bucket}`, latestKey: `rotowire/v${NEWS_SCHEMA_VERSION}/latest` };
}

async function readStored(key) {
  const entry = await store().getWithMetadata(key, { consistency: "strong", type: "json" });
  return entry?.data ? validateNewsSnapshot(entry.data) : null;
}

export async function currentNewsSnapshot({ force = false } = {}) {
  const { bucketKey, latestKey } = newsCacheKeys();
  const cached = force ? null : await readStored(bucketKey);
  if (cached) return cached;
  try {
    const priorSnapshot = await readStored(latestKey);
    const response = await fetch(SOURCE_URL, {
      headers: { "User-Agent": "Thunder-Bowl-2026 private personal-use RSS reader" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`RotoWire returned ${response.status}.`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("xml")) throw new Error(`RotoWire returned unexpected content type '${contentType}'.`);
    const snapshot = buildNewsSnapshot(await response.text(), new Date().toISOString(), priorSnapshot);
    let winner = snapshot;
    if (force) {
      await store().setJSON(bucketKey, snapshot);
    } else {
      const write = await store().setJSON(bucketKey, snapshot, { onlyIfNew: true });
      winner = write.modified ? snapshot : await readStored(bucketKey);
    }
    const validated = validateNewsSnapshot(winner);
    await store().setJSON(latestKey, validated);
    return validated;
  } catch (error) {
    const latest = await readStored(latestKey);
    if (latest) return { ...latest, staleFallback: true, refreshError: error.message };
    throw error;
  }
}
