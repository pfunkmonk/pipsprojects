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
      nextTierAlternative: null,
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
  const nextTierAlternative = lowerTier[0] || null;
  const nextAlternative = nextTierAlternative || lowerRank[0] || samePosition[0] || null;
  const selectedValue = Math.max(0, finiteNumber(valueFor(selectedPlayer)));
  const alternativeValue = nextAlternative ? Math.max(0, finiteNumber(valueFor(nextAlternative))) : 0;
  const nextTierValue = nextTierAlternative ? Math.max(0, finiteNumber(valueFor(nextTierAlternative))) : 0;
  const selectedMarket = Math.max(0, finiteNumber(selectedPlayer.marketValue));
  const alternativeMarket = nextAlternative ? Math.max(0, finiteNumber(nextAlternative.marketValue)) : 0;

  return {
    available: true,
    sameTierRemaining,
    nextAlternative,
    nextTierAlternative,
    selectedValue,
    alternativeValue,
    maxBidCliff: Math.max(0, selectedValue - nextTierValue),
    marketCliff: Math.max(0, selectedMarket - alternativeMarket),
    disagreement: projectionDisagreement(selectedPlayer),
    modelEffect: "none",
  };
}

export function buildTierDeadlineWarning({
  selectedPlayer,
  available = true,
  sameTierRemaining = 0,
  nextTierAlternative = null,
  maxBidCliff = 0,
} = {}) {
  const remaining = Math.max(0, Math.floor(finiteNumber(sameTierRemaining)));
  if (!selectedPlayer || !available || remaining < 1 || remaining > 2) {
    return { active: false, urgency: "none", title: "", message: "" };
  }

  const position = String(selectedPlayer.position || "player").toUpperCase();
  const tier = Number.isFinite(tierNumber(selectedPlayer)) ? tierNumber(selectedPlayer) : "?";
  const cliff = Math.max(0, Math.floor(finiteNumber(maxBidCliff)));
  const alternative = nextTierAlternative
    ? ` Next tier: ${nextTierAlternative.name}${cliff > 0 ? ` (a $${cliff} max-bid drop)` : ""}.`
    : " No lower-tier alternative is currently available.";

  if (remaining === 1) {
    return {
      active: true,
      urgency: "last",
      title: `LAST ${position} IN TIER ${tier}`,
      message: `${selectedPlayer.name} is the final available player in this tier. If this player goes, you miss Tier ${tier}.${alternative}`,
    };
  }

  return {
    active: true,
    urgency: "closing",
    title: `TIER ${tier} CLOSING · 2 ${position} OPTIONS LEFT`,
    message: `You need one of the final two available players to avoid dropping to the next tier.${alternative}`,
  };
}

export function byeWeekFor(player) {
  const week = Number(player?.weeklyProjection?.byeWeek);
  return Number.isSafeInteger(week) && week >= 1 && week <= 18 ? week : null;
}

export function buildTierSnapshot({ selectedPlayer, players, state } = {}) {
  if (!selectedPlayer) return [];
  if (!Array.isArray(players)) throw new TypeError("Tier detail requires the complete player pool.");
  const draftedPlayers = state?.draftedPlayers || {};
  const teams = state?.teams || {};
  return players
    .filter((player) => player?.position === selectedPlayer.position && tierNumber(player) === tierNumber(selectedPlayer))
    .sort((left, right) => rankNumber(left) - rankNumber(right)
      || finiteNumber(right?.projectedPoints) - finiteNumber(left?.projectedPoints)
      || String(left?.name || "").localeCompare(String(right?.name || "")))
    .map((player) => {
      const teamId = draftedPlayers[player.id]?.teamId || null;
      const teamName = teamId ? teams[teamId]?.name || teamId : null;
      return {
        id: player.id,
        name: player.name,
        position: player.position,
        nflTeam: player.nflTeam,
        byeWeek: byeWeekFor(player),
        projectedPoints: finiteNumber(player.projectedPoints),
        sourceRank: rankNumber(player),
        available: !teamId,
        teamId,
        teamName,
        status: teamName ? `On ${teamName}` : "Available",
      };
    });
}

export function byeWeekConflicts({ selectedPlayer, players, state, userTeamId = "dogs-of-war" } = {}) {
  const byeWeek = byeWeekFor(selectedPlayer);
  if (!selectedPlayer || !byeWeek) return { byeWeek, conflicts: [] };
  if (!Array.isArray(players)) throw new TypeError("Bye-week checking requires the complete player pool.");
  const playerById = new Map(players.map((player) => [player.id, player]));
  const roster = state?.teams?.[userTeamId]?.roster || [];
  const conflicts = roster.flatMap((entry) => {
    const rosterPlayer = playerById.get(entry.playerId);
    return byeWeekFor(rosterPlayer) === byeWeek
      ? [{
        playerId: entry.playerId,
        playerName: entry.playerName,
        position: entry.position,
        nflTeam: entry.nflTeam,
        byeWeek,
      }]
      : [];
  });
  return { byeWeek, conflicts };
}

