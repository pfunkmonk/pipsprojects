import test from "node:test";
import assert from "node:assert/strict";

import { buildEvidenceExplanation } from "../public/thunder-bowl/season/season-evidence.mjs";

function fullText(explanation) {
  return [explanation.summary, ...explanation.sections.flatMap((group) => [group.title, ...group.items]), explanation.note || ""].join(" ");
}

test("every In-Season GM evidence type produces a plain-English recommendation explanation", () => {
  const projection = {
    name: "Test Player", position: "RB", points: 16.4, floor: 14.4, ceiling: 18.4, confidence: 0.82, opponent: "TB",
    sources: [{ source: "Footballguys", points: 16, weight: 0.6, input: "provider component stats scored by Thunder Bowl rules" }],
    injury: null,
  };
  const cases = [
    ["starter", projection],
    ["bench", { ...projection, name: "Bench Player" }],
    ["swap", { start: "Starter", sit: "Bench Player", position: "RB", delta: 2.3, confidence: 0.8, reason: "Starter has the stronger Week 1 projection." }],
    ["waiver", {
      verdict: "ADD", add: { name: "Free Agent" }, drop: { name: "Bench Player" },
      gains: { week: 2, nextThree: 1.4, restOfSeason: 0.8, resilienceWeeks: 1 }, dropCost: 0.2, confidence: 0.75,
      reason: "Free Agent improves the lineup; Bench Player is the lowest-cost legal drop.",
      availability: { asOf: "2026-09-08T12:00:00.000Z" }, acquisitionAdvice: "Confirm the waiver price before bidding.",
      evidence: { range: { floor: 12, median: 15, ceiling: 18 }, projections: projection.sources, role: null, news: [] },
    }],
    ["trade", {
      verdict: "EXPLORE", rival: { teamName: "Orange Crush" }, sends: [{ name: "Outgoing" }], receives: [{ name: "Incoming" }],
      dogsDeltas: { nextThree: 1, restOfSeason: 0.7 }, rivalDeltas: { nextThree: 0.2, restOfSeason: 0.1 },
      salary: { dogsDelta: 2 }, confidence: 0.7, whyRivalAccepts: "Orange Crush also improves slightly.",
      primaryRisk: "Projections can change.", keeperEffect: { sends: "Outgoing contract year 1", receives: "Incoming contract year 2", note: "Eligibility must be confirmed." },
    }],
    ["move", { playerName: "Moved Player", type: "PICKUP", from: null, to: { teamName: "Big Head" }, detectedAt: "2026-09-08T12:00:00.000Z", evidence: "Diff of two authenticated CBS snapshots." }],
    ["injury", { ...projection, status: "Questionable", severity: "moderate", leagueStatus: "DOGS OF WAR", bodyPart: "hamstring", practice: "limited", updatedAt: "2026-09-08T12:00:00.000Z", projection, news: [] }],
    ["ir", { ...projection, action: "STASH WATCH", status: "IR", leagueStatus: "AVAILABLE", keeperUpside: "HIGH", healthyRosAverage: 14, preInjuryMarketValue: 24, preInjuryVbd: 40, keeperCost: null, reason: "Healthy production and keeper upside merit monitoring.", returnOutlook: "No return date is inferred." }],
  ];

  for (const [kind, value] of cases) {
    const explanation = buildEvidenceExplanation(kind, value, { week: 1 });
    assert.ok(explanation.summary.length > 30, `${kind} needs a useful summary`);
    assert.ok(explanation.sections.length >= 2, `${kind} needs supporting reasons`);
    assert.ok(explanation.sections.every((group) => group.title && group.items.every((item) => typeof item === "string" && item.length > 5)));
    assert.doesNotMatch(fullText(explanation), /"(?:playerId|projectedStats|rankingRule)"\s*:/);
  }

  assert.match(fullText(buildEvidenceExplanation("starter", projection, { week: 1 })), /highest eligible|strongest eligible/);
  assert.match(fullText(buildEvidenceExplanation("waiver", cases[3][1], { week: 1 })), /eight required starters and 14-player maximum/);
  assert.match(fullText(buildEvidenceExplanation("trade", cases[4][1], { week: 1 })), /rational for both sides/);
  assert.match(fullText(buildEvidenceExplanation("move", cases[5][1], { week: 1 })), /does not guess/);
  assert.match(fullText(buildEvidenceExplanation("injury", cases[6][1], { week: 1 })), /never increases the projection/);
  assert.match(fullText(buildEvidenceExplanation("ir", cases[7][1], { week: 1 })), /does not invent a return date/);
});
