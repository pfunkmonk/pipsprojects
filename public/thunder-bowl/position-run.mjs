export const POSITION_RUN_VERSION = "position-run-v1";

export const DEFAULT_POSITION_RUN_CONFIG = Object.freeze({
  lookback: 6,
  decay: 0.75,
  minimumObservedSales: 4,
  minimumPositionSales: 2,
  intensityThreshold: 1.35,
  priceThreshold: 2,
  expectedShare: Object.freeze({ QB: 0.12, RB: 0.28, WR: 0.34, TE: 0.12, K: 0.07, DST: 0.07 }),
  overpayWeight: 0.6,
  tierCliffWeight: 0.5,
  missedNeedWeight: 0.5,
  maximumDollarImpact: 3,
  maximumVbdImpact: 3,
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function activeTeamDemand(state, position, referencePrice) {
  if (!state?.teams || !state?.config) return { fundedTeams: 0, needyTeams: 0 };
  let fundedTeams = 0;
  let needyTeams = 0;
  for (const team of Object.values(state.teams)) {
    if (!team || team.openSlots <= 0) continue;
    const starterNeed = Math.max(0, finite(state.config.starterRequirements?.[position]) - finite(team.positionCounts?.[position]));
    const depthNeed = ["RB", "WR"].includes(position)
      ? finite(team.positionCounts?.[position]) < 3
      : finite(team.positionCounts?.[position]) < Math.max(1, finite(state.config.starterRequirements?.[position]));
    if (!starterNeed && !depthNeed) continue;
    needyTeams += 1;
    const reserveSafeMaximum = Math.max(0, finite(team.cash) - Math.max(0, finite(team.openSlots) - 1));
    const legalMaximum = Math.max(finite(team.legalMaxBid), reserveSafeMaximum);
    if (legalMaximum >= Math.max(1, finite(referencePrice, 1))) fundedTeams += 1;
  }
  return { fundedTeams, needyTeams };
}

/**
 * Detects short-lived position pressure from the most recent active sales.
 * The result is bounded advisory evidence. Callers may route `vbdDelta` through
 * their existing authoritative +/-3 VBD gate, but this module never mutates state.
 */
export function detectPositionRun({
  sales = [],
  position,
  state = null,
  referencePrice = 1,
  tierSupply = 0,
  tierCliff = 0,
  userTeamId = "dogs-of-war",
  config: suppliedConfig = {},
} = {}) {
  const config = { ...DEFAULT_POSITION_RUN_CONFIG, ...suppliedConfig };
  const normalizedPosition = String(position || "").toUpperCase();
  const recent = (Array.isArray(sales) ? sales : []).slice(-config.lookback);
  const observations = recent.map((sale, index) => {
    const age = recent.length - 1 - index;
    const weight = Math.pow(config.decay, age);
    const expected = Math.max(1, finite(sale.expectedPrice ?? sale.marketValue ?? sale.baseline, 1));
    return {
      position: String(sale.position || "").toUpperCase(),
      weight,
      residualDollars: clamp(finite(sale.amount, expected) - expected, -25, 40),
    };
  });

  const totalWeight = observations.reduce((sum, row) => sum + row.weight, 0);
  const matching = observations.filter((row) => row.position === normalizedPosition);
  const matchingWeight = matching.reduce((sum, row) => sum + row.weight, 0);
  const frequencySignal = totalWeight ? matchingWeight / totalWeight : 0;
  const observedShare = recent.length ? matching.length / recent.length : 0;
  const expectedShare = finite(config.expectedShare?.[normalizedPosition], 0.15);
  const priceSignal = matchingWeight
    ? matching.reduce((sum, row) => sum + row.residualDollars * row.weight, 0) / matchingWeight
    : 0;

  const demand = activeTeamDemand(state, normalizedPosition, referencePrice);
  const enoughEvidence = recent.length >= config.minimumObservedSales && matching.length >= config.minimumPositionSales;
  const frequencyRun = enoughEvidence
    && matchingWeight >= config.intensityThreshold
    && observedShare >= Math.min(1, expectedShare * 2);
  const priceRun = enoughEvidence && priceSignal >= config.priceThreshold;
  const active = frequencyRun || priceRun;
  const status = frequencyRun && priceRun ? "HOT" : active ? "WARM" : "COOLING";
  const supply = Math.max(0, Math.floor(finite(tierSupply)));
  const demandRatio = demand.needyTeams ? demand.fundedTeams / demand.needyTeams : 0;
  const intensityRatio = clamp(matchingWeight / Math.max(config.intensityThreshold, 0.01), 0, 1);
  const supplyContinuation = supply <= 0 ? 0 : clamp(supply / Math.max(4, supply), 0.2, 1);
  const pContinue = active ? clamp((0.55 * intensityRatio + 0.45 * demandRatio) * supplyContinuation, 0, 1) : 0;
  const rawDollarImpact = active
    ? config.overpayWeight * Math.max(0, priceSignal)
      + config.tierCliffWeight * Math.max(0, finite(tierCliff)) * pContinue
      + config.missedNeedWeight * demand.fundedTeams
    : 0;
  const dollarImpact = clamp(Math.round(rawDollarImpact), 0, config.maximumDollarImpact);
  const vbdDelta = clamp(round1(rawDollarImpact), 0, config.maximumVbdImpact);
  const userTeam = state?.teams?.[userTeamId];
  const userStarterNeed = userTeam && state?.config
    ? Math.max(0, finite(state.config.starterRequirements?.[normalizedPosition]) - finite(userTeam.positionCounts?.[normalizedPosition]))
    : 0;
  const lastMatchingCount = matching.length;

  return {
    modelVersion: POSITION_RUN_VERSION,
    modelEffect: "bounded_advisory",
    position: normalizedPosition,
    active,
    status,
    strength: status,
    score: round1(pContinue * 100),
    lookbackSales: recent.length,
    matchingSales: lastMatchingCount,
    frequencySignal: round1(frequencySignal),
    observedShare: round1(observedShare),
    expectedShare: round1(expectedShare),
    weightedIntensity: round1(matchingWeight),
    overpayDollars: round1(priceSignal),
    frequencyRun,
    priceRun,
    fundedTeams: demand.fundedTeams,
    needyTeams: demand.needyTeams,
    tierSupply: supply,
    tierCliff: Math.max(0, round1(finite(tierCliff))),
    pContinue: round1(pContinue),
    needByDogs: Boolean(userStarterNeed),
    dollarImpact,
    vbdDelta,
    note: !enoughEvidence
      ? `Waiting for at least ${config.minimumObservedSales} sales and ${config.minimumPositionSales} ${normalizedPosition} sales; a single sale never triggers a run.`
      : active
        ? `${lastMatchingCount} of the last ${recent.length} sales were ${normalizedPosition}; ${demand.fundedTeams} funded team${demand.fundedTeams === 1 ? "" : "s"} still show demand.`
        : `${normalizedPosition} pressure is below both the frequency and +$${config.priceThreshold} overpay triggers.`,
  };
}

export function buildPositionRunMap({ sales = [], state = null, referencePriceFor = () => 1, tierSupplyFor = () => 0, positions = [] } = {}) {
  return Object.fromEntries(positions.map((position) => [position, detectPositionRun({
    sales,
    position,
    state,
    referencePrice: referencePriceFor(position),
    tierSupply: tierSupplyFor(position),
  })]));
}
