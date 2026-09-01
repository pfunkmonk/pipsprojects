function canonicalName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function safeDate(value) {
  return Number.isFinite(Date.parse(value)) ? value : null;
}

export function safeNewsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function row(source, title, summary, asOf, url) {
  return {
    source,
    title: String(title || "Player update").trim(),
    summary: String(summary || "No summary is available.").trim(),
    asOf: safeDate(asOf),
    url: safeNewsUrl(url),
  };
}

export function collectLatestPlayerNews(playerName, newsSnapshot = null, researchSnapshot = null) {
  const wanted = canonicalName(playerName);
  if (!wanted) return [];
  const matches = [];
  for (const item of newsSnapshot?.items || []) {
    const headlineName = String(item?.title || "").split(":", 1)[0];
    if (canonicalName(headlineName) !== wanted) continue;
    matches.push(row("RotoWire", item.title, item.description, item.publishedAt, item.url));
  }
  for (const item of researchSnapshot?.cbsNews?.items || []) {
    if (canonicalName(item?.playerName) !== wanted) continue;
    matches.push(row("CBS", item.title, item.description, item.lastSeenAt, item.url));
  }
  for (const item of researchSnapshot?.fbgNews?.items || []) {
    if (!(item?.playerNames || []).some((name) => canonicalName(name) === wanted)) continue;
    matches.push(row("Footballguys", item.title, item.footballguysView || item.description, item.lastSeenAt, item.url));
  }
  const unique = [...new Map(matches.map((item) => [`${item.source}|${item.title}`, item])).values()];
  return unique
    .sort((left, right) => (Date.parse(right.asOf) || 0) - (Date.parse(left.asOf) || 0) || left.source.localeCompare(right.source))
    .slice(0, 10);
}
