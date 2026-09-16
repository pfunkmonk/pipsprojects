function finite(value) {
  return value !== null && value !== "" && typeof value !== "boolean" && Number.isFinite(Number(value));
}

function decimal(value, digits = 1) {
  return finite(value) ? Number(value).toFixed(digits) : null;
}

function points(value) {
  const amount = decimal(value);
  return amount === null ? "not available" : `${amount} point${Number(amount) === 1 ? "" : "s"}`;
}

function signedPoints(value) {
  if (!finite(value)) return "not available";
  const amount = Number(value);
  return `${amount >= 0 ? "+" : ""}${amount.toFixed(1)} point${Math.abs(amount) === 1 ? "" : "s"}`;
}

function confidence(value) {
  if (!finite(value)) return "Source agreement is unavailable because there is insufficient comparable evidence.";
  const percent = Math.round(Number(value) * 100);
  const label = percent >= 75 ? "High" : percent >= 55 ? "Moderate" : "Cautious";
  return `${label} source agreement (index ${Number(value).toFixed(2)}). This is not a calibrated probability of success.`;
}

function dateTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return "an unavailable time";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function section(title, items) {
  return { title, items: items.filter((item) => clean(item)) };
}

function projectionOverview(row) {
  if (!finite(row?.points)) return "There is no safe current-week projection for this player, so missing data is not treated as zero.";
  const range = finite(row.floor) && finite(row.ceiling)
    ? row.rangeKind === "CALIBRATED_80"
      ? ` The ${decimal(row.floor)}–${decimal(row.ceiling)} range is the position's empirical 80% absolute-error band from ${row.intervalSampleCount} completed player-games.`
      : ` The ${decimal(row.floor)}–${decimal(row.ceiling)} range is the current provider envelope, not a prediction interval.`
    : "";
  return `The current Thunder Bowl projection is ${points(row.points)}.${range}`;
}

function matchup(row) {
  if (finite(row?.bye) && Number(row.bye) === Number(row.week)) return `This player is on a Week ${row.week} bye.`;
  const opponent = clean(row?.opponent);
  const gameTime = clean(row?.gameTime);
  if (!opponent && !gameTime) return "The matchup or kickoff time is not yet registered.";
  return `Matchup: ${opponent || "opponent pending"}${gameTime ? ` at ${gameTime}` : ""}.`;
}

function projectionSourceItems(sources = []) {
  if (!Array.isArray(sources) || !sources.length) {
    return ["No current premium weekly source was available, so the governed baseline is being used with reduced confidence."];
  }
  return sources.flatMap((source) => {
    const weight = finite(source.weight) ? ` It supplies ${Math.round(Number(source.weight) * 100)}% of the registered blend.` : "";
    const method = clean(source.input);
    const input = method === "provider component stats scored by Thunder Bowl rules"
      ? " Its projected yards, receptions, touchdowns, turnovers, kicking, or defense statistics were converted with Thunder Bowl scoring—not the provider's fantasy-points total."
      : /signed-in .+ component stats/i.test(method)
        ? ` These are current raw component projections read through your signed-in ${clean(source.source) || "provider"} session and converted with Thunder Bowl scoring—not the provider's fantasy-points total.`
        : method ? ` Input method: ${method}.` : "";
    return [
      `${clean(source.source) || "A registered source"} projects ${points(source.points)}.${weight}${input}`,
      ...(Array.isArray(source.scoringCaveats) ? source.scoringCaveats.map((caveat) => `${clean(source.source) || "This source"} limitation: ${clean(caveat)}`) : []),
    ];
  });
}

function injuryItems(injury) {
  if (!injury) return ["No actionable injury designation is attached to this player."];
  return [
    `Current designation: ${clean(injury.status) || "unclear"}${clean(injury.bodyPart) ? ` (${injury.bodyPart})` : ""}.`,
    clean(injury.practice) ? `Practice participation: ${injury.practice}.` : "Practice participation has not been reported.",
    injury.updatedAt ? `Latest registered update: ${dateTime(injury.updatedAt)}.` : "The injury update time is unavailable.",
    "Injury evidence can remove an unsafe starter, but it never adds projected points.",
  ];
}

