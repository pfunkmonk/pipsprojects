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

export function collectPlayerNewsHistory(playerName, newsSnapshot = null, researchSnapshot = null) {
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
    matches.push(row("CBS", item.title, item.description, item.firstSeenAt || item.lastSeenAt, item.url));
  }
  for (const item of researchSnapshot?.fbgNews?.items || []) {
    if (!(item?.playerNames || []).some((name) => canonicalName(name) === wanted)) continue;
    matches.push(row("Footballguys", item.title, item.footballguysView || item.description, item.firstSeenAt || item.lastSeenAt, item.url));
  }
  const unique = [...new Map(matches.map((item) => [`${item.source}|${item.url || ""}|${item.title}|${item.asOf || ""}`, item])).values()];
  return unique
    .sort((left, right) => (Date.parse(right.asOf) || 0) - (Date.parse(left.asOf) || 0) || left.source.localeCompare(right.source));
}

export function collectLatestPlayerNews(playerName, newsSnapshot = null, researchSnapshot = null) {
  return collectPlayerNewsHistory(playerName, newsSnapshot, researchSnapshot).slice(0, 10);
}

export function buildTeamNewsFeed(players = [], newsSnapshot = null, researchSnapshot = null) {
  const roster = [...new Map(players
    .filter((player) => canonicalName(player?.name))
    .map((player) => [canonicalName(player.name), {
      playerId: player.playerId || player.id || null,
      name: String(player.name),
      position: player.position || null,
      nflTeam: player.nflTeam || null,
    }])).values()];
  const stories = new Map();
  for (const player of roster) {
    for (const item of collectPlayerNewsHistory(player.name, newsSnapshot, researchSnapshot)) {
      const key = `${item.source}|${item.url || ""}|${item.title}|${item.asOf || ""}`;
      const current = stories.get(key);
      if (current) {
        if (!current.players.some((candidate) => canonicalName(candidate.name) === canonicalName(player.name))) current.players.push(player);
        continue;
      }
      stories.set(key, { ...item, players: [player] });
    }
  }
  return [...stories.values()].sort((left, right) =>
    (Date.parse(right.asOf) || 0) - (Date.parse(left.asOf) || 0)
    || left.source.localeCompare(right.source)
    || left.title.localeCompare(right.title));
}