export function cashLeverage({ state, position, userTeamId = "dogs-of-war", legalMaximumFor } = {}) {
  if (!state?.teams) return { available: false, userMaximum: 0, topOpponentMaximum: 0, delta: 0, label: "--" };
  const maximumFor = typeof legalMaximumFor === "function"
    ? legalMaximumFor
    : (team) => finiteNumber(team?.legalMaxBid);
  const userMaximum = Math.max(0, finiteNumber(maximumFor(state.teams[userTeamId], position)));
  const opponentMaximums = Object.values(state.teams)
    .filter((team) => team?.id !== userTeamId && finiteNumber(team?.openSlots, 1) > 0)
    .map((team) => Math.max(0, finiteNumber(maximumFor(team, position))));
  const topOpponentMaximum = opponentMaximums.length ? Math.max(...opponentMaximums) : 0;
  const delta = userMaximum - topOpponentMaximum;
  return {
    available: true,
    userMaximum,
    topOpponentMaximum,
    delta,
    label: delta > 0 ? `You +$${delta}` : delta < 0 ? `Top rival +$${Math.abs(delta)}` : "Even",
  };
}

export function budgetRunway({ state, players = [], purchasePrice = 0, candidatePosition = null, userTeamId = "dogs-of-war", valueFor = (player) => player?.marketValue } = {}) {
  const team = state?.teams?.[userTeamId];
  if (!team) return { available: false, cashAfter: 0, openSlotsAfter: 0, dollarsPerSlot: 0, futureLegalMax: 0, premiumOptions: 0 };
  const price = Math.max(0, Math.floor(finiteNumber(purchasePrice)));
  const cashAfter = Math.max(0, finiteNumber(team.cash) - price);
  const openSlotsAfter = Math.max(0, finiteNumber(team.openSlots) - (price > 0 ? 1 : 0));
  const minimumBid = Math.max(1, finiteNumber(state?.config?.minimumBid, 1));
  const rosterCount = Array.isArray(team.roster)
    ? team.roster.length
    : Math.max(0, finiteNumber(state?.config?.rosterSize, finiteNumber(team.openSlots)) - finiteNumber(team.openSlots));
  const rosterCountAfter = rosterCount + (price > 0 ? 1 : 0);
  const countsAfter = { ...(team.positionCounts || {}) };
  if (price > 0 && candidatePosition) countsAfter[candidatePosition] = (countsAfter[candidatePosition] || 0) + 1;
  const starterRequirements = state?.config?.starterRequirements;
  const missingStartersAfter = starterRequirements
    ? Object.entries(starterRequirements).reduce(
        (sum, [position, requirement]) => sum + Math.max(0, finiteNumber(requirement) - finiteNumber(countsAfter[position])),
        0,
      )
    : null;
  const minimumRosterSize = Math.max(0, finiteNumber(team.minimumRosterSize, 8));
  const minimumPlayersAfter = Math.max(0, minimumRosterSize - rosterCountAfter);
  const requiredAdditionsAfter = missingStartersAfter === null
    ? team.requiredAdditions === undefined
      ? openSlotsAfter
      : Math.max(0, finiteNumber(team.requiredAdditions) - (price > 0 ? 1 : 0))
    : Math.max(minimumPlayersAfter, missingStartersAfter);
  const completionReserve = requiredAdditionsAfter * minimumBid;
  const discretionaryAfter = Math.max(0, cashAfter - completionReserve);
  const dollarsPerSlot = openSlotsAfter ? cashAfter / openSlotsAfter : 0;
  const futureLegalMax = openSlotsAfter
    ? Math.max(0, cashAfter - Math.max(0, requiredAdditionsAfter - 1) * minimumBid)
    : 0;
  const premiumOptions = (Array.isArray(players) ? players : []).filter((player) => (
    !state.draftedPlayers?.[player.id]
    && Math.max(0, finiteNumber(valueFor(player))) >= 10
    && Math.max(0, finiteNumber(valueFor(player))) <= futureLegalMax
  )).length;
  return {
    available: true,
    cashAfter,
    openSlotsAfter,
    completionReserve,
    requiredAdditionsAfter,
    discretionaryAfter,
    dollarsPerSlot,
    futureLegalMax,
    premiumOptions,
  };
}

export function playerSurplusHeat({ currentBid = 0, liveMarketValue = 0, personalMaximum = 0, stealPrice = null, avoid = false } = {}) {
  const nextBid = Math.max(1, Math.floor(finiteNumber(currentBid)) + 1);
  const market = Math.max(1, Math.floor(finiteNumber(liveMarketValue, 1)));
  const maximum = Math.max(0, Math.floor(finiteNumber(personalMaximum)));
  const edge = maximum - nextBid;
  if (avoid || nextBid > maximum) return { level: "stop", edge, label: avoid ? "Avoid" : `Stop $${maximum}` };
  if (Number.isSafeInteger(stealPrice) && nextBid <= stealPrice) return { level: "steal", edge, label: `Steal +$${edge}` };
  if (edge >= Math.max(5, Math.ceil(market * 0.18))) return { level: "value", edge, label: `Edge +$${edge}` };
  if (nextBid <= market || edge >= 2) return { level: "fair", edge, label: edge >= 0 ? `Edge +$${edge}` : "Fair" };
  return { level: "stretch", edge, label: `Stretch $${nextBid}` };
}

