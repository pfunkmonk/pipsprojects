import { STARTER_REQUIREMENTS } from "../../../public/thunder-bowl/state-engine.mjs";
import { PREMIUM_PROJECTION_SOURCES, projectionSourceWeights } from "../../../public/thunder-bowl/projection-lab.mjs";
import { ageMinutes } from "./season-time.mjs";

const USER_TEAM_ID = "dogs-of-war";
const POSITIONS = Object.keys(STARTER_REQUIREMENTS);
const PRIORITY_WEEKS = Object.freeze({ division: [1, 2, 12, 13], playoffs: [15, 16, 17] });
export const KEEPER_EVALUATION_START_WEEK = 13;

function round(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function compareNumberTuples(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function rosterTeam(leagueState, teamId) {
  return leagueState?.teams?.find((team) => team.teamId === teamId) || null;
}

function leagueRostersReady(leagueState) {
  if (typeof leagueState?.rostersReady === "boolean") return leagueState.rostersReady;
  if (typeof leagueState?.rostersComplete === "boolean") return leagueState.rostersComplete;
  return Array.isArray(leagueState?.availablePlayerIds);
}

function incompleteRosterMessage(leagueState, decision) {
  const legal = Number.isSafeInteger(leagueState?.legalTeamCount) ? leagueState.legalTeamCount : Number.isSafeInteger(leagueState?.completeTeamCount) ? leagueState.completeTeamCount : 0;
  const teams = Number.isSafeInteger(leagueState?.teamCount) ? leagueState.teamCount : leagueState?.teams?.length || 12;
  return `CBS updated successfully, but only ${legal} of ${teams} teams have a legal 8–14 player roster with 1 QB, 2 RB, 2 WR, 1 TE, 1 K, and 1 DST. ${decision} stays blocked until every team satisfies the league rule.`;
}

function projectionRowMaps({ fbgSnapshot = null, fantasyProsSnapshot = null, pffSnapshot = null } = {}) {
  const snapshots = [
    ["Footballguys", fbgSnapshot],
    ["FantasyPros", fantasyProsSnapshot],
    ["PFF", pffSnapshot],
  ];
  return new Map(snapshots.map(([source, snapshot]) => [source, new Map((snapshot?.items || []).map((row) => [`${row.playerId}|${row.week}`, {
    ...row,
    snapshotSource: snapshot.source,
    snapshotAuthority: snapshot.authority,
  }]))]));
}

function cbsRowMap(leagueState) {
  return new Map((leagueState?.weeklyProjections || []).map((row) => [`${row.playerId}|${row.week}`, row]));
}

function statusMap(snapshot) {
  return new Map((snapshot?.updates || []).map((row) => [row.playerId, row]));
}

function playerWeekEvidence(player, week, projectionRows = new Map(), cbsRows = new Map()) {
  const baseline = player.weeklyProjection?.points?.[week - 1];
  const baselinePoints = baseline == null || !Number.isFinite(Number(baseline)) ? null : Number(baseline);
  const manualFbg = projectionRows.get("Footballguys")?.get(`${player.id}|${week}`);
  const currentCbs = cbsRows.get(`${player.id}|${week}`);
  const sourceRows = [];
  const shapeDenominator = Number(player.projectedPoints);
  const share = shapeDenominator > 0 && baselinePoints !== null ? baselinePoints / shapeDenominator : null;
  for (const sourceName of PREMIUM_PROJECTION_SOURCES) {
    const seasonSource = player.projectionSources?.find((row) => row.source === sourceName);
    const scaled = share !== null && Number.isFinite(Number(seasonSource?.points)) ? Number(seasonSource.points) * share : null;
    const rawRow = sourceName === "CBS" ? currentCbs : projectionRows.get(sourceName)?.get(`${player.id}|${week}`);
    const points = rawRow ? rawRow.points : ["FantasyPros", "PFF"].includes(sourceName) ? null : scaled;
    if (!Number.isFinite(points)) continue;
    sourceRows.push({
      source: sourceName,
      points: round(points),
      asOf: rawRow ? rawRow.providerAsOf : seasonSource.asOf,
      input: rawRow
        ? /authenticated/i.test(rawRow.snapshotAuthority || "")
          ? `signed-in ${sourceName} component stats scored by Thunder Bowl rules`
          : "provider component stats scored by Thunder Bowl rules"
        : "governed weekly shape",
      ...(rawRow?.projectedStats ? { projectedStats: rawRow.projectedStats } : {}),
      ...(Number.isFinite(rawRow?.providerPoints) ? { providerPoints: rawRow.providerPoints } : {}),
      ...(rawRow?.scoringCaveats?.length ? { scoringCaveats: rawRow.scoringCaveats } : {}),
    });
  }
  if (!sourceRows.length) {
    if (baselinePoints === null) return { points: null, sources: [], confidence: null, floor: null, ceiling: null, spread: null };
    return { points: round(baselinePoints), sources: [], confidence: 0.4, floor: round(Math.max(0, baselinePoints - 3)), ceiling: round(baselinePoints + 3), spread: null };
  }
  const weights = projectionSourceWeights(sourceRows.map((row) => row.source));
  const points = sourceRows.reduce((sum, row) => sum + row.points * weights[row.source], 0);
  const low = Math.min(...sourceRows.map((row) => row.points));
  const high = Math.max(...sourceRows.map((row) => row.points));
  const spread = high - low;
  const agreement = Math.max(0.35, Math.min(0.9, 0.9 - spread / Math.max(12, points * 3)));
  return {
    points: round(points),
    floor: round(manualFbg?.floor ?? Math.max(0, points - Math.max(2, spread / 2))),
    ceiling: round(manualFbg?.ceiling ?? points + Math.max(2, spread / 2)),
    spread: round(spread),
    confidence: round(agreement, 2),
    sources: sourceRows.map((row) => ({ ...row, weight: round(weights[row.source], 4) })),
  };
}

function criticalStatus(status) {
  if (!status) return false;
  const evidence = [status.status, status.injuryStatus, status.practiceParticipation].join(" ").toLowerCase();
  return status.severity === "critical" || ["injured reserve", "physically unable", "pup", "out", "suspend"].some((term) => evidence.includes(term));
}

function rosterPlayers(roster, playerById) {
  return roster.map((entry) => {
    const player = playerById.get(entry.playerId);
    if (!player) throw new Error(`Roster player ${entry.playerId} is outside the active pack.`);
    return { ...entry, player };
  });
}

function legalStarterPath(roster) {
  const counts = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  for (const entry of roster) counts[entry.player.position] += 1;
  return POSITIONS.every((position) => counts[position] >= STARTER_REQUIREMENTS[position]);
}

export function optimizeExactLineup(roster, { week, playerById, projectionRows = null, fbgRows = new Map(), cbsRows = new Map(), statuses = new Map() }) {
  const activeProjectionRows = projectionRows || new Map([["Footballguys", fbgRows]]);
  const candidates = rosterPlayers(roster, playerById).map((entry) => ({
    ...entry,
    projection: playerWeekEvidence(entry.player, week, activeProjectionRows, cbsRows),
    status: statuses.get(entry.playerId) || null,
  }));
  const starters = [];
  const missingSlots = [];
  const bench = [];
  for (const position of POSITIONS) {
    const eligible = candidates
      .filter((entry) => entry.player.position === position && entry.projection.points !== null && !criticalStatus(entry.status))
      .sort((left, right) => right.projection.points - left.projection.points || left.player.name.localeCompare(right.player.name));
    const needed = STARTER_REQUIREMENTS[position];
    starters.push(...eligible.slice(0, needed));
    bench.push(...eligible.slice(needed));
    for (let index = eligible.length; index < needed; index += 1) missingSlots.push(position);
    bench.push(...candidates.filter((entry) => entry.player.position === position && (entry.projection.points === null || criticalStatus(entry.status))));
  }
  starters.sort((left, right) => POSITIONS.indexOf(left.player.position) - POSITIONS.indexOf(right.player.position) || right.projection.points - left.projection.points);
  const total = missingSlots.length ? null : round(starters.reduce((sum, entry) => sum + entry.projection.points, 0));
  return { starters, bench, missingSlots, total };
}

function lineupPublicRow(entry) {
  return {
    playerId: entry.playerId,
    name: entry.player.name,
    position: entry.player.position,
    nflTeam: entry.player.nflTeam,
    opponent: entry.opponent,
    gameTime: entry.gameTime,
    bye: entry.bye ?? entry.player.weeklyProjection?.byeWeek ?? null,
    points: entry.projection.points,
    floor: entry.projection.floor,
    ceiling: entry.projection.ceiling,
    confidence: entry.projection.confidence,
    sourceSpread: entry.projection.spread,
    sources: entry.projection.sources,
    injury: entry.status ? {
      severity: entry.status.severity,
      status: entry.status.injuryStatus || entry.status.status || "",
      bodyPart: entry.status.injuryBodyPart || "",
      practice: entry.status.practiceParticipation || "",
      updatedAt: entry.status.newsUpdated,
    } : null,
  };
}

function weekRange(start, end = 17) {
  const weeks = [];
  for (let week = Math.max(1, start); week <= Math.min(17, end); week += 1) weeks.push(week);
  return weeks;
}

function lineupSeries(roster, weeks, context) {
  return weeks.map((week) => optimizeExactLineup(roster, { ...context, week }));
}

function seriesAverage(roster, weeks, context) {
  const lineups = lineupSeries(roster, weeks, context);
  return {
    average: average(lineups.map((lineup) => lineup.total)),
    completeWeeks: lineups.filter((lineup) => lineup.total !== null).length,
    weeks: lineups.length,
  };
}

function marginal(beforeRoster, afterRoster, weeks, context) {
  const before = seriesAverage(beforeRoster, weeks, context);
  const after = seriesAverage(afterRoster, weeks, context);
  return {
    delta: before.average === null || after.average === null ? null : round(after.average - before.average),
    resilienceWeeks: after.completeWeeks - before.completeWeeks,
  };
}

function researchSignals(player, research) {
  const name = player.name.toLowerCase();
  const depth = research?.depthChart?.entries?.find((entry) => entry.playerName.toLowerCase() === name && entry.position === player.position) || null;
  const fbgNews = research?.fbgNews?.items?.find((item) => item.playerNames?.some((value) => value.toLowerCase() === name)) || null;
  const cbsNews = research?.cbsNews?.items?.find((item) => item.playerName?.toLowerCase() === name) || null;
  return {
    depth: depth ? { order: depth.depthOrder, starter: depth.starter, status: depth.status, sourceUrl: depth.url } : null,
    news: [
      ...(fbgNews ? [{ source: "Footballguys", title: fbgNews.title, summary: fbgNews.footballguysView || fbgNews.description, asOf: fbgNews.lastSeenAt, url: fbgNews.url }] : []),
      ...(cbsNews ? [{ source: "CBS", title: cbsNews.title, summary: cbsNews.description, asOf: cbsNews.lastSeenAt, url: cbsNews.url }] : []),
    ].slice(0, 3),
  };
}

function recordRate(record) {
  const games = Number(record?.wins || 0) + Number(record?.losses || 0) + Number(record?.ties || 0);
  return games ? (Number(record.wins || 0) + Number(record.ties || 0) * 0.5) / games : 0.5;
}

export function compareFabTiePriority(left, right) {
  const rate = recordRate(left?.record) - recordRate(right?.record);
  if (rate) return rate;
  const pickups = Number(left?.weeklySuccessfulPickups || 0) - Number(right?.weeklySuccessfulPickups || 0);
  if (pickups) return pickups;
  return Number(left?.fabOrder || 99) - Number(right?.fabOrder || 99);
}

export function simulateFabTieClaims({ teams = [], claims = [] } = {}) {
  const state = new Map(teams.map((team) => [team.teamId, { ...team, weeklySuccessfulPickups: Number(team.weeklySuccessfulPickups || 0) }]));
  const results = [];
  for (const claim of claims) {
    const contenders = (claim.offers || [])
      .map((offer) => ({ ...offer, team: state.get(offer.teamId) }))
      .filter((offer) => offer.team && Number.isSafeInteger(offer.bid) && offer.bid >= 1 && offer.bid <= Number(offer.team.remainingBudget ?? 50))
      .sort((left, right) => right.bid - left.bid || compareFabTiePriority(left.team, right.team));
    const winner = contenders[0] || null;
    if (!winner) {
      results.push({ playerId: claim.playerId, winnerTeamId: null, bid: null });
      continue;
    }
    const team = state.get(winner.teamId);
    team.remainingBudget = Number(team.remainingBudget ?? 50) - winner.bid;
    team.weeklySuccessfulPickups += 1;
    results.push({ playerId: claim.playerId, winnerTeamId: winner.teamId, bid: winner.bid });
  }
  return { results, teams: [...state.values()] };
}

function fabPickupCounts(leagueMoves = []) {
  const counts = new Map();
  for (const move of leagueMoves) {
    if (move?.type !== "PICKUP" || !move.to?.teamId) continue;
    counts.set(move.to.teamId, (counts.get(move.to.teamId) || 0) + 1);
  }
  return counts;
}

function isCbsFabNotStarted(raw, week) {
  const teams = raw?.teams || [];
  const coverage = raw?.coverage || {};
  return week === 1
    && raw?.status === "PARTIAL"
    && teams.length === 12
    && coverage.budgetTeams === 0
    && coverage.orderTeams === 0
    && coverage.recordTeams === 12
    && Number(coverage.pickupRows || 0) === 0
    && teams.every((team) => team.remainingBudget === null
      && team.fabOrder === null
      && team.record?.wins === 0
      && team.record?.losses === 0
      && team.record?.ties === 0
      && (team.weeklySuccessfulPickups === null || team.weeklySuccessfulPickups === 0));
}

function incompleteFabMessage(raw) {
  const coverage = raw?.coverage || {};
  const missing = [];
  if (coverage.budgetTeams !== 12) missing.push("all 12 FAB balances");
  if (coverage.recordTeams !== 12) missing.push("all 12 standings records");
  if (coverage.orderTeams !== 12) missing.push("the current CBS FAB order");
  return `CBS has not exposed ${missing.join(", ") || "complete waiver data"} yet. Keep the current Data Helper and choose Update CBS after CBS activates or updates those reports.`;
}

function effectiveFabState(leagueState, leagueMoves, roster, week) {
  const raw = leagueState?.fabState;
  const diffCounts = fabPickupCounts(leagueMoves);
  const notStarted = isCbsFabNotStarted(raw, week);
  const teams = (raw?.teams || []).map((team) => ({
    ...team,
    remainingBudget: notStarted ? 50 : team.remainingBudget,
    weeklySuccessfulPickups: team.weeklySuccessfulPickups === null
      ? diffCounts.get(team.teamId) || 0
      : Math.max(team.weeklySuccessfulPickups, diffCounts.get(team.teamId) || 0),
  }));
  const dogs = teams.find((team) => team.teamId === USER_TEAM_ID) || null;
  const pricingReady = teams.length === 12 && teams.every((team) => team.remainingBudget !== null && team.record !== null);
  const orderAvailable = teams.length === 12 && teams.every((team) => team.fabOrder !== null);
  const specialTeamsByes = ["K", "DST"].flatMap((position) => {
    const atPosition = roster.filter((entry) => entry.player.position === position);
    if (atPosition.length !== 1) return [];
    const bye = atPosition[0].bye ?? atPosition[0].player.weeklyProjection?.byeWeek;
    return Number.isSafeInteger(bye) && bye >= week ? [{ position, week: bye }] : [];
  });
  const budget = pricingReady ? dogs.remainingBudget : null;
  const injuryReserve = Math.min(5, Math.max(2, Math.ceil((18 - week) / 4)));
  const plannedReserve = budget === null ? null : Math.min(Math.max(0, budget - 1), injuryReserve + specialTeamsByes.length);
  const teamsAheadOnTie = pricingReady && orderAvailable ? teams.filter((team) => team.teamId !== USER_TEAM_ID && compareFabTiePriority(team, dogs) < 0).length : null;
  return {
    available: pricingReady,
    reason: pricingReady ? null : incompleteFabMessage(raw),
    notStarted,
    orderAvailable,
    budget,
    plannedReserve,
    spendable: budget === null ? null : Math.max(0, budget - plannedReserve),
    injuryReserve,
    specialTeamsByes,
    weeklySuccessfulPickups: dogs?.weeklySuccessfulPickups ?? null,
    fabOrder: dogs?.fabOrder ?? null,
    record: dogs?.record ?? null,
    tiePosition: teamsAheadOnTie === null ? null : teamsAheadOnTie + 1,
    teamsAheadOnTie,
    pickupEvidence: raw?.coverage?.pickupEvidence || (leagueMoves.length ? "ROSTER_SNAPSHOT_DIFFS" : "NO_RESULTS_YET"),
    bidHistoryAvailable: false,
    processingSchedule: raw?.rules?.typicalProcessingWindow
      ? `${raw.rules.processingNights.map((night) => night[0] + night.slice(1).toLowerCase()).join(", ")} nights; ${raw.rules.typicalProcessingWindow}`
      : "Tuesday through Saturday nights; typically 1–4 a.m. ET the following morning",
    rules: raw?.rules || null,
    teams,
  };
}

function fabSequenceTie(fab, earlierWins) {
  if (!fab.available || !fab.orderAvailable) return { tiePosition: null, teamsAheadOnTie: null, weeklySuccessfulPickups: fab.weeklySuccessfulPickups };
  const teams = fab.teams.map((team) => team.teamId === USER_TEAM_ID
    ? { ...team, weeklySuccessfulPickups: team.weeklySuccessfulPickups + earlierWins }
    : team);
  const dogs = teams.find((team) => team.teamId === USER_TEAM_ID);
  const teamsAheadOnTie = teams.filter((team) => team.teamId !== USER_TEAM_ID && compareFabTiePriority(team, dogs) < 0).length;
  return { tiePosition: teamsAheadOnTie + 1, teamsAheadOnTie, weeklySuccessfulPickups: dogs.weeklySuccessfulPickups };
}

function fabBidFor(row, verdict, fab) {
  if (!fab.available || fab.budget < 1) return { recommended: null, maximum: null, budgetAfter: null };
  const gains = [row.currentDelta.delta, row.nextThreeDelta.delta, row.rosDelta.delta].map((value) => Number(value || 0));
  const strength = Math.max(0, gains[0] * 2 + gains[1] * 3 + gains[2] * 2 + (row.currentDelta.resilienceWeeks + row.nextThreeDelta.resilienceWeeks) * 3);
  const base = verdict === "ADD" ? 4 : verdict === "CLAIM" ? 2 : 1;
  const rawBid = base + Math.ceil(strength / 4);
  const positionCap = ["K", "DST"].includes(row.addPlayer.position) ? 2 : verdict === "WATCH" ? 2 : verdict === "CLAIM" ? 8 : 15;
  const recommended = Math.max(1, Math.min(fab.spendable, positionCap, rawBid));
  const maximum = Math.max(recommended, Math.min(fab.spendable, positionCap, recommended + Math.max(1, Math.ceil(recommended / 2))));
  return { recommended, maximum, budgetAfter: fab.budget - recommended };
}

export function recommendWaivers({ pack, leagueState, week, fbgSnapshot = null, fantasyProsSnapshot = null, pffSnapshot = null, statusSnapshot = null, researchSnapshot = null, leagueMoves = [] }) {
  if (!Array.isArray(leagueState.availablePlayerIds) || !leagueState.authority.startsWith("authenticated")) {
    return { recommendations: [], blockedReason: "Sync private CBS league data to confirm the current roster and actual available-player pool." };
  }
  if (!leagueRostersReady(leagueState)) return { recommendations: [], blockedReason: incompleteRosterMessage(leagueState, "Waiver advice") };
  const playerById = new Map(pack.players.map((player) => [player.id, player]));
  const projectionRows = projectionRowMaps({ fbgSnapshot, fantasyProsSnapshot, pffSnapshot });
  const cbsRows = cbsRowMap(leagueState);
  const statuses = statusMap(statusSnapshot);
  const userTeam = rosterTeam(leagueState, USER_TEAM_ID);
  if (!userTeam) return { recommendations: [], blockedReason: "Dogs of War is missing from the CBS snapshot." };
  const currentRoster = rosterPlayers(userTeam.roster, playerById);
  const fab = effectiveFabState(leagueState, leagueMoves, currentRoster, week);
  const context = { playerById, projectionRows, cbsRows, statuses };
  const currentWeek = [week];
  const nextThree = weekRange(week, week + 2);
  const ros = weekRange(week, 17);
  const available = leagueState.availablePlayerIds
    .map((id) => playerById.get(id))
    .filter(Boolean)
    .filter((player) => playerWeekEvidence(player, week, projectionRows, cbsRows).points !== null && !criticalStatus(statuses.get(player.id)))
    .sort((left, right) => {
      const leftPoints = playerWeekEvidence(left, week, projectionRows, cbsRows).points ?? -1;
      const rightPoints = playerWeekEvidence(right, week, projectionRows, cbsRows).points ?? -1;
      return rightPoints - leftPoints || right.vbd - left.vbd;
    })
    .slice(0, 100);
  const candidates = [];
  for (const addPlayer of available) {
    let best = null;
    for (const drop of currentRoster) {
      const afterRoster = currentRoster.filter((entry) => entry.playerId !== drop.playerId).concat({
        playerId: addPlayer.id,
        name: addPlayer.name,
        position: addPlayer.position,
        nflTeam: addPlayer.nflTeam,
        opponent: null,
        gameTime: null,
        bye: addPlayer.weeklyProjection?.byeWeek ?? null,
        newsTitles: [],
        markerClasses: [],
        player: addPlayer,
      });
      if (!legalStarterPath(afterRoster)) continue;
      const currentDelta = marginal(currentRoster, afterRoster, currentWeek, context);
      const nextThreeDelta = marginal(currentRoster, afterRoster, nextThree, context);
      const rosDelta = marginal(currentRoster, afterRoster, ros, context);
      const withoutDrop = currentRoster.filter((entry) => entry.playerId !== drop.playerId);
      const dropProjectionLoss = marginal(currentRoster, withoutDrop, ros, context);
      const row = { addPlayer, drop, afterRoster, currentDelta, nextThreeDelta, rosDelta, dropProjectionLoss };
      const tuple = [currentDelta.resilienceWeeks, currentDelta.delta ?? -999, nextThreeDelta.delta ?? -999, rosDelta.delta ?? -999];
      if (!best || compareNumberTuples(tuple, best.tuple) > 0) best = { ...row, tuple };
    }
    if (!best) continue;
    const gains = [best.currentDelta.delta, best.nextThreeDelta.delta, best.rosDelta.delta].filter((value) => value !== null);
    const positiveHorizons = gains.filter((value) => value > 0).length;
    if (!positiveHorizons && best.currentDelta.resilienceWeeks <= 0) continue;
    candidates.push(best);
  }
  candidates.sort((left, right) => {
    for (let index = 0; index < left.tuple.length; index += 1) if (left.tuple[index] !== right.tuple[index]) return right.tuple[index] - left.tuple[index];
    return right.addPlayer.vbd - left.addPlayer.vbd;
  });
  const recommendations = candidates.slice(0, 5).map((row, index) => {
    const projection = playerWeekEvidence(row.addPlayer, week, projectionRows, cbsRows);
    const signals = researchSignals(row.addPlayer, researchSnapshot);
    const verdict = (row.currentDelta.delta ?? 0) >= 2 && (row.nextThreeDelta.delta ?? 0) > 0
      ? "ADD"
      : (row.nextThreeDelta.delta ?? 0) >= 0.8 || (row.rosDelta.delta ?? 0) >= 0.6
        ? "CLAIM"
        : "WATCH";
    const horizon = row.currentDelta.delta && row.currentDelta.delta > 0 ? `+${row.currentDelta.delta.toFixed(1)} expected Week ${week} points` : `${row.nextThreeDelta.delta >= 0 ? "+" : ""}${row.nextThreeDelta.delta?.toFixed(1) || "0.0"} average over the next three weeks`;
    const bid = fabBidFor(row, verdict, fab);
    const sequenceTie = fabSequenceTie(fab, index);
    return {
      priority: index + 1,
      verdict,
      add: { playerId: row.addPlayer.id, name: row.addPlayer.name, position: row.addPlayer.position, nflTeam: row.addPlayer.nflTeam, opponent: null, gameTime: null },
      drop: { playerId: row.drop.playerId, name: row.drop.player.name, position: row.drop.player.position, nflTeam: row.drop.player.nflTeam },
      gains: { week: row.currentDelta.delta, nextThree: row.nextThreeDelta.delta, restOfSeason: row.rosDelta.delta, resilienceWeeks: row.currentDelta.resilienceWeeks + row.nextThreeDelta.resilienceWeeks },
      dropProjectionLoss: row.dropProjectionLoss.delta === null ? null : round(-row.dropProjectionLoss.delta),
      confidence: projection.confidence,
      availability: { source: "CBS authenticated all-team roster snapshot", asOf: leagueState.capturedAt, evidence: "not rostered by any of the 12 CBS teams" },
      reason: `${horizon}; ${row.drop.player.name} produces the smallest projected-points loss among the legal drops tested.`,
      evidence: { projections: projection.sources, range: { floor: projection.floor, median: projection.points, ceiling: projection.ceiling }, role: signals.depth, news: signals.news, rankingRule: "lexicographic: legal/resilience gain, Week gain, next-three gain, then rest-of-season gain; no unvalidated context modifier" },
      fab: {
        ...bid,
        currentBudget: fab.budget,
        plannedReserve: fab.plannedReserve,
        spendable: fab.spendable,
        tiePosition: sequenceTie.tiePosition,
        teamsAheadOnTie: sequenceTie.teamsAheadOnTie,
        weeklySuccessfulPickups: sequenceTie.weeklySuccessfulPickups,
        earlierClaimWinsAssumed: index,
        fabOrder: fab.fabOrder,
        record: fab.record,
        bidHistoryAvailable: fab.bidHistoryAvailable,
        pickupEvidence: fab.pickupEvidence,
        processingSchedule: fab.processingSchedule,
        specialTeamsByes: fab.specialTeamsByes,
        unavailableReason: fab.reason,
      },
    };
  });
  for (const [index, recommendation] of recommendations.entries()) recommendation.alternatives = recommendations.slice(index + 1).map((row) => ({ priority: row.priority, name: row.add.name, recommendedBid: row.fab.recommended })).slice(0, 3);
  const { teams: _teams, ...publicFab } = fab;
  return { recommendations, blockedReason: null, fab: publicFab };
}

function tradeDelta(beforeRoster, afterRoster, weeks, context) {
  return marginal(beforeRoster, afterRoster, weeks.filter((candidate) => candidate >= context.currentWeek), context).delta;
}

export function recommendTrades({ pack, leagueState, week, fbgSnapshot = null, fantasyProsSnapshot = null, pffSnapshot = null, statusSnapshot = null }) {
  if (!leagueRostersReady(leagueState)) return { recommendations: [], blockedReason: incompleteRosterMessage(leagueState, "Trade advice") };
  const playerById = new Map(pack.players.map((player) => [player.id, player]));
  const projectionRows = projectionRowMaps({ fbgSnapshot, fantasyProsSnapshot, pffSnapshot });
  const cbsRows = cbsRowMap(leagueState);
  const statuses = statusMap(statusSnapshot);
  const context = { playerById, projectionRows, cbsRows, statuses, currentWeek: week };
  const dogsTeam = rosterTeam(leagueState, USER_TEAM_ID);
  if (!dogsTeam) return { recommendations: [], blockedReason: "Dogs of War roster is unavailable." };
  const dogs = rosterPlayers(dogsTeam.roster, playerById);
  const nextThree = weekRange(week, week + 2);
  const ros = weekRange(week, 17);
  const division = PRIORITY_WEEKS.division.filter((candidate) => candidate >= week);
  const playoffs = PRIORITY_WEEKS.playoffs.filter((candidate) => candidate >= week);
  const ideas = [];
  const dogsCandidates = [...dogs].sort((left, right) => right.player.vbd - left.player.vbd);
  for (const rivalTeam of leagueState.teams.filter((team) => team.teamId !== USER_TEAM_ID)) {
    const rival = rosterPlayers(rivalTeam.roster, playerById);
    const rivalCandidates = [...rival].sort((left, right) => right.player.vbd - left.player.vbd);
    for (const send of dogsCandidates) {
      for (const receive of rivalCandidates) {
        const nextDogs = dogs.filter((entry) => entry.playerId !== send.playerId).concat(receive);
        const nextRival = rival.filter((entry) => entry.playerId !== receive.playerId).concat(send);
        if (!legalStarterPath(nextDogs) || !legalStarterPath(nextRival)) continue;
        const dogsDeltas = {
          nextThree: tradeDelta(dogs, nextDogs, nextThree, context),
          restOfSeason: tradeDelta(dogs, nextDogs, ros, context),
          division: division.length ? tradeDelta(dogs, nextDogs, division, context) : null,
          playoffs: playoffs.length ? tradeDelta(dogs, nextDogs, playoffs, context) : null,
        };
        const rivalDeltas = {
          nextThree: tradeDelta(rival, nextRival, nextThree, context),
          restOfSeason: tradeDelta(rival, nextRival, ros, context),
          division: division.length ? tradeDelta(rival, nextRival, division, context) : null,
          playoffs: playoffs.length ? tradeDelta(rival, nextRival, playoffs, context) : null,
        };
        if (dogsDeltas.restOfSeason === null || rivalDeltas.restOfSeason === null || dogsDeltas.restOfSeason <= 0.15 || rivalDeltas.restOfSeason < -0.35) continue;
        const mutualScore = dogsDeltas.restOfSeason + Math.min(0.5, rivalDeltas.restOfSeason);
        ideas.push({ rivalTeam, send, receive, dogsDeltas, rivalDeltas, mutualScore });
      }
    }
  }
  ideas.sort((left, right) => right.mutualScore - left.mutualScore || (right.dogsDeltas.nextThree ?? -999) - (left.dogsDeltas.nextThree ?? -999));
  const usedRivals = new Set();
  const recommendations = [];
  for (const idea of ideas) {
    if (usedRivals.has(idea.rivalTeam.teamId)) continue;
    usedRivals.add(idea.rivalTeam.teamId);
    recommendations.push({
      verdict: "EXPLORE",
      rival: { teamId: idea.rivalTeam.teamId, teamName: idea.rivalTeam.teamName },
      sends: [{ playerId: idea.send.playerId, name: idea.send.player.name, position: idea.send.player.position }],
      receives: [{ playerId: idea.receive.playerId, name: idea.receive.player.name, position: idea.receive.player.position }],
      dogsDeltas: idea.dogsDeltas,
      rivalDeltas: idea.rivalDeltas,
      confidence: round(Math.min(playerWeekEvidence(idea.send.player, week, projectionRows, cbsRows).confidence ?? 0.4, playerWeekEvidence(idea.receive.player, week, projectionRows, cbsRows).confidence ?? 0.4), 2),
      whyRivalAccepts: idea.rivalDeltas.restOfSeason >= 0
        ? `${idea.rivalTeam.teamName} gains ${idea.rivalDeltas.restOfSeason.toFixed(1)} average optimal-lineup points over the rest of the season.`
        : `${idea.rivalTeam.teamName} gives up only ${Math.abs(idea.rivalDeltas.restOfSeason).toFixed(1)} average points while changing positional shape.`,
      primaryRisk: "Projection disagreement, injuries, lineup needs, and player availability can change before acceptance.",
      proposal: `Would you consider ${idea.send.player.name} for ${idea.receive.player.name}? It improves my ${idea.receive.player.position} path and gives ${idea.rivalTeam.teamName} ${idea.send.player.name} for its current-season lineup.`,
      evidence: { method: "both teams' weekly exact legal optimal lineups; byes included; bench totals excluded", formatsConsidered: ["1-for-1"], blockedFormats: ["2-for-1 and 1-for-2 remain blocked until multi-player trade rules and post-trade 8–14 player roster handling are configured"] },
    });
    if (recommendations.length === 5) break;
  }
  return { recommendations, blockedReason: recommendations.length ? null : "No mutually rational legal 1-for-1 package cleared the current two-sided lineup gate." };
}

function teamOwnership(leagueState) {
  const owners = new Map();
  for (const team of leagueState.teams || []) for (const player of team.roster || []) owners.set(player.playerId, team);
  return owners;
}

function irEvidence(status) {
  const text = [status?.status, status?.injuryStatus, status?.practiceParticipation].join(" ").toLowerCase();
  return /\b(?:ir|pup)\b|injured reserve|physically unable|reserve\//i.test(text);
}

export function buildInjuryWatch({ pack, leagueState, week, statusSnapshot = null, researchSnapshot = null, fbgSnapshot = null, fantasyProsSnapshot = null, pffSnapshot = null }) {
  const keeperEvaluationActive = week >= KEEPER_EVALUATION_START_WEEK;
  const owners = teamOwnership(leagueState);
  const availabilityConfirmed = leagueRostersReady(leagueState);
  const available = new Set(availabilityConfirmed ? leagueState.availablePlayerIds || [] : []);
  const playerById = new Map(pack.players.map((player) => [player.id, player]));
  const projectionRows = projectionRowMaps({ fbgSnapshot, fantasyProsSnapshot, pffSnapshot });
  const cbsRows = cbsRowMap(leagueState);
  const actionable = (statusSnapshot?.updates || [])
    .filter((status) => ["critical", "high", "moderate"].includes(status.severity))
    .map((status) => {
      const player = playerById.get(status.playerId);
      if (!player) return null;
      const owner = owners.get(player.id);
      const signals = researchSignals(player, researchSnapshot);
      return {
        playerId: player.id,
        name: player.name,
        position: player.position,
        nflTeam: player.nflTeam,
        severity: status.severity,
        status: status.injuryStatus || status.status || "Status unclear",
        bodyPart: status.injuryBodyPart || "",
        practice: status.practiceParticipation || "",
        notes: status.injuryNotes || "",
        updatedAt: status.newsUpdated || statusSnapshot.capturedAt,
        leagueStatus: available.has(player.id) ? "AVAILABLE" : owner?.teamId === USER_TEAM_ID ? "DOGS OF WAR" : owner?.teamName || (availabilityConfirmed ? "UNRESOLVED" : "UNCONFIRMED"),
        projection: playerWeekEvidence(player, week, projectionRows, cbsRows),
        news: signals.news,
      };
    })
    .filter(Boolean)
    .sort((left, right) => ["critical", "high", "moderate"].indexOf(left.severity) - ["critical", "high", "moderate"].indexOf(right.severity) || (right.projection.points ?? -1) - (left.projection.points ?? -1));

  const irTargets = actionable
    .filter((row) => irEvidence((statusSnapshot?.updates || []).find((status) => status.playerId === row.playerId)))
    .map((row) => {
      const player = playerById.get(row.playerId);
      const remaining = weekRange(week, 17).map((candidateWeek) => playerWeekEvidence(player, candidateWeek, projectionRows, cbsRows).points);
      const healthyRosAverage = average(remaining);
      const action = row.leagueStatus === "AVAILABLE" ? "STASH WATCH" : row.leagueStatus === "DOGS OF WAR" ? "HOLD / IR" : row.leagueStatus === "UNCONFIRMED" ? "MONITOR" : "TRADE WATCH";
      const keeperUpside = player.vbd >= 35 ? "HIGH" : player.vbd >= 15 ? "MEDIUM" : "SPECULATIVE";
      return {
        ...row,
        action,
        healthyRosAverage: round(healthyRosAverage),
        preInjuryVbd: player.vbd,
        keeperUpside,
        keeperEvaluationActive,
        keeperCost: keeperEvaluationActive && row.leagueStatus !== "AVAILABLE" ? owners.get(player.id)?.roster?.find((entry) => entry.playerId === player.id)?.salary ?? null : null,
        returnOutlook: "Return date is not inferred. Confirm the official NFL/CBS eligibility window and practice activation before using a roster spot.",
        reason: keeperEvaluationActive
          ? `${player.name}'s governed healthy projection and ${keeperUpside.toLowerCase()} keeper upside merit monitoring; Week ${week} keeper review may also use the recorded keeper salary when one exists.`
          : `${player.name}'s governed healthy projection and ${keeperUpside.toLowerCase()} long-term upside merit monitoring; salary is excluded until the Week ${KEEPER_EVALUATION_START_WEEK} keeper-review window.`,
      };
    })
    .sort((left, right) => (right.healthyRosAverage ?? -1) - (left.healthyRosAverage ?? -1) || right.preInjuryVbd - left.preInjuryVbd)
    .slice(0, 10);
  return { injuries: actionable.slice(0, 30), irTargets };
}

function sourceChip(label, timestamp, now, required = false) {
  return { label, asOf: timestamp || null, ageMinutes: ageMinutes(timestamp, now), required };
}

function sourceState({ leagueState, pack, week, fbgSnapshot, fantasyProsSnapshot, pffSnapshot, researchSnapshot, statusSnapshot, now }) {
  const cbsAge = leagueState.authority.startsWith("authenticated") ? ageMinutes(leagueState.capturedAt, now) : null;
  const projectionAt = fbgSnapshot?.providerAsOf || pack.weeklyContext?.asOf || pack.asOf;
  const projectionAge = ageMinutes(projectionAt, now);
  const cbsFresh = cbsAge !== null && cbsAge <= 30 * 60;
  const projectionFresh = projectionAge !== null && projectionAge <= 48 * 60;
  const projectionUsable = projectionAge !== null && projectionAge <= 14 * 24 * 60;
  const rostersReady = leagueRostersReady(leagueState);
  const cbsProjectionReady = leagueState.projectionWeek === week && (leagueState.projectionCount ?? leagueState.weeklyProjections?.length ?? 0) >= 100;
  const signedInPremiumReady = Boolean(fantasyProsSnapshot && pffSnapshot);
  const state = !cbsFresh || !projectionUsable ? "STALE" : projectionFresh && rostersReady && cbsProjectionReady && signedInPremiumReady ? "READY" : "PARTIAL";
  const alerts = [];
  if (!leagueState.authority.startsWith("authenticated")) alerts.push("CBS league data has not been synced; roster, waiver, and manager-move guidance remains blocked until Update CBS or Update everything captures the league.");
  else if (!cbsFresh) alerts.push("CBS league data is older than 30 hours. Sync before trusting availability or manager moves.");
  if (leagueState.authority.startsWith("authenticated") && !rostersReady) alerts.push(incompleteRosterMessage(leagueState, "Waiver and trade advice"));
  if (leagueState.authority.startsWith("authenticated") && !cbsProjectionReady) alerts.push(`CBS Week ${week} component-stat projections have not been captured yet. Keep the current Data Helper and choose Update CBS or Update everything; existing lineup and availability evidence remains usable but the plan stays PARTIAL.`);
  if (leagueState.authority.startsWith("authenticated") && leagueState.fabState?.status !== "COMPLETE" && !isCbsFabNotStarted(leagueState.fabState, week)) alerts.push(incompleteFabMessage(leagueState.fabState));
  if (!projectionFresh && projectionUsable) alerts.push("Current-week projections use the governed dated baseline. Choose Update FBG or Update everything to fetch fresh raw-stat Footballguys projections.");
  if (!projectionUsable) alerts.push("Projection evidence is older than 14 days; recommendations remain visible only as a stale recovery plan.");
  if (!fantasyProsSnapshot) alerts.push("FantasyPros signed-in weekly component stats have not been captured; the available-source blend is reweighted without them.");
  if (!pffSnapshot) alerts.push("PFF signed-in weekly component stats have not been captured; the available-source blend is reweighted without them.");
  if (researchSnapshot?.staleFallback || statusSnapshot?.staleFallback) alerts.push("One or more injury/news sources are using the last-known-good snapshot.");
  return { state, alerts, projectionAt };
}

export function buildSeasonRecommendationSnapshot({
  pack,
  leagueState,
  week,
  fbgSnapshot = null,
  fantasyProsSnapshot = null,
  pffSnapshot = null,
  researchSnapshot = null,
  statusSnapshot = null,
  leagueMoves = [],
  generatedAt = new Date().toISOString(),
}) {
  const playerById = new Map(pack.players.map((player) => [player.id, player]));
  const projectionRows = projectionRowMaps({ fbgSnapshot, fantasyProsSnapshot, pffSnapshot });
  const cbsRows = cbsRowMap(leagueState);
  const statuses = statusMap(statusSnapshot);
  const dogs = rosterTeam(leagueState, USER_TEAM_ID);
  if (!dogs) throw new Error("Dogs of War is not present in the league state.");
  const optimized = optimizeExactLineup(dogs.roster, { week, playerById, projectionRows, cbsRows, statuses });
  const starterIds = new Set(optimized.starters.map((entry) => entry.playerId));
  const swaps = optimized.bench
    .filter((bench) => bench.projection.points !== null && !criticalStatus(bench.status))
    .map((bench) => {
      const positionStarters = optimized.starters.filter((starter) => starter.player.position === bench.player.position);
      const edgeStarter = positionStarters.sort((left, right) => left.projection.points - right.projection.points)[0];
      return edgeStarter ? {
        start: edgeStarter.player.name,
        sit: bench.player.name,
        position: bench.player.position,
        delta: round(edgeStarter.projection.points - bench.projection.points),
        confidence: round(Math.min(edgeStarter.projection.confidence ?? 0.4, bench.projection.confidence ?? 0.4), 2),
        reason: `${edgeStarter.player.name} has the higher current Week ${week} registered consensus; bench totals are excluded.`,
      } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.delta - right.delta)
    .slice(0, 6);
  const waiver = recommendWaivers({ pack, leagueState, week, fbgSnapshot, fantasyProsSnapshot, pffSnapshot, statusSnapshot, researchSnapshot, leagueMoves });
  const trades = recommendTrades({ pack, leagueState, week, fbgSnapshot, fantasyProsSnapshot, pffSnapshot, statusSnapshot });
  const watch = buildInjuryWatch({ pack, leagueState, week, statusSnapshot, researchSnapshot, fbgSnapshot, fantasyProsSnapshot, pffSnapshot });
  const freshness = sourceState({ leagueState, pack, week, fbgSnapshot, fantasyProsSnapshot, pffSnapshot, researchSnapshot, statusSnapshot, now: generatedAt });
  return {
    schemaVersion: 1,
    kind: "thunder-bowl-season-recommendations",
    season: pack.season,
    week,
    generatedAt,
    state: freshness.state,
    alerts: freshness.alerts,
    refreshBehavior: "Each source can be refreshed independently. Update everything captures signed-in CBS, Footballguys, FantasyPros, and PFF component-stat projections and applies Thunder Bowl scoring before refreshing rosters, moves, injuries, depth, news, and IR evidence. The Tuesday scheduler refreshes sources available without your browser; archived Tuesday plans never change.",
    sources: [
      sourceChip("CBS league", leagueState.authority.startsWith("authenticated") ? leagueState.capturedAt : null, generatedAt, true),
      sourceChip("CBS stats", leagueState.projectionWeek === week && (leagueState.projectionCount ?? leagueState.weeklyProjections?.length ?? 0) >= 100 ? leagueState.capturedAt : null, generatedAt),
      sourceChip("FBG projections", freshness.projectionAt, generatedAt, true),
      sourceChip("FantasyPros", fantasyProsSnapshot?.providerAsOf, generatedAt),
      sourceChip("PFF", pffSnapshot?.providerAsOf, generatedAt),
      sourceChip("injury / news", statusSnapshot?.capturedAt || researchSnapshot?.capturedAt, generatedAt),
    ],
    baseline: {
      authority: leagueState.authority,
      source: leagueState.source,
      asOf: leagueState.capturedAt,
      rosteredPlayers: leagueState.rosteredPlayerCount ?? null,
      rosterMinimum: leagueState.rosterMinimum ?? 8,
      rosterMaximum: leagueState.rosterMaximum ?? leagueState.rosterTarget ?? 14,
      legalTeamCount: leagueState.legalTeamCount ?? leagueState.completeTeamCount ?? null,
      teamCount: leagueState.teamCount ?? leagueState.teams?.length ?? null,
      rostersReady: leagueRostersReady(leagueState),
      projectionWeek: leagueState.projectionWeek ?? null,
      projectionCount: leagueState.projectionCount ?? leagueState.weeklyProjections?.length ?? 0,
      fabStatus: leagueState.fabState?.status || "UNAVAILABLE",
      fabCapturedAt: leagueState.fabState?.capturedAt || null,
      // Backward-compatible aliases for older clients.
      rosterTarget: leagueState.rosterMaximum ?? leagueState.rosterTarget ?? 14,
      completeTeamCount: leagueState.legalTeamCount ?? leagueState.completeTeamCount ?? null,
      rostersComplete: leagueRostersReady(leagueState),
    },
    lineup: {
      legal: optimized.missingSlots.length === 0 && starterIds.size === 8,
      total: optimized.total,
      requiredSlots: { ...STARTER_REQUIREMENTS },
      missingSlots: optimized.missingSlots,
      starters: optimized.starters.map(lineupPublicRow),
      bench: optimized.bench.map(lineupPublicRow),
      swaps,
    },
    waivers: waiver,
    trades,
    watch: { ...watch, leagueMoves: leagueMoves.slice(0, 50) },
    model: {
      deterministic: true,
      monteCarlo: false,
      seed: null,
      missingPolicy: "missing is excluded, never zero",
      contextPolicy: "news, injury, depth, matchup, weather, travel, and venue are evidence-only unless a time-forward gate earns authority",
      salaryPolicy: `roster salary and contract data are excluded from lineup, player ranking, waiver value, and trade value; the separately captured $50 FAB balance is used only to size blind-auction waiver bids; roster salary is shown only in Week ${KEEPER_EVALUATION_START_WEEK}+ keeper-stash review`,
    },
  };
}