function playerExplanation(value, kind, week) {
  const position = clean(value.position) || "required";
  const name = clean(value.name) || "This player";
  const adviceTeam = clean(value.adviceTeamName) || "Dogs of War";
  const weekLabel = finite(week) ? `Week ${week}` : "the current week";
  const critical = /injured reserve|\bir\b|pup|physically unable|\bout\b/i.test(clean(value.injury?.status));
  const summary = kind === "starter"
    ? `${name} is recommended in a required ${position} slot because this is one of your highest eligible ${weekLabel} projections at that position.`
    : kind === "free-agent"
      ? `${name} is a CBS-confirmed free agent worth comparing because the ${points(value.points)} projection is ${signedPoints(value.delta)} above ${value.starterName || "the displayed starter"} for ${weekLabel}.`
    : critical
      ? `${name} is on the bench because the registered ${value.injury.status} designation prevents the advisor from treating this player as a safe starter.`
      : finite(value.points)
        ? `${name} is on ${adviceTeam}'s bench because another eligible ${position} on that roster has the stronger current-week projection.`
        : `${name} is on the bench because a safe current-week projection is missing; the advisor does not turn missing data into zero.`;
  return {
    summary,
    sections: [
      section("Expected output", [projectionOverview(value), confidence(value.confidence), matchup({ ...value, week })]),
      section("Why the lineup chose this", [
        kind === "starter"
          ? `The optimizer filled ${adviceTeam}'s exact legal lineup—1 QB, 2 RB, 2 WR, 1 TE, 1 K, and 1 DST—with the strongest eligible projections on that roster.`
          : kind === "free-agent"
            ? `${name} is not on ${adviceTeam}. CBS confirms the player is currently available, so this row is a pickup comparison—not an instruction to place the player directly into the lineup.`
          : `The optimizer compares players only against the required starters at the same position; bench points do not count toward the lineup total.`,
        kind === "free-agent" ? "Any pickup still has to satisfy the 14-player maximum, use a legal drop when necessary, and justify its FAB cost; this comparison does not override the governed Waiver Wire tab." : "",
        "Players with a critical status or no usable projection are excluded from starting consideration.",
      ]),
      section("Projection sources", projectionSourceItems(value.sources)),
      section("Health check", injuryItems(value.injury)),
    ],
  };
}

function scoringPreviewPlayerExplanation(value, role, week) {
  const name = clean(value.name) || "This player";
  const team = clean(value.adviceTeamName) || "this team";
  const isStarter = role === "scoring-preview-starter";
  const hasActual = finite(value.actualPoints);
  return {
    summary: `${name} appears here because CBS lists the player as ${isStarter ? "a submitted starter" : "a reserve"} for ${team} in Week ${week || "the current week"}; ${hasActual ? `CBS currently reports ${points(value.actualPoints)} as the player's ${value.scoreStatus === "FINAL" ? "final" : "live"} Thunder Bowl score, while the frozen forecast was ${points(value.points)}.` : `the displayed ${points(value.points)} is the frozen Thunder Bowl projection.`}`,
    sections: [
      section("CBS lineup status", [
        `CBS is the authority for whether ${name} is currently submitted as ${isStarter ? "a starter" : "a reserve"}.`,
        "The preview does not optimize or silently replace either team's submitted CBS lineup.",
        "Updating CBS captures all league matchups, submitted starters and reserves, plus any live or final player scores.",
      ]),
      section("Result status", hasActual ? [
        `CBS score status: ${value.scoreStatus === "FINAL" ? "final" : "live/in progress"}.`,
        clean(value.liveStats) || "CBS has not displayed a component-stat summary for this player.",
        "Final scores are archived for accuracy calibration; live scores are displayed but cannot train the projection model.",
      ] : ["The player has not recorded a CBS score yet; only the frozen pregame projection is shown."]),
      section("Expected output", [projectionOverview(value), confidence(value.confidence), matchup({ ...value, week })]),
      section("Projection sources", projectionSourceItems(value.sources)),
      section("Health check", injuryItems(value.injury)),
    ],
  };
}

