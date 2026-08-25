const POSITION_ORDER = Object.freeze({ QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DST: 5 });

export const PLAYER_POOL_SORTS = Object.freeze({
  RECOMMENDED: "RECOMMENDED",
  VBD_DESC: "VBD_DESC",
  MARKET_DESC: "MARKET_DESC",
  MAX_BID_DESC: "MAX_BID_DESC",
  PROJECTED_DESC: "PROJECTED_DESC",
  TIER_ASC: "TIER_ASC",
  POSITION_ASC: "POSITION_ASC",
  BYE_ASC: "BYE_ASC",
  ROOKIE_FIRST: "ROOKIE_FIRST",
  AGE_ASC: "AGE_ASC",
  AGE_DESC: "AGE_DESC",
  NAME_ASC: "NAME_ASC",
});

export const DEFAULT_PLAYER_POOL_CONTROLS = Object.freeze({
  position: "ALL",
  byeWeek: "ALL",
  experience: "ALL",
  tier: "ALL",
  tag: "ALL",
  attention: "ALL",
  sort: PLAYER_POOL_SORTS.RECOMMENDED,
});

export function playerByeWeek(player) {
  const byeWeek = Number(player?.weeklyProjection?.byeWeek);
  return Number.isInteger(byeWeek) && byeWeek > 0 ? byeWeek : null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compareKnownNumbers(left, right, direction = "asc") {
  const leftNumber = finiteNumber(left);
  const rightNumber = finiteNumber(right);
  if (leftNumber === null && rightNumber === null) return 0;
  if (leftNumber === null) return 1;
  if (rightNumber === null) return -1;
  return direction === "desc" ? rightNumber - leftNumber : leftNumber - rightNumber;
}

function experienceRank(demographics) {
  if (demographics?.rookie === true) return 0;
  if (demographics?.rookie === false) return 1;
  return 2;
}

function tagRank(tag) {
  if (tag === "target") return 0;
  if (tag === "avoid") return 2;
  return 1;
}

function normalizedControls(controls = {}) {
  return { ...DEFAULT_PLAYER_POOL_CONTROLS, ...controls };
}

export function activePlayerPoolFilters(controls = {}) {
  const current = normalizedControls(controls);
  const filters = [];
  if (current.position !== "ALL") filters.push(current.position);
  if (current.byeWeek !== "ALL") filters.push(`Bye ${current.byeWeek}`);
  if (current.experience === "ROOKIE") filters.push("Rookies");
  if (current.experience === "VETERAN") filters.push("Veterans");
  if (current.experience === "UNKNOWN") filters.push("Experience unknown");
  if (current.tier !== "ALL") filters.push(`Tier ${current.tier}`);
  if (current.tag === "TARGET") filters.push("Targets");
  if (current.tag === "AVOID") filters.push("Avoids");
  if (current.tag === "UNTAGGED") filters.push("Untagged");
  if (current.attention === "ALERT") filters.push("News / injury alert");
  return filters;
}

export function filterAndSortPlayerPool({
  players,
  query = "",
  controls,
  searchScoreFor,
  tagFor = () => null,
  valuesFor = (player) => ({ marketValue: player.marketValue, maxBid: player.maxBid }),
  adjustedVbdFor = (player) => player.vbd,
  demographicsFor = () => null,
  hasAttention = () => false,
}) {
  const current = normalizedControls(controls);
  const normalizedQuery = String(query || "").trim();
  const candidates = players
    .filter((player) => current.position === "ALL" || player.position === current.position)
    .filter((player) => current.byeWeek === "ALL" || playerByeWeek(player) === Number(current.byeWeek))
    .filter((player) => current.tier === "ALL" || Number(player.tier) === Number(current.tier))
    .filter((player) => {
      const tag = tagFor(player) || "neutral";
      if (current.tag === "TARGET") return tag === "target";
      if (current.tag === "AVOID") return tag === "avoid";
      if (current.tag === "UNTAGGED") return !tag || tag === "neutral";
      return true;
    })
    .filter((player) => current.attention !== "ALERT" || hasAttention(player))
    .filter((player) => {
      if (current.experience === "ALL") return true;
      const demographics = demographicsFor(player);
      if (current.experience === "ROOKIE") return demographics?.rookie === true;
      if (current.experience === "VETERAN") return demographics?.rookie === false;
      return demographics?.rookie !== true && demographics?.rookie !== false;
    })
    .map((player) => ({
      player,
      demographics: demographicsFor(player),
      searchScore: searchScoreFor(player, normalizedQuery),
    }))
    .filter(({ searchScore }) => searchScore !== null);

  const recommended = (left, right) => {
    const leftValues = valuesFor(left.player);
    const rightValues = valuesFor(right.player);
    return tagRank(tagFor(left.player)) - tagRank(tagFor(right.player))
      || compareKnownNumbers(leftValues.maxBid, rightValues.maxBid, "desc")
      || compareKnownNumbers(adjustedVbdFor(left.player), adjustedVbdFor(right.player), "desc")
      || left.player.name.localeCompare(right.player.name);
  };

  const selectedSort = (left, right) => {
    const leftValues = valuesFor(left.player);
    const rightValues = valuesFor(right.player);
    switch (current.sort) {
      case PLAYER_POOL_SORTS.VBD_DESC:
        return compareKnownNumbers(adjustedVbdFor(left.player), adjustedVbdFor(right.player), "desc") || recommended(left, right);
      case PLAYER_POOL_SORTS.MARKET_DESC:
        return compareKnownNumbers(leftValues.marketValue, rightValues.marketValue, "desc") || recommended(left, right);
      case PLAYER_POOL_SORTS.MAX_BID_DESC:
        return compareKnownNumbers(leftValues.maxBid, rightValues.maxBid, "desc") || recommended(left, right);
      case PLAYER_POOL_SORTS.PROJECTED_DESC:
        return compareKnownNumbers(left.player.projectedPoints, right.player.projectedPoints, "desc") || recommended(left, right);
      case PLAYER_POOL_SORTS.TIER_ASC:
        return compareKnownNumbers(left.player.tier, right.player.tier) || recommended(left, right);
      case PLAYER_POOL_SORTS.POSITION_ASC:
        return (POSITION_ORDER[left.player.position] ?? 99) - (POSITION_ORDER[right.player.position] ?? 99) || recommended(left, right);
      case PLAYER_POOL_SORTS.BYE_ASC:
        return compareKnownNumbers(playerByeWeek(left.player), playerByeWeek(right.player)) || recommended(left, right);
      case PLAYER_POOL_SORTS.ROOKIE_FIRST:
        return experienceRank(left.demographics) - experienceRank(right.demographics) || recommended(left, right);
      case PLAYER_POOL_SORTS.AGE_ASC:
        return compareKnownNumbers(left.demographics?.age, right.demographics?.age) || recommended(left, right);
      case PLAYER_POOL_SORTS.AGE_DESC:
        return compareKnownNumbers(left.demographics?.age, right.demographics?.age, "desc") || recommended(left, right);
      case PLAYER_POOL_SORTS.NAME_ASC:
        return left.player.name.localeCompare(right.player.name) || recommended(left, right);
      default:
        return recommended(left, right);
    }
  };

  return candidates
    .sort((left, right) => {
      const searchDifference = normalizedQuery ? right.searchScore - left.searchScore : 0;
      return searchDifference || selectedSort(left, right);
    })
    .map(({ player }) => player);
}
