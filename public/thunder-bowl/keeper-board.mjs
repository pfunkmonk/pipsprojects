const MAX_KEEPERS = 2;
const MAX_KEEPER_YEAR = 3;
const TRADE_RISK_BUFFER = 1;

function finiteWhole(value, label) {
  if (!Number.isFinite(value) || !Number.isInteger(value)) throw new Error(`${label} must be a whole-dollar value.`);
  return value;
}

export function keeperContractTenure(keeperYear) {
  finiteWhole(keeperYear, "Keeper year");
  if (keeperYear < 1) throw new Error("Keeper year must be at least 1.");
  const eligible = keeperYear <= MAX_KEEPER_YEAR;
  const yearsUsed = Math.min(MAX_KEEPER_YEAR, keeperYear - 1);
  const yearsLeft = eligible ? MAX_KEEPER_YEAR - yearsUsed : 0;
  return {
    upcomingYear: keeperYear,
    maxYears: MAX_KEEPER_YEAR,
    yearsUsed,
    yearsLeft,
    eligible,
    yearLabel: eligible ? `Year ${keeperYear} of ${MAX_KEEPER_YEAR}` : "Contract expired",
    shortLabel: `${yearsUsed} used · ${yearsLeft} left`,
  };
}

function selectedPortfolio(candidates) {
  return candidates
    .filter((candidate) => candidate.keeperYear <= MAX_KEEPER_YEAR)
    .map((candidate) => ({ ...candidate, surplus: Math.max(0, finiteWhole(candidate.surplus, `${candidate.playerName} surplus`)) }))
    .filter((candidate) => candidate.surplus > 0)
    .sort((left, right) => right.surplus - left.surplus || left.keeperSalary - right.keeperSalary || left.playerName.localeCompare(right.playerName))
    .slice(0, MAX_KEEPERS);
}

function portfolioValue(candidates) {
  return selectedPortfolio(candidates).reduce((sum, candidate) => sum + candidate.surplus, 0);
}

function strategyLabel(candidate, portfolioRank) {
  if (candidate.keeperYear > MAX_KEEPER_YEAR) return "Forced pool";
  if (candidate.surplus > 0 && portfolioRank <= MAX_KEEPERS) return "Current top-two keeper";
  if (candidate.surplus > 0) return "Trade-bait surplus";
  return "Pass at current values";
}

