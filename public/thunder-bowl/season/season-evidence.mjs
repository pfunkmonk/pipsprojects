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
  if (!finite(value)) return "Confidence is not available because the current sources do not provide enough comparable evidence.";
  const percent = Math.round(Number(value) * 100);
  const label = percent >= 75 ? "High" : percent >= 55 ? "Moderate" : "Cautious";
  return `${label} confidence (${percent}%).`;
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
    ? ` The reasonable range is ${decimal(row.floor)}–${decimal(row.ceiling)} points.`
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
  return sources.map((source) => {
    const weight = finite(source.weight) ? ` It supplies ${Math.round(Number(source.weight) * 100)}% of the registered blend.` : "";
    const input = clean(source.input) === "provider component stats scored by Thunder Bowl rules"
      ? " Its projected yards, receptions, touchdowns, turnovers, kicking, or defense statistics were converted with Thunder Bowl scoring—not the provider's fantasy-points total."
      : clean(source.input) ? ` Input method: ${source.input}.` : "";
    return `${clean(source.source) || "A registered source"} projects ${points(source.points)}.${weight}${input}`;
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
  const weekLabel = finite(week) ? `Week ${week}` : "the current week";
  const critical = /injured reserve|\bir\b|pup|physically unable|\bout\b/i.test(clean(value.injury?.status));
  const summary = kind === "starter"
    ? `${name} is recommended in a required ${position} slot because this is one of your highest eligible ${weekLabel} projections at that position.`
    : critical
      ? `${name} is on the bench because the registered ${value.injury.status} designation prevents the advisor from treating this player as a safe starter.`
      : finite(value.points)
        ? `${name} is on the bench because another eligible ${position} on your roster has the stronger current-week projection.`
        : `${name} is on the bench because a safe current-week projection is missing; the advisor does not turn missing data into zero.`;
  return {
    summary,
    sections: [
      section("Expected output", [projectionOverview(value), confidence(value.confidence), matchup({ ...value, week })]),
      section("Why the lineup chose this", [
        kind === "starter"
          ? `The optimizer filled the exact legal lineup—1 QB, 2 RB, 2 WR, 1 TE, 1 K, and 1 DST—with the strongest eligible projections on your roster.`
          : `The optimizer compares players only against the required starters at the same position; bench points do not count toward the lineup total.`,
        "Players with a critical status or no usable projection are excluded from starting consideration.",
      ]),
      section("Projection sources", projectionSourceItems(value.sources)),
      section("Health check", injuryItems(value.injury)),
    ],
  };
}

function swapExplanation(value, week) {
  const edge = signedPoints(value.delta);
  const weekLabel = finite(week) ? `Week ${week}` : "current-week";
  return {
    summary: `${value.start} is preferred over ${value.sit} at ${value.position} because ${value.start}'s ${weekLabel} projection is ${edge.replace(/^\+/, "")} higher than ${value.sit}'s.`,
    sections: [
      section("Why make this start/sit choice", [
        clean(value.reason) || `${value.start} has the stronger registered projection.`,
        `The estimated lineup edge is ${edge}.`,
        confidence(value.confidence),
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
  const drop = value.drop || {};
  const gains = value.gains || {};
  const evidence = value.evidence || {};
  const role = evidence.role;
  const news = Array.isArray(evidence.news) ? evidence.news : [];
  const availability = value.availability || {};
  const weekLabel = finite(week) ? `Week ${week}` : "Current week";
  return {
    summary: `The advisor ranks ${add.name} as a ${value.verdict || "waiver"} option because adding ${add.name} for ${drop.name} keeps the roster legal and produces the best tested lineup improvement among the available choices.`,
    sections: [
      section("Projected effect", [
        `${weekLabel}: ${signedPoints(gains.week)}.`,
        `Average over the next three weeks: ${signedPoints(gains.nextThree)}.`,
        `Average over the rest of the season: ${signedPoints(gains.restOfSeason)}.`,
        finite(gains.resilienceWeeks) && Number(gains.resilienceWeeks) > 0 ? `The move also creates a complete legal lineup in ${gains.resilienceWeeks} additional tested week${Number(gains.resilienceWeeks) === 1 ? "" : "s"}.` : "The move does not rely on inventing extra roster flexibility.",
      ]),
      section("Why this player and this drop", [
        clean(value.reason),
        finite(value.dropCost) ? `Removing ${drop.name} by itself costs about ${points(value.dropCost)} per rest-of-season optimal lineup, making this the lowest-cost legal drop found.` : `${drop.name} was the lowest-cost legal drop across the tested time horizons.`,
        evidence.range && finite(evidence.range.median) ? `${add.name}'s ${weekLabel} projection is ${points(evidence.range.median)}, with a ${decimal(evidence.range.floor)}–${decimal(evidence.range.ceiling)} range.` : "",
        confidence(value.confidence),
      ]),
      section("Availability and roster rules", [
        `${add.name} was confirmed available by the authenticated CBS all-team roster snapshot${availability.asOf ? ` captured ${dateTime(availability.asOf)}` : ""}.`,
        "The advisor tested the move against the league's eight required starters and 14-player maximum.",
        clean(value.acquisitionAdvice),
      ]),
      section("Role and news", [
        role ? `Depth-chart role: ${role.starter ? "starter" : `depth order ${role.order ?? "unknown"}`}${clean(role.status) ? `; status ${role.status}` : ""}.` : "No additional depth-chart signal is registered.",
        ...news.map((item) => `${clean(item.source) || "News"}: ${clean(item.summary) || clean(item.title) || "No summary available"}`),
        ...projectionSourceItems(evidence.projections),
      ]),
    ],
    note: "Waiver cost, salary, and contract treatment remain a league-rule confirmation item; the advisor is recommending the roster move, not an automatic bid amount.",
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
  const salary = value.salary || {};
  const salaryEffect = finite(salary.dogsDelta)
    ? `Dogs of War's recorded roster salary would ${Number(salary.dogsDelta) > 0 ? "increase" : Number(salary.dogsDelta) < 0 ? "decrease" : "stay unchanged"}${Number(salary.dogsDelta) === 0 ? "." : ` by $${Math.abs(Number(salary.dogsDelta)).toFixed(0)}.`}`
    : "The salary effect cannot be confirmed from current data.";
  return {
    summary: `The advisor says to ${String(value.verdict || "explore").toLowerCase()} sending ${send} for ${receive} because Dogs of War improves its modeled rest-of-season lineup while ${rival} receives a package close enough to be rational for both sides.`,
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
        deltaItem(`${rival}'s rest of season`, theirs.restOfSeason),
        deltaItem(`${rival}'s next three weeks`, theirs.nextThree),
      ]),
      section("Roster, salary, and keeper checks", [
        "The comparison keeps both teams on a legal starter path and evaluates exact weekly starting lineups; bench totals are excluded.",
        salaryEffect,
        value.keeperEffect ? `${value.keeperEffect.sends}; ${value.keeperEffect.receives}. ${clean(value.keeperEffect.note)}` : "Keeper treatment is not fully configured.",
        "Only one-for-one trades are tested. Multi-player formats remain blocked until their roster and contract rules are configured.",
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

function irExplanation(value) {
  const action = clean(value.action) || "MONITOR";
  return {
    summary: `${value.name} is a ${action.toLowerCase()} because reserve-list evidence is confirmed and the player's healthy rest-of-season projection and ${String(value.keeperUpside || "speculative").toLowerCase()} keeper upside justify continued attention.`,
    sections: [
      section("Why this action", [
        clean(value.reason),
        `League status: ${clean(value.leagueStatus) || "unconfirmed"}; recommended action: ${action}.`,
        finite(value.healthyRosAverage) ? `If healthy, the governed rest-of-season average is ${points(value.healthyRosAverage)} per week.` : "A dependable healthy rest-of-season average is not available.",
      ]),
      section("Keeper and roster value", [
        `Keeper upside: ${clean(value.keeperUpside) || "speculative"}.`,
        finite(value.preInjuryMarketValue) ? `Pre-injury market value: $${Number(value.preInjuryMarketValue).toFixed(0)}.` : "",
        finite(value.preInjuryVbd) ? `Pre-injury value above replacement: ${decimal(value.preInjuryVbd)}.` : "",
        finite(value.keeperCost) ? `Current recorded keeper salary: $${Number(value.keeperCost).toFixed(0)}.` : "No keeper salary is attached to an available player.",
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
  if (kind === "starter" || kind === "bench") return playerExplanation(value || {}, kind, week);
  if (kind === "swap") return swapExplanation(value || {}, week);
  if (kind === "waiver") return waiverExplanation(value || {}, week);
  if (kind === "trade") return tradeExplanation(value || {});
  if (kind === "move") return moveExplanation(value || {});
  if (kind === "injury") return injuryExplanation(value || {});
  if (kind === "ir") return irExplanation(value || {});
  return genericExplanation(value || {});
}
