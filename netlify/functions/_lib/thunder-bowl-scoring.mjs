export const THUNDER_BOWL_SCORING_FINGERPRINT = "tb26-ppr-6pt-pass-td-minus2-int-2pt-sack-50fg-v1";

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function thunderBowlPointsAllowed(pointsAllowed) {
  const value = number(pointsAllowed);
  if (value <= 0) return 10;
  if (value <= 6) return 8;
  if (value <= 13) return 6;
  if (value <= 20) return 4;
  if (value <= 34) return 0;
  if (value <= 44) return -4;
  return -6;
}

export function scoreThunderBowlProjectedStats(stats = {}, position = "") {
  const n = (key) => number(stats[key]);
  const offense = n("passingYards") * 0.04 + n("passingTouchdowns") * 6 - n("interceptionsThrown") * 2
    + n("passingTwoPointConversions") * 2
    + n("rushingYards") * 0.1 + n("rushingTouchdowns") * 6 + n("rushingTwoPointConversions") * 2
    + n("receptions") + n("receivingYards") * 0.1 + n("receivingTouchdowns") * 6
    + n("receivingTwoPointConversions") * 2 - n("fumblesLost") * 2;
  const kicking = n("fieldGoalsMade") * 3 + n("fieldGoalsMade50Plus") * 2 + n("extraPointsMade");
  const defenseHasGame = stats.defensiveGameProjected === true
    || ["defensiveSacks", "defensiveInterceptions", "defensiveFumblesRecovered", "defensiveTouchdowns", "defensiveSafeties", "defensivePointsAllowed", "defensiveYardsAllowed"]
      .some((key) => number(stats[key]) !== 0);
  const defense = n("defensiveSacks") * 2 + n("defensiveInterceptions") * 2 + n("defensiveFumblesRecovered") * 2
    + n("defensiveTouchdowns") * 6 + n("defensiveSafeties") * 2 + n("blockedKicks") * 2
    + (position === "DST" && defenseHasGame ? thunderBowlPointsAllowed(n("defensivePointsAllowed")) : 0);
  const returns = (n("kickReturnTouchdowns") + n("puntReturnTouchdowns")) * 6;
  return Math.round((offense + kicking + defense + returns) * 100) / 100;
}
