import assert from "node:assert/strict";
import test from "node:test";
import { sortTradeProposals, tradeProposalStrength } from "../public/thunder-bowl/season/season-trade-ranking.mjs";

function proposal({ verdict, name, dogs = {}, rival = {}, confidence = "MEDIUM", direct = true }) {
  return {
    verdict,
    decisionConfidence: confidence,
    rival: { teamName: `${name} Team` },
    sends: [{ name: "Dogs Player", weekProjection: { directProjectionReady: direct } }],
    receives: [{ name, weekProjection: { directProjectionReady: direct } }],
    dogsDeltas: { week: 0, nextThree: 0, restOfSeason: 0, division: 0, playoffs: 0, ...dogs },
    rivalDeltas: { week: 0, nextThree: 0, restOfSeason: 0, division: 0, playoffs: 0, ...rival },
    rosterContext: {},
  };
}

test("trade proposals display OFFER, then MONITOR, then PASS regardless of incoming order", () => {
  const pass = proposal({ verdict: "PASS", name: "Pass Target", dogs: { restOfSeason: 8 } });
  const offer = proposal({ verdict: "OFFER", name: "Offer Target", dogs: { restOfSeason: 1 } });
  const monitor = proposal({ verdict: "MONITOR", name: "Monitor Target", dogs: { restOfSeason: 4 } });
  const input = [pass, offer, monitor];
  assert.deepEqual(sortTradeProposals(input).map((row) => row.verdict), ["OFFER", "MONITOR", "PASS"]);
  assert.deepEqual(input, [pass, offer, monitor], "sorting must not mutate the governed plan");
});

test("same-verdict proposals rank the stronger two-sided and schedule-window case first", () => {
  const weak = proposal({ verdict: "MONITOR", name: "Weak", dogs: { nextThree: 0.5, restOfSeason: 0.8 }, rival: { restOfSeason: -2 } });
  const strong = proposal({ verdict: "MONITOR", name: "Strong", dogs: { nextThree: 2.5, restOfSeason: 2, division: 3, playoffs: 4 }, rival: { restOfSeason: 0.5, playoffs: 0.4 } });
  assert.ok(tradeProposalStrength(strong) > tradeProposalStrength(weak));
  assert.equal(sortTradeProposals([weak, strong])[0].receives[0].name, "Strong");
});
