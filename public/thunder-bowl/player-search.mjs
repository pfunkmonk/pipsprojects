export function normalizePlayerSearch(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(?:jr|sr|ii|iii|iv)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function boundedDamerauLevenshtein(left, right, limit) {
  if (left === right) return 0;
  if (limit < 1 || Math.abs(left.length - right.length) > limit) return limit + 1;
  const previousPrevious = new Array(right.length + 1).fill(0);
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      const insertion = current[rightIndex - 1] + 1;
      const deletion = previous[rightIndex] + 1;
      let distance = Math.min(substitution, insertion, deletion);
      if (
        leftIndex > 1
        && rightIndex > 1
        && left[leftIndex - 1] === right[rightIndex - 2]
        && left[leftIndex - 2] === right[rightIndex - 1]
      ) {
        distance = Math.min(distance, previousPrevious[rightIndex - 2] + 1);
      }
      current[rightIndex] = distance;
      rowMinimum = Math.min(rowMinimum, distance);
    }
    if (rowMinimum > limit) return limit + 1;
    for (let index = 0; index < previous.length; index += 1) previousPrevious[index] = previous[index];
    previous = current;
  }
  return previous[right.length];
}

function tokenTolerance(token, candidate) {
  const longest = Math.max(token.length, candidate.length);
  if (token.length >= 4 && longest >= 6) return 2;
  if (token.length >= 4) return 1;
  return 0;
}

function bestTokenScore(queryToken, candidateTokens) {
  let best = Number.NEGATIVE_INFINITY;
  for (const candidate of candidateTokens) {
    if (candidate === queryToken) best = Math.max(best, 140);
    else if (candidate.startsWith(queryToken)) best = Math.max(best, 115 - Math.min(20, candidate.length - queryToken.length));
    else if (queryToken.length >= 4 && queryToken.startsWith(candidate) && candidate.length >= 3) best = Math.max(best, 85 - Math.min(20, queryToken.length - candidate.length));
    else {
      const tolerance = tokenTolerance(queryToken, candidate);
      if (!tolerance) continue;
      const distance = boundedDamerauLevenshtein(queryToken, candidate, tolerance);
      if (distance <= tolerance) best = Math.max(best, 90 - distance * 22 - Math.abs(queryToken.length - candidate.length));
    }
  }
  return best;
}

export function playerSearchScore(player, rawQuery) {
  const query = normalizePlayerSearch(rawQuery);
  if (!query) return 0;
  const name = normalizePlayerSearch(player?.name);
  const nflTeam = normalizePlayerSearch(player?.nflTeam);
  const position = normalizePlayerSearch(player?.position);
  const combined = `${name} ${nflTeam} ${position}`.trim();
  if (!combined) return null;
  if (combined === query) return 2_000;
  if (name === query) return 1_900;
  if (name.startsWith(query)) return 1_750 - Math.min(100, name.length - query.length);
  if (query.length >= 3 && name.includes(query)) return 1_600 - Math.min(100, name.indexOf(query));
  if (nflTeam === query || position === query) return 1_500;

  const queryTokens = query.split(" ");
  const candidateTokens = combined.split(" ");
  let score = 0;
  for (const queryToken of queryTokens) {
    const tokenScore = bestTokenScore(queryToken, candidateTokens);
    if (!Number.isFinite(tokenScore)) return null;
    score += tokenScore;
  }
  if (queryTokens.length > 1 && name.split(" ").slice(0, queryTokens.length).join(" ").startsWith(queryTokens[0])) score += 40;
  return score;
}