function swapExplanation(value, week) {
  const edge = signedPoints(value.delta);
  const weekLabel = finite(week) ? `Week ${week}` : "current-week";
  const strength = clean(value.strength) || "UNRATED";
  const summary = strength === "TOSS-UP"
    ? `${value.start} remains the optimizer's narrow choice over ${value.sit}, but the ${edge.replace(/^\+/, "")} edge is a toss-up—not a firm start/sit directive.`
    : strength === "LEAN"
      ? `${value.start} is a modest lean over ${value.sit}; the ${edge.replace(/^\+/, "")} edge is useful but not decisive.`
      : `${value.start} is a strong start over ${value.sit} because the ${edge.replace(/^\+/, "")} edge clears the governed strong-call gate.`;
  return {
    summary,
    sections: [
      section("Strength of this call", [
        clean(value.reason) || `${value.start} has the stronger registered projection.`,
        `The estimated lineup edge is ${edge}.`,
        finite(value.materialityThreshold) ? `Edges below ${points(value.materialityThreshold)} are non-actionable projection-error toss-ups.` : "",
        finite(value.strongThreshold) ? `A call normally needs at least ${points(value.strongThreshold)} to qualify as strong.` : "",
        finite(value.sourceDisagreement) ? `The largest registered provider spread for these players is ${points(value.sourceDisagreement)}.` : "",
        value.rangesOverlap ? "The players' displayed projection ranges overlap, so the lower-projected player still has a plausible path to finishing higher." : "",
        confidence(value.confidence),
      ]),
      section("Risk and lineup flexibility", [
        value.starterInjury?.status ? `${value.start} carries a ${value.starterInjury.status} designation; recheck the latest news before lock.` : "No registered injury designation weakens the selected starter.",
        clean(value.timingRisk) || "No earlier-game flexibility penalty is registered for this comparison; an early starter must clear three points when a viable later alternative exists.",
      ]),
      section("Rules applied", [
        `This is a position-for-position comparison at ${value.position}, so it preserves the required legal lineup.`,
        "Only starting-lineup points count; projected bench points are excluded.",
      ]),
    ],
  };
}

