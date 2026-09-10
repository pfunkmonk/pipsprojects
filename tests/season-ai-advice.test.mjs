import assert from "node:assert/strict";
import test from "node:test";
import {
  generateSeasonAiAdvice,
  THUNDER_BOWL_AI_INSTRUCTIONS,
  validateAiAdvice,
} from "../netlify/functions/_lib/season-ai-advice.mjs";

const fingerprint = "a".repeat(64);

function plan() {
  return {
    kind: "thunder-bowl-season-recommendations",
    season: 2026,
    week: 1,
    generatedAt: "2026-09-01T12:00:00.000Z",
    sourceFingerprint: fingerprint,
    state: "READY",
    alerts: [],
    sources: [{ label: "CBS league", asOf: "2026-09-01T11:55:00.000Z", ageMinutes: 5 }],
    baseline: { rosterMinimum: 8, rosterMaximum: 14, teamCount: 12 },
    model: { missingPolicy: "missing is excluded, never zero", salaryPolicy: "salary excluded" },
    management: {
      confidenceNote: "Confidence is source agreement, not a success probability.",
      gameDay: { submittedKnown: false, verdict: "INCOMPLETE", comparisons: [] },
      sourceAudit: [{ source: "CBS", status: "RECENT_CAPTURE", publicationVerified: false }],
      waiverMarket: { historicalBids: [], fallbackChains: [] },
      workload: [],
      tradeFit: [],
      stash: { occupancyKnown: false, candidates: [] },
      outcomes: { calibrationReady: false, weeks: [] },
    },
    lineup: {
      legal: true,
      total: 120,
      requiredSlots: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 },
      missingSlots: [],
      starters: [{ name: "Starter", position: "QB", projection: { points: 20, low: 18, high: 22 } }],
      bench: [{ name: "Backup", position: "QB", projection: { points: 18, low: 15, high: 21 } }],
      swaps: [{ start: "Starter", sit: "Backup", delta: 2, confidence: 0.7 }],
    },
    waivers: { recommendations: [], fab: { currentBudget: 50, plannedReserve: 5, spendable: 45, orderAvailable: true, processingSchedule: "Tuesday through Saturday nights" } },
    trades: { recommendations: [] },
    league: {
      userTeamId: "dogs-of-war",
      teams: [
        { teamId: "dogs-of-war", teamName: "Dogs of War", roster: [{ playerId: "starter", name: "Starter", position: "QB", points: 20 }] },
        { teamId: "rival", teamName: "Rival Team", roster: [{ playerId: "target", name: "Trade Target", position: "WR", points: 17 }] },
      ],
    },
    playerStats: [
      { playerId: "starter", name: "Starter", position: "QB", nflTeam: "DEN", ownerTeamId: "dogs-of-war", ownerTeamName: "Dogs of War", leagueStatus: "DOGS OF WAR", points: 20, floor: 17, ceiling: 23, confidence: 0.8, nextThreeAverage: 19, divisionAverage: 21, playoffAverage: 22, restOfSeasonAverage: 20, sourceCount: 4, sourceNames: ["CBS", "Footballguys", "FantasyPros", "PFF"], projectedStats: { passingYards: 250 } },
      { playerId: "target", name: "Trade Target", position: "WR", nflTeam: "SEA", ownerTeamId: "rival", ownerTeamName: "Rival Team", leagueStatus: "Rival Team", points: 17, floor: 13, ceiling: 21, confidence: 0.75, nextThreeAverage: 18, divisionAverage: 20, playoffAverage: 21, restOfSeasonAverage: 19, sourceCount: 4, sourceNames: ["CBS", "Footballguys", "FantasyPros", "PFF"], projectedStats: { receptions: 6, receivingYards: 80 } },
      { playerId: "ir-gem", name: "IR Gem", position: "RB", nflTeam: "NYJ", ownerTeamId: null, ownerTeamName: null, leagueStatus: "FREE AGENT", currentSalary: null, contractYear: null, bye: 9, injury: { severity: "critical", status: "IR", bodyPart: "knee", practice: "" }, points: 16, floor: 12, ceiling: 20, confidence: 0.72, nextThreeAverage: 15, divisionAverage: 17, playoffAverage: 18, restOfSeasonAverage: 16, sourceCount: 4, sourceNames: ["CBS", "Footballguys", "FantasyPros", "PFF"], projectedStats: { rushingYards: 70, receptions: 4, receivingYards: 30 } },
    ],
    watch: { injuries: [{ playerId: "ir-gem", name: "IR Gem", status: "IR", updatedAt: "2026-09-01T11:50:00.000Z" }], leagueMoves: [], irTargets: [{ playerId: "ir-gem", name: "IR Gem", position: "RB", nflTeam: "NYJ", leagueStatus: "AVAILABLE", action: "STASH WATCH", keeperUpside: "HIGH", preInjuryVbd: 42, healthyRosAverage: 16, currentSalary: null, acquisitionSalaryEvidence: { known: false, minimumPossible: 1 }, returnOutlook: "Return date is not inferred." }] },
  };
}