export function buildKeeperBoard(pack, { riskBuffer = TRADE_RISK_BUFFER } = {}) {
  if (!pack || !Array.isArray(pack.keeperCandidates) || !Array.isArray(pack.leagueConfig?.teams)) {
    throw new Error("Keeper board requires the validated draft pack.");
  }
  if (!Number.isSafeInteger(riskBuffer) || riskBuffer < 0 || riskBuffer > 10) throw new Error("Keeper trade risk buffer must be 0-10 whole dollars.");
  const teamsById = new Map(pack.leagueConfig.teams.map((team) => [team.id, team]));
  const fbgByPlayerId = new Map((pack.fbgAuctionValues?.values || []).map((row) => [row.playerId, row]));
  const groups = new Map(pack.leagueConfig.teams.map((team) => [team.id, []]));
  for (const candidate of pack.keeperCandidates) {
    if (!groups.has(candidate.teamId)) throw new Error(`${candidate.playerName} references an unknown keeper team.`);
    finiteWhole(candidate.keeperSalary, `${candidate.playerName} keeper salary`);
    finiteWhole(candidate.keeperYear, `${candidate.playerName} keeper year`);
    finiteWhole(candidate.marketValue, `${candidate.playerName} market value`);
    finiteWhole(candidate.surplus, `${candidate.playerName} surplus`);
    groups.get(candidate.teamId).push(candidate);
  }
  const ranks = new Map();
  for (const candidates of groups.values()) {
    [...candidates]
      .sort((left, right) => right.surplus - left.surplus || left.keeperSalary - right.keeperSalary || left.playerName.localeCompare(right.playerName))
      .forEach((candidate, index) => ranks.set(candidate.playerId, index + 1));
  }

  const rows = [];
  for (const candidate of pack.keeperCandidates) {
    const tenure = keeperContractTenure(candidate.keeperYear);
    const eligible = tenure.eligible;
    const sellerCandidates = groups.get(candidate.teamId);
    const sellerBase = portfolioValue(sellerCandidates);
    const sellerWithout = portfolioValue(sellerCandidates.filter((row) => row.playerId !== candidate.playerId));
    const rawSellerFloor = eligible ? Math.max(0, sellerBase - sellerWithout) : 0;
    const buyerOffers = [];
    if (eligible && candidate.surplus > 0) {
      for (const team of pack.leagueConfig.teams) {
        if (team.id === candidate.teamId) continue;
        const buyerCandidates = groups.get(team.id);
        const incrementalSurplus = portfolioValue([...buyerCandidates, candidate]) - portfolioValue(buyerCandidates);
        buyerOffers.push({ teamId: team.id, teamName: team.name, ceiling: Math.max(0, Math.floor(incrementalSurplus - riskBuffer)) });
      }
    }
    buyerOffers.sort((left, right) => right.ceiling - left.ceiling || left.teamName.localeCompare(right.teamName));
    const bestBuyerCeiling = buyerOffers[0]?.ceiling || 0;
    const sellerFloor = rawSellerFloor > 0 ? rawSellerFloor : bestBuyerCeiling > 0 ? 1 : 0;
    const negotiable = bestBuyerCeiling > 0 && bestBuyerCeiling >= sellerFloor;
    const bestBuyers = bestBuyerCeiling > 0
      ? buyerOffers.filter((offer) => offer.ceiling === bestBuyerCeiling).map((offer) => offer.teamName)
      : [];
    const tradeRead = !eligible
      ? "Ineligible - must return to pool"
      : negotiable
        ? `$${sellerFloor}-$${bestBuyerCeiling} current cap range`
        : bestBuyerCeiling > 0
          ? `Buyer ceiling $${bestBuyerCeiling}; seller loss $${sellerFloor}`
          : "No current cap-dollar edge";
    rows.push({
      playerId: candidate.playerId,
      playerName: candidate.playerName,
      position: candidate.position,
      currentTeamId: candidate.teamId,
      currentTeamName: teamsById.get(candidate.teamId).name,
      priorSalary: candidate.priorSalary,
      keeperSalary: candidate.keeperSalary,
      keeperYear: candidate.keeperYear,
      contractYearsUsed: tenure.yearsUsed,
      contractYearsLeft: tenure.yearsLeft,
      contractYearLabel: tenure.yearLabel,
      marketValue: candidate.marketValue,
      fbgAuctionValue: fbgByPlayerId.get(candidate.playerId)?.value ?? null,
      fbgAuctionRank: fbgByPlayerId.get(candidate.playerId)?.rank ?? null,
      surplus: candidate.surplus,
      eligible,
      portfolioRank: ranks.get(candidate.playerId),
      strategy: strategyLabel(candidate, ranks.get(candidate.playerId)),
      sellerFloor,
      sellerPortfolioLoss: rawSellerFloor,
      bestBuyerCeiling,
      negotiable,
      bestBuyers,
      buyerOffers,
      tradeRead,
      evidenceStatus: candidate.evidenceStatus,
      packId: pack.packId,
      packAsOf: pack.asOf,
      modelEffect: "none",
      ledgerEffect: "none",
    });
  }
  const teamOrder = new Map(pack.leagueConfig.teams.map((team, index) => [team.id, index]));
  return rows.sort((left, right) => teamOrder.get(left.currentTeamId) - teamOrder.get(right.currentTeamId) || left.portfolioRank - right.portfolioRank);
}