function waiverExplanation(value, week) {
  const add = value.add || {};
  const drop = value.drop || null;
  const gains = value.gains || {};
  const evidence = value.evidence || {};
  const role = evidence.role;
  const news = Array.isArray(evidence.news) ? evidence.news : [];
  const availability = value.availability || {};
  const fab = value.fab || {};
  const alternatives = Array.isArray(value.alternatives) ? value.alternatives : [];
  const weekLabel = finite(week) ? `Week ${week}` : "Current week";
  const verdict = String(value.verdict || "WATCH").toUpperCase();
  const policy = value.policy || {};
  const summary = verdict === "WATCH"
    ? `Watch ${add.name}, but do not add the player for ${drop?.name || "a roster spot"}; the move does not clear the governed season-value and protected-drop gates.`
    : verdict === "RENTAL"
      ? `${add.name} is an emergency short-term rental, not a rest-of-season roster upgrade.`
      : `The advisor ranks ${add.name} as ${verdict === "ADD" ? "a STRONG BID" : "a VALUE BID"} because ${drop ? `adding ${add.name} for ${drop.name}` : `adding ${add.name} into an open roster spot`} keeps the roster legal and clears the conservative immediate, three-week, and rest-of-season value gates.`;
  return {
    summary,
    sections: [
      section("Projected effect", [
        `${weekLabel}: ${signedPoints(gains.week)}.`,
        `Average over the next three weeks: ${signedPoints(gains.nextThree)}.`,
        `Average over the rest of the season: ${signedPoints(gains.restOfSeason)}.`,
        finite(gains.resilienceWeeks) && Number(gains.resilienceWeeks) > 0 ? `The move also creates a complete legal lineup in ${gains.resilienceWeeks} additional tested week${Number(gains.resilienceWeeks) === 1 ? "" : "s"}.` : "The move does not rely on inventing extra roster flexibility.",
      ]),
      section("Why this player and this drop", [
        clean(value.reason),
        drop && finite(value.dropValue?.week) ? `${drop.name} is projected for ${points(value.dropValue.week)} in ${weekLabel}, ${points(value.dropValue.nextThree)} per game over the next three weeks, and ${points(value.dropValue.restOfSeason)} per game over the rest of the season. That depth value is counted even if ${drop.name} is not currently starting.` : "No player must be dropped because the roster has an open spot.",
        drop && finite(value.depthDelta?.week) ? `The added player's own projection minus the dropped player's projection is ${signedPoints(value.depthDelta.week)} for ${weekLabel}, ${signedPoints(value.depthDelta.nextThree)} over the next three, and ${signedPoints(value.depthDelta.restOfSeason)} over the rest of the season; this is separate from the optimized starting-lineup change above.` : "",
        clean(policy.rationale),
        clean(policy.dropProtection?.reason),
        evidence.range && finite(evidence.range.median) ? `${add.name}'s ${weekLabel} projection is ${points(evidence.range.median)}, with a ${decimal(evidence.range.floor)}–${decimal(evidence.range.ceiling)} range.` : "",
        confidence(value.confidence),
      ]),
      section("Availability and roster rules", [
        `${add.name} was confirmed available by the authenticated CBS all-team roster snapshot${availability.asOf ? ` captured ${dateTime(availability.asOf)}` : ""}.`,
        "The advisor tested the move against the league's eight required starters and 14-player maximum.",
        clean(evidence.rosterFit?.rationale),
        "An extra K or DST, or a third QB, is rejected unless it replaces the same position or solves a documented current-week availability need.",
        "A captured low-cost keeper contract can veto a drop but never inflates a free agent's ranking; the unknown winning FAB bid is not assumed to be a cheap future salary.",
      ]),
      section("Blind-auction bid plan", finite(fab.recommended) ? [
        `Recommended bid: $${Number(fab.recommended).toFixed(0)}; do not exceed $${Number(fab.maximum).toFixed(0)} for this claim.`,
        finite(fab.currentBudget)
          ? `CBS-confirmed current FAB balance: $${Number(fab.currentBudget).toFixed(0)}; the recommended bid would leave $${Number(fab.budgetAfter).toFixed(0)}.`
          : `CBS has not exposed your current remaining balance. The dollar cap uses the league's $${Number(fab.bidBudget || 50).toFixed(0)} opening budget as a conservative sizing basis; never submit more than the balance shown in CBS.`,
        `The model protects $${Number(fab.plannedReserve).toFixed(0)} for later injury coverage${fab.specialTeamsByes?.length ? ` and ${fab.specialTeamsByes.map((item) => `${item.position} Week ${item.week}`).join(" plus ")} bye replacements` : ""}.`,
        finite(fab.tiePosition) ? `On an equal bid, Dogs of War currently ranks about ${Number(fab.tiePosition).toFixed(0)} of 12: worse record first, then fewer successful pickups this week, then CBS FAB order.` : "CBS tie position is not available yet.",
        Number(fab.earlierClaimWinsAssumed || 0) > 0 ? `That tie estimate conservatively assumes the ${Number(fab.earlierClaimWinsAssumed).toFixed(0)} higher displayed claim${Number(fab.earlierClaimWinsAssumed) === 1 ? " was" : "s were"} won first in this run.` : "This is the first displayed claim, so no earlier same-run win is assumed.",
        "Each successful pickup immediately increases that team's weekly pickup count, lowering its priority for a later equal bid in the same overnight run.",
        `Processing schedule: ${clean(fab.processingSchedule) || "Tuesday through Saturday nights"}.`,
        fab.bidHistoryAvailable ? "CBS bid history is available for competition calibration." : "CBS does not currently expose enough losing-bid history to calibrate rival bids, so the maximum is a conservative value cap—not a prediction of the winning price.",
        alternatives.length ? `If this player is gone, continue with ${alternatives.map((item) => `#${item.priority} ${item.name}${finite(item.recommendedBid) ? ` at $${item.recommendedBid}` : ""}`).join(", ")}.` : "No lower-ranked alternative cleared every current gate.",
      ] : [
        verdict === "WATCH"
          ? "No bid is recommended because this is a watch item, not an actionable claim."
          : clean(fab.unavailableReason) || "FAB balances, standings, and priority order have not been captured, so the advisor will not invent a bid.",
      ]),
      section("What the bid does not use", [
        "The bid is constrained by the separate $50 season FAB balance. A player's unknown post-acquisition salary does not increase his waiver ranking; a captured inexpensive keeper contract is used only as protection against an unnecessarily destructive drop.",
      ]),
      section("Role and news", [
        role ? `Depth-chart role: ${role.starter ? "starter" : `depth order ${role.order ?? "unknown"}`}${clean(role.status) ? `; status ${role.status}` : ""}.` : "No additional depth-chart signal is registered.",
        ...news.map((item) => `${clean(item.source) || "News"}: ${clean(item.summary) || clean(item.title) || "No summary available"}`),
        ...projectionSourceItems(evidence.projections),
      ]),
    ],
  };
}

function deltaItem(label, value) {
  return finite(value) ? `${label}: ${signedPoints(value)} per optimal lineup.` : "";
}

