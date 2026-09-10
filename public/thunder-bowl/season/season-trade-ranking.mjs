const VERDICT_RANK = Object.freeze({ OFFER: 3, MONITOR: 2, PASS: 1 });
const CONFIDENCE_RANK = Object.freeze({ HIGH: 3, MEDIUM: 2, LOW: 1 });

function value(candidate, fallback = -20) {
  return Number.isFinite(candidate) ? Number(candidate) : fallback;
}

export function tradeProposalStrength(row) {
  const dogs = row?.dogsDeltas || {};
  const rival = row?.rivalDeltas || {};
  const dogsScore = value(dogs.week) * 0.75
    + value(dogs.nextThree) * 1.25
    + value(dogs.restOfSeason) * 2
    + value(dogs.division) * 1.25
    + value(dogs.playoffs) * 1.5;
  const rivalScore = value(rival.week) * 0.5
    + value(rival.nextThree) * 0.75
    + value(rival.restOfSeason) * 1.5
    + value(rival.division) * 0.75
    + value(rival.playoffs) * 1;
  const rivalWindows = [rival.week, rival.nextThree, rival.restOfSeason, rival.division, rival.playoffs].filter(Number.isFinite);
  const acceptancePenalty = rivalWindows.filter((candidate) => candidate < -0.35).length * 4
    + Math.max(0, -(rivalWindows.length ? Math.min(...rivalWindows) : 0)) * 2;
  const directEvidence = [...(row?.sends || []), ...(row?.receives || [])].every((player) => player?.weekProjection?.directProjectionReady);
  const incomingInjury = (row?.receives || []).some((player) => player?.injury?.status && !/^active$/i.test(player.injury.status));
  const evidenceAdjustment = (directEvidence ? 3 : -3) - (incomingInjury ? 4 : 0) - (row?.rosterContext?.positionalRisk ? 4 : 0);
  return Math.round((dogsScore + rivalScore - acceptancePenalty + evidenceAdjustment) * 10) / 10;
}

export function compareTradeProposals(left, right) {
  const verdict = (VERDICT_RANK[right?.verdict] || 0) - (VERDICT_RANK[left?.verdict] || 0);
  if (verdict) return verdict;
  const strength = tradeProposalStrength(right) - tradeProposalStrength(left);
  if (strength) return strength;
  const confidence = (CONFIDENCE_RANK[right?.decisionConfidence] || 0) - (CONFIDENCE_RANK[left?.decisionConfidence] || 0);
  if (confidence) return confidence;
  const leftName = `${left?.receives?.[0]?.name || ""}|${left?.rival?.teamName || ""}`;
  const rightName = `${right?.receives?.[0]?.name || ""}|${right?.rival?.teamName || ""}`;
  return leftName.localeCompare(rightName);
}

export function sortTradeProposals(rows = []) {
  return [...rows].sort(compareTradeProposals);
}
