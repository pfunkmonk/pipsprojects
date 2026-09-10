const SUPPORTED_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DST"]);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function wholeNumber(value, minimum = 0, maximum = 1_000_000) {
  const text = clean(value).replace(/[$,]/g, "");
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null;
}

function limit(value) {
  return /no limit|unlimited/i.test(clean(value)) ? null : wholeNumber(value, 0, 100);
}

function safeTeamId(team, index) {
  const cbsId = wholeNumber(team?.cbsTeamId, 1, 1_000_000);
  if (cbsId !== null) return `cbs-${cbsId}`;
  const slug = clean(team?.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56);
  return slug.length >= 2 ? `cbs-${slug}` : `cbs-team-${index + 1}`;
}

function uniqueTeamRecords(pages) {
  const byIdentity = new Map();
  for (const page of pages) {
    for (const team of page?.teams || []) {
      const name = clean(team?.name);
      const cbsTeamId = wholeNumber(team?.cbsTeamId, 1, 1_000_000);
      if (name.length < 1 || name.length > 60) continue;
      const identity = cbsTeamId === null ? name.toLowerCase() : String(cbsTeamId);
      if (!byIdentity.has(identity)) byIdentity.set(identity, { cbsTeamId, name });
    }
  }
  return [...byIdentity.values()]
    .sort((left, right) => (left.cbsTeamId ?? 1_000_001) - (right.cbsTeamId ?? 1_000_001) || left.name.localeCompare(right.name))
    .slice(0, 20);
}

function importedTeamOrder(pages, teamRecords) {
  const draftOrder = pages.find((page) => page?.kind === "order")?.draftOrder;
  const source = clean(draftOrder?.source).toLowerCase();
  const orderNames = Array.isArray(draftOrder?.teamNames) ? draftOrder.teamNames.map(clean).filter(Boolean) : [];
  const byName = new Map(teamRecords.map((team) => [team.name.toLowerCase(), team]));
  const ordered = orderNames.map((name) => byName.get(name.toLowerCase())).filter(Boolean);
  const exactManualOrder = source === "manual"
    && ordered.length === teamRecords.length
    && new Set(ordered).size === teamRecords.length;
  if (exactManualOrder) {
    return {
      records: ordered,
      status: "confirmed",
      note: "CBS's complete manually configured draft order was imported. Review the positions below before creating the league.",
    };
  }
  const note = source === "random"
    ? "CBS is set to generate a random draft order, so CBS does not currently provide a fixed opening order. Set the opening nomination order below."
    : source === "manual"
      ? "CBS's manual draft order was incomplete or did not match the imported teams. Set the opening nomination order below."
      : "CBS did not provide a fixed draft order. Set the opening nomination order below.";
  return { records: teamRecords, status: "review", note };
}

function importedRoster(pages) {
  const page = pages.find((candidate) => candidate?.kind === "roster");
  const limits = page?.rosterLimits || {};
  const starterMinimum = wholeNumber(limits.startingMinimum, 0, 100);
  const starterMaximum = limit(limits.startingMaximum);
  const reserveMinimum = wholeNumber(limits.reserveMinimum, 0, 100) ?? 0;
  const reserveMaximum = limit(limits.reserveMaximum);
  const totalMinimum = wholeNumber(limits.totalMinimum, 1, 100);
  const totalMaximum = limit(limits.totalMaximum);
  const rosterMinimum = starterMinimum === null ? totalMinimum : starterMinimum + reserveMinimum;
  let rosterMaximum = starterMaximum !== null && reserveMaximum !== null
    ? starterMaximum + reserveMaximum
    : totalMaximum;
  if (rosterMinimum !== null && rosterMaximum !== null) rosterMaximum = Math.max(rosterMinimum, rosterMaximum);

  const positionRules = [];
  const unsupported = [];
  for (const position of page?.rosterPositions || []) {
    if (!position?.included) continue;
    const id = clean(position.id).toUpperCase();
    if (!SUPPORTED_POSITIONS.has(id)) {
      unsupported.push(clean(position.label || id));
      continue;
    }
    const minimum = wholeNumber(position.minimumStarters, 0, 100);
    if (minimum === null) continue;
    const importedMaximum = limit(position.maximumOnRoster);
    positionRules.push({
      id,
      label: id,
      minimum,
      maximum: importedMaximum === null || rosterMaximum === null ? importedMaximum : Math.min(importedMaximum, rosterMaximum),
    });
  }
  return {
    rosterMinimum,
    rosterMaximum,
    positionRules: positionRules.length ? positionRules : null,
    unsupported,
  };
}