function opportunityBase(candidate) {
  const tenure = keeperContractTenure(candidate.keeperYear);
  return {
    playerId: candidate.playerId,
    playerName: candidate.playerName,
    position: candidate.position,
    keeperSalary: candidate.keeperSalary,
    keeperYear: candidate.keeperYear,
    contractYearsUsed: tenure.yearsUsed,
    contractYearsLeft: tenure.yearsLeft,
    contractYearLabel: tenure.yearLabel,
    marketValue: candidate.marketValue,
    rawSurplus: candidate.surplus,
  };
}

export function keeperTradeScenario(opportunity, capAmount) {
  if (!opportunity || !["acquire", "trade-away"].includes(opportunity.kind)) throw new Error("Keeper trade scenario requires an acquisition or trade-away opportunity.");
  finiteWhole(capAmount, "Cap payment");
  if (capAmount < 1) throw new Error("Cap payment must be at least $1.");
  const withinRange = capAmount >= opportunity.offerFloor && capAmount <= opportunity.offerCeiling;
  if (opportunity.kind === "acquire") {
    return {
      capAmount,
      allInCost: opportunity.keeperSalary + capAmount,
      playerNetSurplus: opportunity.marketValue - opportunity.keeperSalary - capAmount,
      portfolioGain: opportunity.incrementalSurplus - capAmount,
      withinRange,
    };
  }
  return {
    capAmount,
    allInCost: null,
    playerNetSurplus: null,
    portfolioGain: capAmount - opportunity.sellerPortfolioLoss,
    withinRange,
  };
}

export function buildKeeperTradeMarket(pack, { teamId = "dogs-of-war", riskBuffer = TRADE_RISK_BUFFER } = {}) {
  const board = buildKeeperBoard(pack, { riskBuffer });
  const team = pack.leagueConfig.teams.find((candidate) => candidate.id === teamId);
  if (!team) throw new Error("Keeper trade market requires a known team.");
  const teamCandidates = pack.keeperCandidates.filter((candidate) => candidate.teamId === teamId);
  const currentPortfolio = selectedPortfolio(teamCandidates);
  const currentPortfolioValue = portfolioValue(teamCandidates);
  const currentIds = new Set(currentPortfolio.map((candidate) => candidate.playerId));
  const candidateCounts = pack.leagueConfig.teams.map((candidateTeam) => ({
    teamId: candidateTeam.id,
    teamName: candidateTeam.name,
    count: pack.keeperCandidates.filter((candidate) => candidate.teamId === candidateTeam.id).length,
  }));

  const acquire = [];
  for (const row of board.filter((candidate) => candidate.currentTeamId !== teamId && candidate.eligible && candidate.surplus > 0)) {
    const buyerOffer = row.buyerOffers.find((offer) => offer.teamId === teamId);
    if (!buyerOffer || buyerOffer.ceiling < 1 || buyerOffer.ceiling < row.sellerFloor) continue;
    const candidate = pack.keeperCandidates.find((item) => item.playerId === row.playerId);
    const afterPortfolio = selectedPortfolio([...teamCandidates, candidate]);
    const afterIds = new Set(afterPortfolio.map((item) => item.playerId));
    const displaced = currentPortfolio.find((item) => !afterIds.has(item.playerId)) || null;
    const incrementalSurplus = portfolioValue([...teamCandidates, candidate]) - currentPortfolioValue;
    const openingScenario = keeperTradeScenario({
      ...opportunityBase(row),
      kind: "acquire",
      incrementalSurplus,
      offerFloor: row.sellerFloor,
      offerCeiling: buyerOffer.ceiling,
    }, row.sellerFloor);
    acquire.push({
      ...opportunityBase(row),
      kind: "acquire",
      ownerTeamId: row.currentTeamId,
      ownerTeamName: row.currentTeamName,
      ownerKeeperRank: row.portfolioRank,
      offerFloor: row.sellerFloor,
      offerCeiling: buyerOffer.ceiling,
      incrementalSurplus,
      portfolioGainAtOpening: openingScenario.portfolioGain,
      allInCostAtOpening: openingScenario.allInCost,
      playerNetAtOpening: openingScenario.playerNetSurplus,
      displacedPlayer: displaced ? { playerId: displaced.playerId, playerName: displaced.playerName, surplus: displaced.surplus } : null,
      modelEffect: "none",
      ledgerEffect: "none",
    });
  }
  acquire.sort((left, right) => right.portfolioGainAtOpening - left.portfolioGainAtOpening || right.incrementalSurplus - left.incrementalSurplus || left.playerName.localeCompare(right.playerName));

  const tradeAway = board
    .filter((row) => row.currentTeamId === teamId && row.eligible && row.surplus > 0 && row.negotiable)
    .map((row) => {
      const bestOffer = row.buyerOffers.find((offer) => offer.ceiling === row.bestBuyerCeiling);
      const highScenario = keeperTradeScenario({
        ...opportunityBase(row),
        kind: "trade-away",
        sellerPortfolioLoss: row.sellerPortfolioLoss,
        offerFloor: row.sellerFloor,
        offerCeiling: row.bestBuyerCeiling,
      }, row.bestBuyerCeiling);
      return {
        ...opportunityBase(row),
        kind: "trade-away",
        portfolioRank: row.portfolioRank,
        offerFloor: row.sellerFloor,
        offerCeiling: row.bestBuyerCeiling,
        sellerPortfolioLoss: row.sellerPortfolioLoss,
        portfolioGainAtCeiling: highScenario.portfolioGain,
        bestBuyerTeamId: bestOffer.teamId,
        bestBuyerTeamName: bestOffer.teamName,
        buyerFits: row.buyerOffers.filter((offer) => offer.ceiling > 0).slice(0, 3),
        protectedKeeper: currentIds.has(row.playerId),
        modelEffect: "none",
        ledgerEffect: "none",
      };
    })
    .sort((left, right) => right.portfolioGainAtCeiling - left.portfolioGainAtCeiling || Number(left.protectedKeeper) - Number(right.protectedKeeper) || right.offerCeiling - left.offerCeiling || left.playerName.localeCompare(right.playerName));

  return {
    teamId,
    teamName: team.name,
    currentPortfolioValue,
    currentPortfolio: currentPortfolio.map((candidate) => opportunityBase(candidate)),
    candidateCounts,
    completeTradeDiscovery: candidateCounts.every((candidate) => candidate.count > MAX_KEEPERS),
    acquire,
    tradeAway,
    riskBuffer,
    packId: pack.packId,
    packAsOf: pack.asOf,
    modelEffect: "none",
    ledgerEffect: "none",
  };
}