function tradeExplanation(value) {
  const send = (value.sends || []).map((item) => item.name).join(" + ") || "the outgoing player";
  const receive = (value.receives || []).map((item) => item.name).join(" + ") || "the incoming player";
  const rival = value.rival?.teamName || "the other team";
  const dogs = value.dogsDeltas || {};
  const theirs = value.rivalDeltas || {};
  const verdict = String(value.verdict || "PASS").toUpperCase();
  const playerEvidence = [...(value.sends || []), ...(value.receives || [])];
  return {
    summary: verdict === "OFFER"
      ? `This is an OFFER because sending ${send} for ${receive} produces a meaningful, evidence-backed Dogs of War gain and a credible multi-horizon incentive for ${rival}.`
      : verdict === "MONITOR"
        ? `Keep ${send} for ${receive} on the MONITOR list, but do not send it yet; the edge, evidence, or rival incentive is not strong enough.`
        : `PASS on sending ${send} for ${receive}; the modeled edge or ${rival}'s acceptance case does not clear the governed trade gate.`,
    sections: [
      section("Why it helps Dogs of War", [
        deltaItem("Next three weeks", dogs.nextThree),
        deltaItem("Rest of season", dogs.restOfSeason),
        deltaItem("Remaining division weeks", dogs.division),
        deltaItem("Playoff weeks", dogs.playoffs),
        confidence(value.confidence),
      ]),
      section(`Why ${rival} might accept`, [
        clean(value.whyRivalAccepts),
        deltaItem(`${rival}'s Week`, theirs.week),
        deltaItem(`${rival}'s rest of season`, theirs.restOfSeason),
        deltaItem(`${rival}'s next three weeks`, theirs.nextThree),
        deltaItem(`${rival}'s division weeks`, theirs.division),
        deltaItem(`${rival}'s playoff weeks`, theirs.playoffs),
      ]),
      section("Direct player evidence", playerEvidence.flatMap((player) => [
        `${player.name}: ${finite(player.weekProjection?.points) ? points(player.weekProjection.points) : "no safe current projection"}; ${player.injury?.status || "Active"}; ${Number(player.weekProjection?.directSourceCount || 0)} fresh signed-in component-stat source${Number(player.weekProjection?.directSourceCount || 0) === 1 ? "" : "s"}.`,
        ...(player.news || []).length
          ? (player.news || []).slice(0, 2).map((item) => `${clean(item.source) || "News"}: ${clean(item.summary) || clean(item.title)}`)
          : [`No current CBS or Footballguys news item matched ${player.name}; use the News button to recheck the all-player cache.`],
      ])),
      section("Roster and lineup checks", [
        "The comparison keeps both teams on a legal starter path and evaluates exact weekly starting lineups; bench totals are excluded.",
        clean(value.rosterContext?.positionalRisk),
        `Dogs of War's outgoing player is currently classified as ${clean(value.rosterContext?.dogs?.outgoingRole) || "unknown"} depth. Both rosters remain ${value.rosterContext?.dogs?.afterSize || "within the legal"} players after the proposed exchange.`,
        "The advisor compares current-season production and roster fit only.",
        "The automated idea rail tests one-for-one trades. The separate proposal analyzer supports multi-player and two- or three-team packages.",
      ]),
      section("Main risk", [clean(value.primaryRisk)]),
    ],
  };
}

function moveExplanation(value) {
  const from = value.from?.teamName || "the available-player pool";
  const to = value.to?.teamName || "the available-player pool";
  return {
    summary: `${value.playerName} is shown because the player's CBS roster owner changed from ${from} to ${to} between two authenticated league snapshots.`,
    sections: [
      section("What changed", [
        `Detected change: ${clean(value.type) || "roster change"}.`,
        `Previous location: ${from}. Current location: ${to}.`,
        value.detectedAt ? `Detected in the snapshot captured ${dateTime(value.detectedAt)}.` : "",
      ]),
      section("What the advisor is—and is not—claiming", [
        clean(value.evidence) || "The change comes from comparing two authenticated all-team CBS roster snapshots.",
        "The advisor reports the ownership change but does not guess whether it came from waivers, free agency, a trade, or a commissioner correction.",
      ]),
    ],
  };
}