export function buildBidRecommendation({
  selectedPlayer,
  available = true,
  currentBid = 0,
  personalMaximum = 0,
  liveMarketValue = 0,
  sameTierRemaining = 0,
  nextAlternative = null,
  annotation = null,
  dogsLeading = false,
} = {}) {
  const normalizedCurrentBid = Math.max(0, Math.floor(finiteNumber(currentBid)));
  const nextBid = normalizedCurrentBid + 1;
  const maximum = Math.max(0, Math.floor(finiteNumber(personalMaximum)));
  const market = Math.max(0, Math.floor(finiteNumber(liveMarketValue)));
  const tierSupply = Math.max(0, Math.floor(finiteNumber(sameTierRemaining)));
  if (!selectedPlayer) return { verdict: "WAIT", tone: "neutral", nextBid, reason: "Select the nominated player." };
  if (!available) return { verdict: "PASS", tone: "danger", nextBid, reason: "This player is already assigned." };
  if (annotation?.tag === "avoid") return { verdict: "PASS", tone: "danger", nextBid, reason: "You marked this player Avoid." };
  if (dogsLeading) return { verdict: "HOLD", tone: "warning", nextBid, reason: "You already have the high bid. Do not bid against yourself." };
  if (nextBid > maximum) return { verdict: "PASS", tone: "danger", nextBid, reason: `STOP. Do not bid $${nextBid}. Your hard stop is $${maximum}.` };
  if (Number.isSafeInteger(annotation?.stealPrice) && nextBid <= annotation.stealPrice) {
    return { verdict: "BID", tone: "good", nextBid, reason: `The next bid is inside your $${annotation.stealPrice} steal price.` };
  }
  if (annotation?.tag === "target") return { verdict: "BID", tone: "good", nextBid, reason: "Target player and still inside your hard stop." };
  if (nextBid <= market) return { verdict: "BID", tone: "good", nextBid, reason: `The next bid remains at or below the $${market} live market estimate.` };
  if (tierSupply <= 1) return { verdict: "BID", tone: "good", nextBid, reason: "Last available player in this tier and still inside your hard stop." };
  if (nextAlternative) {
    return { verdict: "HOLD", tone: "warning", nextBid, reason: `${tierSupply} tier peers remain; hold the extra dollar for ${nextAlternative.name}.` };
  }
  return { verdict: "BID", tone: "good", nextBid, reason: "Still inside your personal maximum and no stronger alternative signal is available." };
}

function nominationReason({ annotation, needOpen, market, maximum }) {
  if (annotation?.tag === "avoid") return "Marked Avoid";
  if (Number.isSafeInteger(annotation?.personalMax) && annotation.personalMax < market) return `Your max $${annotation.personalMax} vs $${market} market`;
  if (!needOpen) return "Starter need already filled";
  if (maximum < market) return `Model max $${maximum} vs $${market} market`;
  return "High-cost room drain";
}

export function buildNominationRecommendations({
  players,
  state,
  userTeamId = "dogs-of-war",
  annotationFor = () => null,
  marketValueFor = (player) => player?.marketValue,
  bidLimitFor = (player) => player?.maxBid,
  limit = 3,
} = {}) {
  if (!Array.isArray(players)) throw new TypeError("Nomination recommendations require the complete player pool.");
  if (!state?.teams?.[userTeamId]) return [];
  const team = state.teams[userTeamId];
  const requirements = state.config?.starterRequirements || {};
  const available = players.filter((player) => !state.draftedPlayers?.[player.id]);
  const ranked = available.flatMap((player) => {
    const annotation = annotationFor(player.id) || null;
    if (annotation?.tag === "target") return [];
    const market = Math.max(1, Math.floor(finiteNumber(marketValueFor(player), 1)));
    const maximum = Math.max(0, Math.floor(finiteNumber(bidLimitFor(player))));
    const needOpen = finiteNumber(team.positionCounts?.[player.position]) < finiteNumber(requirements[player.position]);
    const avoid = annotation?.tag === "avoid";
    const personalGap = Number.isSafeInteger(annotation?.personalMax) ? market - annotation.personalMax : 0;
    const modelGap = market - maximum;
    const unlikely = avoid || personalGap > 0 || modelGap > 0 || (!needOpen && maximum <= market);
    if (!unlikely || market < 5) return [];
    const score = market * 100 + (avoid ? 60 : 0) + (!needOpen ? 25 : 0) + Math.max(personalGap, modelGap, 0) * 8;
    return [{
      player,
      marketValue: market,
      personalMaximum: maximum,
      reason: nominationReason({ annotation, needOpen, market, maximum }),
      score,
    }];
  }).sort((left, right) => right.score - left.score
    || rankNumber(left.player) - rankNumber(right.player)
    || left.player.name.localeCompare(right.player.name));
  return ranked.slice(0, Math.max(0, Math.floor(finiteNumber(limit, 3))));
}
