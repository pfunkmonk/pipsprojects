const DISAGREEMENT_THRESHOLD = 25;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rankNumber(player) {
  return finiteNumber(player?.sourceRank, Number.POSITIVE_INFINITY);
}

function tierNumber(player) {
  return finiteNumber(player?.tier, Number.POSITIVE_INFINITY);
}

function byTierRankValue(left, right, valueFor) {
  return tierNumber(left) - tierNumber(right)
    || rankNumber(left) - rankNumber(right)
    || finiteNumber(valueFor(right)) - finiteNumber(valueFor(left))
    || String(left?.name || "").localeCompare(String(right?.name || ""));
}

export function projectionDisagreement(player, threshold = DISAGREEMENT_THRESHOLD) {
  const sources = Array.isArray(player?.projectionSources)
    ? player.projectionSources.filter((source) => Number.isFinite(Number(source?.points)))
    : [];
  if (sources.length < 2) {
    return { available: false, spread: 0, level: "unknown", highSource: null, lowSource: null, sourceCount: sources.length };
  }

  const ordered = [...sources].sort((left, right) => Number(left.points) - Number(right.points));
  const lowSource = ordered[0];
  const highSource = ordered.at(-1);
  const spread = Number((Number(highSource.points) - Number(lowSource.points)).toFixed(1));
  return {
    available: true,
    spread,
    level: spread >= threshold ? "high" : spread >= threshold / 2 ? "watch" : "low",
    highSource: highSource.source,
    lowSource: lowSource.source,
    sourceCount: sources.length,
  };
}

export function buildDecisionContext({ selectedPlayer, availablePlayers, valueFor = (player) => player?.maxBid } = {}) {
  if (!selectedPlayer) {
    return {
      available: false,
      sameTierRemaining: 0,
      nextAlternative: null,
      maxBidCliff: 0,
      marketCliff: 0,
      disagreement: projectionDisagreement(null),
      modelEffect: "none",
    };
  }
  if (!Array.isArray(availablePlayers)) throw new TypeError("Decision context requires the current available-player pool.");
  if (typeof valueFor !== "function") throw new TypeError("Decision context requires a live-value resolver.");

  const samePosition = availablePlayers
    .filter((player) => player?.id !== selectedPlayer.id && player?.position === selectedPlayer.position)
    .sort((left, right) => byTierRankValue(left, right, valueFor));
  const selectedTier = tierNumber(selectedPlayer);
  const sameTierRemaining = availablePlayers.filter((player) => (
    player?.position === selectedPlayer.position && tierNumber(player) === selectedTier
  )).length;

  const lowerTier = samePosition.filter((player) => tierNumber(player) > selectedTier);
  const lowerRank = samePosition.filter((player) => rankNumber(player) > rankNumber(selectedPlayer));
  const nextAlternative = lowerTier[0] || lowerRank[0] || samePosition[0] || null;
  const selectedValue = Math.max(0, finiteNumber(valueFor(selectedPlayer)));
  const alternativeValue = nextAlternative ? Math.max(0, finiteNumber(valueFor(nextAlternative))) : 0;
  const selectedMarket = Math.max(0, finiteNumber(selectedPlayer.marketValue));
  const alternativeMarket = nextAlternative ? Math.max(0, finiteNumber(nextAlternative.marketValue)) : 0;

  return {
    available: true,
    sameTierRemaining,
    nextAlternative,
    selectedValue,
    alternativeValue,
    maxBidCliff: Math.max(0, selectedValue - alternativeValue),
    marketCliff: Math.max(0, selectedMarket - alternativeMarket),
    disagreement: projectionDisagreement(selectedPlayer),
    modelEffect: "none",
  };
}