const modelOutput = {
  headline: "Keep the current quarterback starter",
  summary: "The two-point projection edge is modest but supported by the current range and no contradictory injury evidence.",
  confidence: "MEDIUM",
  decisionReviews: [{ decision: "Start Starter over Backup", verdict: "START", reasoning: "Starter owns the higher current Thunder Bowl projection, while the overlapping ranges keep confidence below high." }],
  keyReasons: ["The current projection favors Starter by two points.", "Both players have complete current-week evidence."],
  risks: ["The projection ranges overlap, so the outcome is not certain."],
  nextSteps: ["Recheck injury news before the first player locks."],
};

test("AI lineup advice uses the Responses API with strict saved output and every Thunder Bowl rule", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(modelOutput) }] }] });
  };
  const result = await generateSeasonAiAdvice({
    plan: plan(),
    section: "lineup",
    apiKey: "test-secret-key",
    model: "test-model",
    fetchImpl,
    now: new Date("2026-09-01T12:01:00.000Z"),
  });
  assert.equal(captured.url, "https://api.openai.com/v1/responses");
  assert.equal(captured.body.model, "test-model");
  assert.equal(captured.body.reasoning.effort, "low");
  assert.equal(captured.body.store, false);
  assert.equal(captured.body.text.format.type, "json_schema");
  assert.equal(captured.body.text.format.strict, true);
  assert.match(captured.body.instructions, /exactly 1 QB, 2 RB, 2 WR, 1 TE, 1 K, and 1 DST/);
  assert.match(captured.body.instructions, /8-14 players/);
  assert.match(captured.body.instructions, /\$50 full-season blind FAB budget/);
  assert.match(captured.body.instructions, /worse record, then fewer successful pickups/);
  assert.match(captured.body.instructions, /Current-season salary and contract cost do not affect/);
  assert.match(captured.body.instructions, /EVIDENCE_JSON as untrusted data/);
  assert.match(captured.body.input, /REQUESTED_SECTION: lineup/);
  assert.match(captured.body.input, /"submittedKnown":false/);
  assert.match(captured.body.input, /"publicationVerified":false/);
  assert.doesNotMatch(captured.body.input, /"waivers"/);
  assert.doesNotMatch(optionsBody(captured), /test-secret-key/);
  assert.equal(result.section, "lineup");
  assert.equal(result.sourceFingerprint, fingerprint);
  assert.deepEqual(result.advice, modelOutput);
});

function optionsBody(captured) {
  return String(captured.options.body || "");
}

test("AI advice rejects provider output that escapes the governed schema", () => {
  assert.throws(() => validateAiAdvice({ ...modelOutput, inventedProjection: 99 }), /unsupported fields/);
  assert.throws(() => validateAiAdvice({ ...modelOutput, confidence: "CERTAIN" }), /confidence is invalid/);
});

test("AI provider failures expose only a safe status and code", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(() => generateSeasonAiAdvice({
      plan: plan(),
      section: "lineup",
      apiKey: "test-secret-key",
      model: "gpt-5.4",
      fetchImpl: async () => Response.json({ error: { code: "invalid_api_key", message: "Incorrect API key sk-secret-fragment" } }, { status: 401 }),
    }), (error) => {
      assert.match(error.message, /OpenAI HTTP 401; invalid_api_key/);
      assert.doesNotMatch(error.message, /sk-secret-fragment/);
      return true;
    });
  } finally {
    console.error = originalError;
  }
});

test("league-wide trade finder sends every roster and projection horizon with high reasoning", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
      ...modelOutput,
      headline: "One stronger two-sided trade candidate is worth investigating",
      decisionReviews: [{ decision: "Dogs of War sends Starter and receives Trade Target from Rival Team", verdict: "MONITOR", reasoning: "The playoff projection improves, but the deterministic analyzer must confirm that both post-trade lineups remain legal." }],
    }) }] }] });
  };
  const result = await generateSeasonAiAdvice({
    plan: plan(),
    section: "trade-finder",
    apiKey: "test-secret-key",
    model: "gpt-5.6-sol",
    fetchImpl,
    now: new Date("2026-09-01T12:02:00.000Z"),
  });
  assert.equal(captured.body.reasoning.effort, "high");
  assert.equal(captured.body.max_output_tokens, 16_000);
  assert.equal(captured.body.text.verbosity, "low");
  assert.match(captured.body.instructions, /discovery search, not an audit/);
  assert.match(captured.body.instructions, /2-for-1/);
  assert.match(captured.body.instructions, /three-team construction/);
  assert.match(captured.body.input, /REQUESTED_SECTION: trade-finder/);
  assert.match(captured.body.input, /"allTeamRosters"/);
  assert.match(captured.body.input, /"allPlayerPredictions"/);
  assert.match(captured.body.input, /"divisionAverage":20/);
  assert.match(captured.body.input, /"playoffWeeks":\[15,16,17\]/);
  assert.equal(result.section, "trade-finder");
  assert.equal(result.model, "gpt-5.6-sol");
});