function importedKeeperMaximum(pages) {
  const policy = pages.find((page) => page?.kind === "policies")?.keeperPolicy;
  if (!policy) return null;
  if (policy.enabled === false) return 0;
  return wholeNumber(policy.maximum, 0, 100);
}

function importedDraftSettings(pages) {
  const draft = {};
  for (const page of pages) {
    for (const [key, value] of Object.entries(page?.draftSettings || {})) {
      if (clean(value)) draft[key] = value;
    }
  }
  const policies = pages.find((page) => page?.kind === "policies")?.salaryPolicy || {};
  const salaryPool = wholeNumber(draft.salaryCap, 1) ?? wholeNumber(policies.teamMaximumTotal, 1);
  const minimumBid = wholeNumber(draft.minimumBid, 1, 1_000);
  const bidIncrement = wholeNumber(draft.bidIncrement, 1, 1_000);
  const order = clean(draft.order).toLowerCase();
  let nominationMode = null;
  if (order.includes("reverse") && order.includes("snake")) nominationMode = "reverse-snake";
  else if (order.includes("snake")) nominationMode = "snake";
  else if (order.includes("linear") || order.includes("repeat")) nominationMode = "linear";
  return { salaryPool, minimumBid, bidIncrement, nominationMode };
}

function cbsOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".football.cbssports.com")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function normalizeCbsDraftDaySetupPages(pages, capturedAt = new Date().toISOString()) {
  if (!Array.isArray(pages) || !pages.length || !Number.isFinite(Date.parse(capturedAt))) throw new Error("CBS league setup capture is malformed.");
  const origin = cbsOrigin(pages[0]?.url);
  if (!origin || pages.some((page) => cbsOrigin(page?.url) !== origin)) throw new Error("CBS league setup pages did not come from one CBS football league.");
  const teamRecords = uniqueTeamRecords(pages);
  const teamOrder = importedTeamOrder(pages, teamRecords);
  const teams = teamOrder.records.map((team, index) => ({ id: safeTeamId(team, index), name: team.name }));
  if (teams.length < 2 || teams.length > 20) throw new Error(`CBS setup found ${teams.length} teams; Draft Day requires 2 through 20.`);
  const leagueName = clean(pages.map((page) => page?.leagueName).find(Boolean));
  if (!leagueName || leagueName.length > 80) throw new Error("CBS did not expose a usable league name.");
  const season = wholeNumber(pages.map((page) => page?.season).find(Boolean), 2020, 2100) ?? new Date(capturedAt).getUTCFullYear();
  const roster = importedRoster(pages);
  const draft = importedDraftSettings(pages);
  const keeperMaximum = importedKeeperMaximum(pages);
  const confirmed = ["league name", `${teams.length} team names`];
  const review = [];
  if (roster.rosterMinimum !== null && roster.rosterMaximum !== null && roster.positionRules) confirmed.push("roster and position limits");
  else review.push("roster and position limits");
  if (keeperMaximum !== null) confirmed.push("keeper limit");
  else review.push("keeper limit");
  if (draft.salaryPool !== null) confirmed.push("league salary cap");
  else review.push("starting salary pool");
  review.push("individual team salary pools");
  if (draft.minimumBid !== null && draft.bidIncrement !== null) confirmed.push("minimum bid and bid increment");
  else review.push("minimum bid and bid increment");
  if (draft.nominationMode !== null) confirmed.push("nomination pattern");
  else review.push("nomination pattern");
  if (teamOrder.status === "confirmed") confirmed.push("CBS draft order");
  else review.push("opening nomination order");
  if (roster.unsupported.length) review.push(`CBS flex or custom positions (${roster.unsupported.join(", ")})`);

  return {
    schemaVersion: 1,
    source: "CBS Sports authenticated league setup",
    capturedAt,
    leagueOrigin: origin,
    leagueName,
    season,
    teams,
    rosterMinimum: roster.rosterMinimum,
    rosterMaximum: roster.rosterMaximum,
    positionRules: roster.positionRules,
    keeperMaximum,
    defaultPool: draft.salaryPool,
    minimumBid: draft.minimumBid,
    bidIncrement: draft.bidIncrement,
    nominationMode: draft.nominationMode,
    teamOrderStatus: teamOrder.status,
    teamOrderNote: teamOrder.note,
    confirmed,
    review,
  };
}