function csvCell(value) {
  let text = Array.isArray(value) ? value.join(" / ") : value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function keeperBoardCsv(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Keeper board CSV requires at least one row.");
  const columns = [
    ["Team", "currentTeamName"],
    ["Player", "playerName"],
    ["Pos", "position"],
    ["Prior Salary", "priorSalary"],
    ["2026 Keeper Cost", "keeperSalary"],
    ["2026 Keeper Year", "keeperYear"],
    ["Contract Years Used", "contractYearsUsed"],
    ["Eligible Years Left", "contractYearsLeft"],
    ["Contract Status", "contractYearLabel"],
    ["Current Market", "marketValue"],
    ["FBG Value", "fbgAuctionValue"],
    ["FBG Rank", "fbgAuctionRank"],
    ["Current Surplus", "surplus"],
    ["Eligible", "eligible"],
    ["Team Surplus Rank", "portfolioRank"],
    ["Current Strategy", "strategy"],
    ["Seller Floor", "sellerFloor"],
    ["Best Buyer Ceiling", "bestBuyerCeiling"],
    ["Negotiable", "negotiable"],
    ["Best Buyers", "bestBuyers"],
    ["Trade Read", "tradeRead"],
    ["Evidence", "evidenceStatus"],
    ["Pack", "packId"],
    ["Pack As Of", "packAsOf"],
  ];
  return `${columns.map(([label]) => csvCell(label)).join(",")}\r\n${rows.map((row) => columns.map(([, key]) => csvCell(row[key])).join(",")).join("\r\n")}\r\n`;
}