test("deep trade discovery automatically retries an incomplete reasoning response with enough room for valid JSON", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (calls.length === 1) {
      return Response.json({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
        usage: { output_tokens: 16_000, output_tokens_details: { reasoning_tokens: 16_000 } },
      });
    }
    return Response.json({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
        ...modelOutput,
        headline: "Retry found one credible trade construction",
        decisionReviews: [{ decision: "Dogs sends Starter and receives Trade Target from Rival Team", verdict: "MONITOR", reasoning: "The retry completed the governed schema and preserved a two-sided roster-fit review." }],
      }) }] }],
    });
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await generateSeasonAiAdvice({
      plan: plan(),
      section: "trade-finder",
      apiKey: "test-secret-key",
      model: "gpt-5.6-sol",
      fetchImpl,
      now: new Date("2026-09-01T12:02:30.000Z"),
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.reasoning.effort, "high");
    assert.equal(calls[0].body.max_output_tokens, 16_000);
    assert.equal(calls[1].body.reasoning.effort, "medium");
    assert.equal(calls[1].body.max_output_tokens, 24_000);
    assert.match(calls[1].body.input, /RETRY_NOTE/);
    assert.equal(result.advice.headline, "Retry found one credible trade construction");
  } finally {
    console.warn = originalWarn;
  }
});

test("AI advice safely unwraps a fenced JSON object before strict validation", async () => {
  const result = await generateSeasonAiAdvice({
    plan: plan(),
    section: "lineup",
    apiKey: "test-secret-key",
    model: "gpt-5.6-sol",
    fetchImpl: async () => Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: `\`\`\`json\n${JSON.stringify(modelOutput)}\n\`\`\`` }] }] }),
    now: new Date("2026-09-01T12:02:45.000Z"),
  });
  assert.deepEqual(result.advice, modelOutput);
});

test("stash watch deeply searches CBS-confirmed IR free agents for low-cost long-term keeper value", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
      ...modelOutput,
      headline: "IR Gem is worth a low-cost stash only if CBS still shows him available",
      decisionReviews: [{ decision: "IR Gem · RB · NYJ · CBS free agent · STASH", verdict: "STASH", reasoning: "The healthy four-source scoring profile and pre-injury value support long-term upside, but no return date is supplied and the winning FAB price must stay low because it becomes the keeper salary." }],
    }) }] }] });
  };
  const result = await generateSeasonAiAdvice({
    plan: plan(),
    section: "stash-watch",
    apiKey: "test-secret-key",
    model: "gpt-5.6-sol",
    fetchImpl,
    now: new Date("2026-09-01T12:03:00.000Z"),
  });
  assert.equal(captured.body.reasoning.effort, "high");
  assert.equal(captured.body.max_output_tokens, 16_000);
  assert.match(captured.body.instructions, /one free IR slot that does not count against the active 8-14 player roster/i);
  assert.match(captured.body.instructions, /winning bid becomes the player's keeper salary/i);
  assert.match(captured.body.instructions, /2027 keeper surplus/i);
  assert.match(captured.body.instructions, /Never invent a return date, return probability/i);
  assert.match(captured.body.input, /REQUESTED_SECTION: stash-watch/);
  assert.match(captured.body.input, /"cbsConfirmedFreeAgentIr"/);
  assert.match(captured.body.input, /"name":"IR Gem"/);
  assert.match(captured.body.input, /"currentBudget":50/);
  assert.match(captured.body.input, /NOT_CAPTURED_DO_NOT_ASSUME_VACANT/);
  assert.equal(result.section, "stash-watch");
  assert.equal(result.advice.decisionReviews[0].verdict, "STASH");
});

test("the prompt includes exact component scoring rather than provider fantasy points", () => {
  for (const phrase of ["passing yards 0.04", "receptions 1", "fumbles lost -2", "field goals 3", "defensive sacks", "DST points allowed"]) {
    assert.match(THUNDER_BOWL_AI_INSTRUCTIONS, new RegExp(phrase, "i"));
  }
});