function injuryExplanation(value) {
  const news = Array.isArray(value.news) ? value.news : [];
  return {
    summary: `${value.name} is on the injury watch because the latest registered status is ${clean(value.status) || "unclear"} with ${clean(value.severity) || "actionable"} severity.`,
    sections: [
      section("Current situation", [
        `League availability: ${clean(value.leagueStatus) || "unconfirmed"}.`,
        clean(value.bodyPart) ? `Reported injury: ${value.bodyPart}.` : "The injured body part is not registered.",
        clean(value.practice) ? `Practice participation: ${value.practice}.` : "Practice participation has not been reported.",
        clean(value.notes),
        value.updatedAt ? `Latest registered update: ${dateTime(value.updatedAt)}.` : "",
      ]),
      section("Fantasy impact", [
        projectionOverview(value.projection || {}),
        confidence(value.projection?.confidence),
        "A critical status can remove the player from safe starting consideration. Injury evidence never increases the projection.",
      ]),
      section("Supporting reports", [
        ...news.map((item) => `${clean(item.source) || "News"}: ${clean(item.summary) || clean(item.title) || "No summary available"}`),
        ...projectionSourceItems(value.projection?.sources),
      ]),
    ],
  };
}

function irExplanation(value, week) {
  const action = clean(value.action) || "MONITOR";
  const keeperEvaluationActive = value.keeperEvaluationActive === true && finite(week) && Number(week) >= 13;
  const acquisition = value.acquisitionSalaryEvidence || {};
  return {
    summary: `${value.name} is a ${action.toLowerCase()} because reserve-list evidence is confirmed and the player's healthy scoring profile and ${String(value.keeperUpside || "speculative").toLowerCase()} keeper upside justify a long-term look. This is a watch item, not a claimed return date or guaranteed bargain.`,
    sections: [
      section("Why this action", [
        clean(value.reason),
        `League status: ${clean(value.leagueStatus) || "unconfirmed"}; recommended action: ${action}.`,
        finite(value.healthyRosAverage) ? `If healthy, the governed rest-of-season average is ${points(value.healthyRosAverage)} per week.` : "A dependable healthy rest-of-season average is not available.",
      ]),
      section(keeperEvaluationActive ? "Keeper salary and long-term value" : "Long-term stash and salary value", [
        `Keeper upside: ${clean(value.keeperUpside) || "speculative"}.`,
        finite(value.preInjuryVbd) ? `Pre-injury value above replacement: ${decimal(value.preInjuryVbd)}.` : "",
        finite(value.currentSalary) ? `Current recorded CBS salary: $${Number(value.currentSalary).toFixed(0)}.` : "No current roster salary is attached to this player.",
        acquisition.known === false ? `For a free agent, the winning FAB bid becomes the salary. $${Number(acquisition.minimumPossible || 1).toFixed(0)} is only the minimum possible bid, not an expected winning price.` : clean(acquisition.basis),
        "Salary is used here because Stash Watch explicitly evaluates next-season keeper and salary-cap trade value; it remains excluded from ordinary waivers and current-season trades.",
      ]),
      section("Return uncertainty", [
        clean(value.returnOutlook),
        `Current designation: ${clean(value.status) || "reserve status"}${clean(value.bodyPart) ? ` (${value.bodyPart})` : ""}.`,
        "The advisor does not invent a return date or add points because a return is possible.",
      ]),
    ],
  };
}

function genericExplanation(value) {
  const simpleFacts = Object.entries(value || {})
    .filter(([, item]) => ["string", "number", "boolean"].includes(typeof item) && clean(String(item)))
    .slice(0, 8)
    .map(([key, item]) => `${key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())}: ${item}.`);
  return {
    summary: clean(value?.reason) || "This item is shown because it passed the advisor's current roster, projection, and evidence checks.",
    sections: [section("What the advisor used", simpleFacts.length ? simpleFacts : ["No additional plain-language facts are registered for this item."])],
  };
}

export function buildEvidenceExplanation(kind, value, { week = null } = {}) {
  if (kind === "scoring-preview-starter" || kind === "scoring-preview-bench") return scoringPreviewPlayerExplanation(value || {}, kind, week);
  if (kind === "starter" || kind === "bench" || kind === "free-agent") return playerExplanation(value || {}, kind, week);
  if (kind === "swap") return swapExplanation(value || {}, week);
  if (kind === "waiver") return waiverExplanation(value || {}, week);
  if (kind === "trade") return tradeExplanation(value || {});
  if (kind === "move") return moveExplanation(value || {});
  if (kind === "injury") return injuryExplanation(value || {});
  if (kind === "ir") return irExplanation(value || {}, week);
  return genericExplanation(value || {});
}
