export const NOMINATION_ASSISTANT_VERSION = "nomination-assistant-v1";
export const NOMINATION_PLAYS = Object.freeze({
  DRAIN: "DRAIN RIVAL",
  FLOAT: "FLOAT CHALK",
  SECURE: "SECURE TARGET",
  PUNT: "PUNT",
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function scoreCandidate({ player, annotation, market, maximum, forecast, needOpen }) {
  const opponents = forecast?.opponents || [];
  const competitiveBidders = opponents.filter((owner) => owner.meanWtp >= Math.max(2, forecast?.naturalSale?.point || market)).length;
  const needyBidders = opponents.filter((owner) => owner.need?.starterNeeded || finite(owner.need?.expectedAdditional) >= 1).length;
  const naturalSale = Math.max(1, finite(forecast?.naturalSale?.point, market));
  const overpay = Math.max(0, naturalSale - market);
  const personalSurplus = maximum - naturalSale;
  const timingEdge = -finite(forecast?.nominationTiming?.deltaVersusNow);

  const drain = annotation?.tag === "target" ? Number.NEGATIVE_INFINITY
    : naturalSale * 2.2 + needyBidders * 5 + competitiveBidders * 3 + (needOpen ? -8 : 5) + (annotation?.tag === "avoid" ? 12 : 0);
  const float = annotation?.tag === "target" ? Number.NEGATIVE_INFINITY
    : overpay * 14 + competitiveBidders * 6 + naturalSale * 0.8 + (annotation?.tag === "avoid" ? 4 : 0);
  const informationLeakPenalty = annotation?.tag === "target" ? 4 : 0;
  const secure = annotation?.tag === "target"
    ? personalSurplus * 12 + (needOpen ? 10 : 0) + timingEdge * 5 - informationLeakPenalty
    : Number.NEGATIVE_INFINITY;

  const plays = [
    { play: NOMINATION_PLAYS.DRAIN, score: drain },
    { play: NOMINATION_PLAYS.FLOAT, score: float },
    { play: NOMINATION_PLAYS.SECURE, score: secure },
  ].sort((left, right) => right.score - left.score);
  const best = plays[0];
  return {
    player,
    modelEffect: "advisory_only",
    play: best.play,
    score: best.score,
    marketValue: market,
    personalMaximum: maximum,
    naturalSale,
    competitiveBidders,
    needyBidders,
    overpay,
    personalSurplus,
    reason: best.play === NOMINATION_PLAYS.SECURE
      ? `${personalSurplus >= 0 ? `+$${personalSurplus}` : `-$${Math.abs(personalSurplus)}`} forecast edge; ${needOpen ? "fills a starter need" : "target timing play"}`
      : best.play === NOMINATION_PLAYS.FLOAT
        ? `${competitiveBidders} modeled bidders; forecast ${overpay ? `$${overpay} above` : "near"} market`
        : `${needyBidders} needy rivals; modeled sale $${naturalSale}`,
    forecast,
  };
}

/**
 * Ranks presentation plays over the existing WTP/forecast model. It is private,
 * synchronous, and advisory only; it never nominates a player or writes a ledger event.
 */
export function buildNominationAssistant({
  players,
  state,
  userTeamId = "dogs-of-war",
  annotationFor = () => null,
  marketValueFor = (player) => player?.marketValue,
  bidLimitFor = (player) => player?.maxBid,
  forecastFor,
  candidateLimit = 18,
  limit = 3,
  scoreFloor = 8,
} = {}) {
  if (!Array.isArray(players)) throw new TypeError("Nomination assistant requires the complete player pool.");
  if (!state?.teams?.[userTeamId] || typeof forecastFor !== "function") return [];
  const team = state.teams[userTeamId];
  const requirements = state.config?.starterRequirements || {};
  const available = players.filter((player) => !state.draftedPlayers?.[player.id]);
  const targets = available.filter((player) => annotationFor(player.id)?.tag === "target");
  const expensive = [...available].sort((left, right) => finite(marketValueFor(right), 1) - finite(marketValueFor(left), 1)
    || finite(left.sourceRank, 9999) - finite(right.sourceRank, 9999)).slice(0, candidateLimit);
  const candidates = [...new Map([...targets, ...expensive].map((player) => [player.id, player])).values()];
  const ranked = candidates.map((player) => {
    const annotation = annotationFor(player.id) || null;
    const market = Math.max(1, Math.round(finite(marketValueFor(player), 1)));
    const maximum = Math.max(0, Math.round(finite(bidLimitFor(player))));
    const needOpen = finite(team.positionCounts?.[player.position]) < finite(requirements[player.position]);
    return scoreCandidate({ player, annotation, market, maximum, forecast: forecastFor(player), needOpen });
  }).filter((row) => Number.isFinite(row.score) && row.score >= scoreFloor)
    .sort((left, right) => right.score - left.score
      || right.naturalSale - left.naturalSale
      || finite(left.player.sourceRank, 9999) - finite(right.player.sourceRank, 9999));

  const chosen = [];
  for (const play of [NOMINATION_PLAYS.DRAIN, NOMINATION_PLAYS.FLOAT, NOMINATION_PLAYS.SECURE]) {
    const candidate = ranked.find((row) => row.play === play && !chosen.some((prior) => prior.player.id === row.player.id));
    if (candidate) chosen.push(candidate);
    if (chosen.length >= limit) break;
  }
  for (const candidate of ranked) {
    if (chosen.length >= limit) break;
    if (!chosen.some((prior) => prior.player.id === candidate.player.id)) chosen.push(candidate);
  }
  if (chosen.length) return chosen;
  return [{
    play: NOMINATION_PLAYS.PUNT,
    score: 0,
    player: null,
    marketValue: 0,
    naturalSale: 0,
    reason: "No nomination clears the safety floor; use the cheapest non-target who cannot damage your roster plan.",
    modelEffect: "advisory_only",
  }];
}
