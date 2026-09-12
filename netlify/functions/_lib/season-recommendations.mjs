import { STARTER_REQUIREMENTS } from "../../../public/thunder-bowl/state-engine.mjs";
import { PREMIUM_PROJECTION_SOURCES, projectionSourceWeights } from "../../../public/thunder-bowl/projection-lab.mjs";
import { ageMinutes } from "./season-time.mjs";
import { kickoffAt, sourceAudit } from "./season-management.mjs";

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

function scheduleOpponent(leagueState, teamId, week) {
  const schedule = leagueState?.leagueSchedule;
  if (schedule?.allPlayWeeks?.includes(week)) return { teamId: null, teamName: "All-play", allPlay: true };
  const matchup = schedule?.matchups?.find((row) => row.week === week && (row.teamAId === teamId || row.teamBId === teamId));
  if (!matchup) return null;
  return matchup.teamAId === teamId
    ? { teamId: matchup.teamBId, teamName: matchup.teamBName, allPlay: false }
    : { teamId: matchup.teamAId, teamName: matchup.teamAName, allPlay: false };
}

function teamSchedule(leagueState, teamId) {
  const weeks = leagueState?.leagueSchedule?.headToHeadWeeks || [];
  return [...weeks, ...(leagueState?.leagueSchedule?.allPlayWeeks || [])]
    .sort((left, right) => left - right)
    .map((week) => ({ week, opponent: scheduleOpponent(leagueState, teamId, week) }));
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

function projectionRowMaps({ fbgSnapshot = null, fantasyProsSnapshot = null, pffSnapshot = null, allowSeasonShapes = false } = {}) {
  const snapshots = [
    ["Footballguys", fbgSnapshot],
    ["FantasyPros", fantasyProsSnapshot],
    ["PFF", pffSnapshot],
  ];
  const rows = new Map(snapshots.map(([source, snapshot]) => [source, new Map((snapshot?.items || []).map((row) => [`${row.playerId}|${row.week}`, {
    ...row,
    snapshotSource: snapshot.source,
    snapshotAuthority: snapshot.authority,
  }]))]));
  rows.allowSeasonShapes = allowSeasonShapes;
  return rows;
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
    const points = rawRow
      ? rawRow.points
      : projectionRows.allowSeasonShapes
        ? scaled
        : ["FantasyPros", "PFF"].includes(sourceName)
          ? null
          : scaled;
    if (!Number.isFinite(points)) continue;
    sourceRows.push({
      source: sourceName,
      points: round(points),
      basis: rawRow ? "DIRECT_WEEKLY" : "SEASON_DERIVED",
      asOf: rawRow ? rawRow.providerAsOf : seasonSource.asOf,
      input: rawRow
        ? /authenticated/i.test(rawRow.snapshotAuthority || "")
          ? `signed-in ${sourceName} component stats scored by Thunder Bowl rules`
          : "provider component stats scored by Thunder Bowl rules"
        : projectionRows.allowSeasonShapes
          ? "governed early-outlook weekly shape"
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

function cachedPlayerWeekEvidence(player, week, projectionRows, cbsRows, evidenceCache = null) {
  if (!evidenceCache) return playerWeekEvidence(player, week, projectionRows, cbsRows);
  const key = `${player.id}|${week}`;
  if (!evidenceCache.has(key)) evidenceCache.set(key, playerWeekEvidence(player, week, projectionRows, cbsRows));
  return evidenceCache.get(key);
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

export function optimizeExactLineup(roster, { week, playerById, projectionRows = null, fbgRows = new Map(), cbsRows = new Map(), statuses = new Map(), evidenceCache = null }) {
  const activeProjectionRows = projectionRows || new Map([["Footballguys", fbgRows]]);
  const candidates = rosterPlayers(roster, playerById).map((entry) => ({
    ...entry,
    projection: cachedPlayerWeekEvidence(entry.player, week, activeProjectionRows, cbsRows, evidenceCache),
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

function lineupPublicRow(entry, { includeGameDetails = true, adviceTeamId = USER_TEAM_ID, adviceTeamName = "Dogs of War", week = null, season = 2026 } = {}) {
  const gameTime = includeGameDetails ? entry.gameTime : null;
  return {
    playerId: entry.playerId,
    name: entry.player.name,
    position: entry.player.position,
    nflTeam: entry.player.nflTeam,
    opponent: includeGameDetails ? entry.opponent : null,
    gameTime,
    kickoffAt: gameTime ? kickoffAt(gameTime, week, season) : null,
    bye: entry.bye ?? entry.player.weeklyProjection?.byeWeek ?? null,
    points: entry.projection.points,
    floor: entry.projection.floor,
    ceiling: entry.projection.ceiling,
    confidence: entry.projection.confidence,
    sourceSpread: entry.projection.spread,
    sources: entry.projection.sources,
    adviceTeamId,
    adviceTeamName,
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
  if (!context.lineupCache) return weeks.map((week) => optimizeExactLineup(roster, { ...context, week }));
  const rosterKey = roster.map((entry) => entry.playerId).sort().join("|");
  return weeks.map((week) => {
    const key = `${rosterKey}|${week}`;
    if (!context.lineupCache.has(key)) {
      const optimized = optimizeExactLineup(roster, { ...context, week });
      context.lineupCache.set(key, { total: optimized.total });
    }
    return context.lineupCache.get(key);
  });
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

function playerProjectionAverage(player, weeks, context) {
  return round(average(weeks.map((candidateWeek) => cachedPlayerWeekEvidence(
    player,
    candidateWeek,
    context.projectionRows,
    context.cbsRows,
    context.evidenceCache,
  ).points)));
}

function playerValueHorizons(player, { currentWeek, nextThree, ros }, context) {
  if (!player) return { week: 0, nextThree: 0, restOfSeason: 0 };
  return {
    week: playerProjectionAverage(player, currentWeek, context),
    nextThree: playerProjectionAverage(player, nextThree, context),
    restOfSeason: playerProjectionAverage(player, ros, context),
  };
}

function rosterPositionCounts(roster) {
  return Object.fromEntries(POSITIONS.map((position) => [position, roster.filter((entry) => entry.player.position === position).length]));
}

function usableAtPosition(roster, position, week, context) {
  return roster.filter((entry) => entry.player.position === position
    && entry.bye !== week
    && entry.player.weeklyProjection?.byeWeek !== week
    && !criticalStatus(context.statuses.get(entry.playerId))
    && Number.isFinite(cachedPlayerWeekEvidence(entry.player, week, context.projectionRows, context.cbsRows, context.evidenceCache).points));
}

function protectedPositionFit(addPlayer, drop, currentRoster, week, context) {
  if (!['QB', 'K', 'DST'].includes(addPlayer.position)) return { allowed: true, need: "OPEN", rationale: "Skill-position depth or lineup upgrade." };
  const usable = usableAtPosition(currentRoster, addPlayer.position, week, context).length;
  const samePositionReplacement = drop?.player.position === addPlayer.position;
  const protectedLimit = addPlayer.position === "QB" ? 2 : 1;
  if (samePositionReplacement) return { allowed: true, need: "REPLACEMENT", rationale: `Replaces a current ${addPlayer.position}; it does not create an extra ${addPlayer.position} roster spot.` };
  if (usable >= protectedLimit) {
    return {
      allowed: false,
      need: "NONE",
      rationale: `Dogs of War already has ${usable} usable ${addPlayer.position}${usable === 1 ? "" : "s"} for Week ${week}; no current-week need justifies another one.`,
    };
  }
  return { allowed: true, need: "COVERAGE", rationale: `The current roster does not have its normal usable ${addPlayer.position} coverage for Week ${week}.` };
}

function meaningfulWaiverEdge(row) {
  const weekGain = Number(row.currentDelta.delta || 0);
  const nextThreeGain = Number(row.nextThreeDelta.delta || 0);
  const rosGain = Number(row.rosDelta.delta || 0);
  const resilienceGain = Number(row.currentDelta.resilienceWeeks || 0) + Number(row.nextThreeDelta.resilienceWeeks || 0);
  const directWeekGain = Number(row.depthDelta.week || 0);
  const directNextThreeGain = Number(row.depthDelta.nextThree || 0);
  const directRosGain = Number(row.depthDelta.restOfSeason || 0);
  const lineupUpgrade = weekGain >= 1.5 || nextThreeGain >= 1 || rosGain >= 0.75 || resilienceGain > 0;
  const samePositionUpgrade = !["QB", "K", "DST"].includes(row.addPlayer.position)
    && row.drop?.player.position === row.addPlayer.position
    && (directWeekGain >= 1.5 || directNextThreeGain >= 1 || directRosGain >= 0.75);
  return lineupUpgrade || samePositionUpgrade;
}

const COMPONENT_STAT_KEYS = Object.freeze([
  "passingAttempts",
  "passingCompletions",
  "passingYards",
  "passingTouchdowns",
  "interceptionsThrown",
  "rushingAttempts",
  "rushingYards",
  "rushingTouchdowns",
  "targets",
  "receptions",
  "receivingYards",
  "receivingTouchdowns",
  "fumblesLost",
  "fieldGoalsMade",
  "fieldGoalsMade50Plus",
  "extraPointsMade",
  "defensiveSacks",
  "defensiveInterceptions",
  "defensiveFumblesRecovered",
  "defensiveTouchdowns",
  "defensiveSafeties",
  "blockedKicks",
  "defensivePointsAllowed",
]);

export function blendProjectedStats(projection) {
  const blended = {};
  for (const key of COMPONENT_STAT_KEYS) {
    const rows = (projection?.sources || []).filter((source) => Object.prototype.hasOwnProperty.call(source.projectedStats || {}, key) && Number.isFinite(Number(source.projectedStats[key])));
    const weightTotal = rows.reduce((sum, source) => sum + Number(source.weight || 0), 0);
    blended[key] = rows.length && weightTotal > 0
      ? round(rows.reduce((sum, source) => sum + Number(source.projectedStats[key]) * Number(source.weight || 0), 0) / weightTotal, 2)
      : null;
  }
  return blended;
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
  if (!fab.available || fab.budget < 1 || fab.spendable < 1 || !["ADD", "CLAIM"].includes(verdict)) return { recommended: null, maximum: null, budgetAfter: null };
  const gains = [row.currentDelta.delta, row.nextThreeDelta.delta, row.rosDelta.delta].map((value) => Number(value || 0));
  const strength = Math.max(0, gains[0] * 2 + gains[1] * 3 + gains[2] * 2 + (row.currentDelta.resilienceWeeks + row.nextThreeDelta.resilienceWeeks) * 3);
  const base = verdict === "ADD" ? 4 : 2;
  const rawBid = base + Math.ceil(strength / 4);
  const positionCap = ["K", "DST"].includes(row.addPlayer.position) ? 2 : verdict === "CLAIM" ? 8 : 15;
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
  const evidenceCache = new Map();
  const statuses = statusMap(statusSnapshot);
  const userTeam = rosterTeam(leagueState, USER_TEAM_ID);
  if (!userTeam) return { recommendations: [], blockedReason: "Dogs of War is missing from the CBS snapshot." };
  const currentRoster = rosterPlayers(userTeam.roster, playerById);
  const fab = effectiveFabState(leagueState, leagueMoves, currentRoster, week);
  const context = { playerById, projectionRows, cbsRows, statuses, evidenceCache, lineupCache: new Map() };
  const currentWeek = [week];
  const nextThree = weekRange(week, week + 2);
  const ros = weekRange(week, 17);
  const available = leagueState.availablePlayerIds
    .map((id) => playerById.get(id))
    .filter(Boolean)
    .filter((player) => cachedPlayerWeekEvidence(player, week, projectionRows, cbsRows, context.evidenceCache).points !== null && !criticalStatus(statuses.get(player.id)))
    .sort((left, right) => {
      const leftPoints = cachedPlayerWeekEvidence(left, week, projectionRows, cbsRows, context.evidenceCache).points ?? -1;
      const rightPoints = cachedPlayerWeekEvidence(right, week, projectionRows, cbsRows, context.evidenceCache).points ?? -1;
      return rightPoints - leftPoints || right.vbd - left.vbd;
    })
    .slice(0, 100);
  const candidates = [];
  for (const addPlayer of available) {
    let best = null;
    const dropOptions = currentRoster.length < 14 ? [null, ...currentRoster] : currentRoster;
    for (const drop of dropOptions) {
      const rosterFit = protectedPositionFit(addPlayer, drop, currentRoster, week, context);
      if (!rosterFit.allowed) continue;
      const afterRoster = currentRoster.filter((entry) => entry.playerId !== drop?.playerId).concat({
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
      const addValue = playerValueHorizons(addPlayer, { currentWeek, nextThree, ros }, context);
      const dropValue = playerValueHorizons(drop?.player || null, { currentWeek, nextThree, ros }, context);
      const depthDelta = {
        week: round(Number(addValue.week || 0) - Number(dropValue.week || 0)),
        nextThree: round(Number(addValue.nextThree || 0) - Number(dropValue.nextThree || 0)),
        restOfSeason: round(Number(addValue.restOfSeason || 0) - Number(dropValue.restOfSeason || 0)),
      };
      const row = { addPlayer, drop, afterRoster, currentDelta, nextThreeDelta, rosDelta, addValue, dropValue, depthDelta, rosterFit };
      const tuple = [
        currentDelta.resilienceWeeks,
        currentDelta.delta ?? -999,
        nextThreeDelta.delta ?? -999,
        rosDelta.delta ?? -999,
        depthDelta.nextThree ?? -999,
        depthDelta.restOfSeason ?? -999,
      ];
      if (!best || compareNumberTuples(tuple, best.tuple) > 0) best = { ...row, tuple };
    }
    if (!best) continue;
    if (!meaningfulWaiverEdge(best)) continue;
    candidates.push(best);
  }
  candidates.sort((left, right) => {
    for (let index = 0; index < left.tuple.length; index += 1) if (left.tuple[index] !== right.tuple[index]) return right.tuple[index] - left.tuple[index];
    return right.addPlayer.vbd - left.addPlayer.vbd;
  });
  const recommendations = candidates.slice(0, 25).map((row, index) => {
    const projection = cachedPlayerWeekEvidence(row.addPlayer, week, projectionRows, cbsRows, context.evidenceCache);
    const signals = researchSignals(row.addPlayer, researchSnapshot);
    const verdict = (row.currentDelta.delta ?? 0) >= 2 && (row.nextThreeDelta.delta ?? 0) > 0
      ? "ADD"
      : "CLAIM";
    const horizon = row.currentDelta.delta && row.currentDelta.delta > 0 ? `+${row.currentDelta.delta.toFixed(1)} expected Week ${week} points` : `${row.nextThreeDelta.delta >= 0 ? "+" : ""}${row.nextThreeDelta.delta?.toFixed(1) || "0.0"} average over the next three weeks`;
    const bid = fabBidFor(row, verdict, fab);
    const sequenceTie = fabSequenceTie(fab, index);
    return {
      priority: index + 1,
      verdict,
      add: { playerId: row.addPlayer.id, name: row.addPlayer.name, position: row.addPlayer.position, nflTeam: row.addPlayer.nflTeam, opponent: null, gameTime: null },
      drop: row.drop ? { playerId: row.drop.playerId, name: row.drop.player.name, position: row.drop.player.position, nflTeam: row.drop.player.nflTeam } : null,
      gains: { week: row.currentDelta.delta, nextThree: row.nextThreeDelta.delta, restOfSeason: row.rosDelta.delta, resilienceWeeks: row.currentDelta.resilienceWeeks + row.nextThreeDelta.resilienceWeeks },
      addValue: row.addValue,
      dropValue: row.dropValue,
      depthDelta: row.depthDelta,
      dropProjectionLoss: row.drop ? row.dropValue.week : 0,
      confidence: projection.confidence,
      availability: { source: "CBS authenticated all-team roster snapshot", asOf: leagueState.capturedAt, evidence: "not rostered by any of the 12 CBS teams" },
      reason: row.drop
        ? `${horizon}; dropping ${row.drop.player.name} gives up ${row.dropValue.week?.toFixed(1) || "0.0"} projected Week ${week} bench/depth points, which is counted even when the starting lineup is unchanged.`
        : `${horizon}; Dogs of War has an open roster spot, so no player must be dropped.`,
      evidence: {
        projections: projection.sources,
        range: { floor: projection.floor, median: projection.points, ceiling: projection.ceiling },
        role: signals.depth,
        news: signals.news,
        rosterFit: {
          ...row.rosterFit,
          beforeSize: currentRoster.length,
          afterSize: row.afterRoster.length,
          beforeCounts: rosterPositionCounts(currentRoster),
          afterCounts: rosterPositionCounts(row.afterRoster),
          noFlex: true,
        },
        rankingRule: "legal/resilience gain, meaningful Week/next-three/rest-of-season lineup gain, then the projected depth surrendered; duplicate QB/K/DST adds require a documented need or same-position replacement",
      },
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
  const counts = rosterPositionCounts(currentRoster);
  const hold = recommendations.length ? null : {
    verdict: "HOLD",
    confidence: "HIGH",
    reason: `Hold FAB and roster depth. Dogs of War already has a legal ${currentRoster.length}-player roster, and no CBS-available player produced a meaningful lineup or depth upgrade after counting the actual value of the player surrendered. Duplicate QB, K, or DST claims are excluded unless they replace that position or solve a documented Week ${week} availability need.`,
    roster: { size: currentRoster.length, maximum: 14, counts, noFlex: true },
    fab: { currentBudget: fab.budget, orderAvailable: fab.orderAvailable, plannedReserve: fab.plannedReserve },
  };
  return { recommendations, hold, blockedReason: null, fab: publicFab };
}

function tradeDelta(beforeRoster, afterRoster, weeks, context) {
  return marginal(beforeRoster, afterRoster, weeks.filter((candidate) => candidate >= context.currentWeek), context).delta;
}

function tradePlayerEvidence(entry, week, context, researchSnapshot) {
  const projection = cachedPlayerWeekEvidence(entry.player, week, context.projectionRows, context.cbsRows, context.evidenceCache);
  const signals = researchSignals(entry.player, researchSnapshot);
  const status = context.statuses.get(entry.playerId) || null;
  const directSources = projection.sources.filter((source) => /component stats scored by Thunder Bowl rules/i.test(source.input || ""));
  return {
    playerId: entry.playerId,
    name: entry.player.name,
    position: entry.player.position,
    nflTeam: entry.player.nflTeam,
    weekProjection: {
      points: projection.points,
      floor: projection.floor,
      ceiling: projection.ceiling,
      confidence: projection.confidence,
      sourceSpread: projection.spread,
      sources: projection.sources,
      directSourceCount: directSources.length,
      directProjectionReady: directSources.length > 0,
    },
    injury: status ? {
      severity: status.severity,
      status: status.injuryStatus || status.status || "",
      bodyPart: status.injuryBodyPart || "",
      practice: status.practiceParticipation || "",
      updatedAt: status.newsUpdated,
    } : null,
    news: signals.news,
  };
}

export function classifyTradeIdea({ dogsDeltas, rivalDeltas, evidenceComplete = false, incomingInjury = false, positionalRisk = null, week = 1 }) {
  const dogs = [dogsDeltas.week, dogsDeltas.nextThree, dogsDeltas.restOfSeason, dogsDeltas.division, dogsDeltas.playoffs].filter(Number.isFinite);
  const rival = [rivalDeltas.week, rivalDeltas.nextThree, rivalDeltas.restOfSeason, rivalDeltas.division, rivalDeltas.playoffs].filter(Number.isFinite);
  const rivalNegativeWindows = rival.filter((value) => value < -0.35).length;
  const dogsWorst = dogs.length ? Math.min(...dogs) : null;
  const rivalWorst = rival.length ? Math.min(...rival) : null;
  const earlySeasonPremium = week <= 2 ? 0.25 : 0;
  const offer = Number(dogsDeltas.restOfSeason) >= 1 + earlySeasonPremium
    && Number(dogsDeltas.nextThree) >= 0.5
    && (dogsDeltas.playoffs === null || Number(dogsDeltas.playoffs) >= 0.5)
    && Number(rivalDeltas.restOfSeason) >= 0.35
    && rivalWorst >= -0.35
    && evidenceComplete
    && !incomingInjury
    && !positionalRisk;
  if (offer) return { verdict: "OFFER", confidence: "HIGH", rivalNegativeWindows, dogsWorst, rivalWorst };
  const monitor = Number(dogsDeltas.restOfSeason) >= 0.35
    && Number(dogsDeltas.nextThree) >= -0.25
    && Number(rivalDeltas.restOfSeason) >= -0.1
    && rivalNegativeWindows <= 1;
  if (monitor) return { verdict: "MONITOR", confidence: evidenceComplete && !incomingInjury ? "MEDIUM" : "LOW", rivalNegativeWindows, dogsWorst, rivalWorst };
  return { verdict: "PASS", confidence: rivalNegativeWindows > 1 || Number(dogsDeltas.restOfSeason) < 0.35 ? "HIGH" : "MEDIUM", rivalNegativeWindows, dogsWorst, rivalWorst };
}

export function recommendTrades({ pack, leagueState, week, fbgSnapshot = null, fantasyProsSnapshot = null, pffSnapshot = null, statusSnapshot = null, researchSnapshot = null }) {
  if (!leagueRostersReady(leagueState)) return { recommendations: [], blockedReason: incompleteRosterMessage(leagueState, "Trade advice") };
  const playerById = new Map(pack.players.map((player) => [player.id, player]));
  const projectionRows = projectionRowMaps({ fbgSnapshot, fantasyProsSnapshot, pffSnapshot });
  const cbsRows = cbsRowMap(leagueState);
  const statuses = statusMap(statusSnapshot);
  const context = { playerById, projectionRows, cbsRows, statuses, currentWeek: week, evidenceCache: new Map(), lineupCache: new Map() };
  const dogsTeam = rosterTeam(leagueState, USER_TEAM_ID);
  if (!dogsTeam) return { recommendations: [], blockedReason: "Dogs of War roster is unavailable." };
  const dogs = rosterPlayers(dogsTeam.roster, playerById);
  const dogsCurrentLineup = optimizeExactLineup(dogs, { week, ...context });
  const dogsStarterIds = new Set(dogsCurrentLineup.starters.map((entry) => entry.playerId));
  const currentWeek = [week];
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
          week: tradeDelta(dogs, nextDogs, currentWeek, context),
          nextThree: tradeDelta(dogs, nextDogs, nextThree, context),
          restOfSeason: tradeDelta(dogs, nextDogs, ros, context),
          division: division.length ? tradeDelta(dogs, nextDogs, division, context) : null,
          playoffs: playoffs.length ? tradeDelta(dogs, nextDogs, playoffs, context) : null,
        };
        const rivalDeltas = {
          week: tradeDelta(rival, nextRival, currentWeek, context),
          nextThree: tradeDelta(rival, nextRival, nextThree, context),
          restOfSeason: tradeDelta(rival, nextRival, ros, context),
          division: division.length ? tradeDelta(rival, nextRival, division, context) : null,
          playoffs: playoffs.length ? tradeDelta(rival, nextRival, playoffs, context) : null,
        };
        if (dogsDeltas.restOfSeason === null || rivalDeltas.restOfSeason === null || dogsDeltas.restOfSeason <= 0.15 || rivalDeltas.restOfSeason < -0.35) continue;
        const mutualScore = dogsDeltas.restOfSeason + Math.min(0.5, rivalDeltas.restOfSeason);
        ideas.push({ rivalTeam, rival, nextRival, nextDogs, send, receive, dogsDeltas, rivalDeltas, mutualScore });
      }
    }
  }
  ideas.sort((left, right) => right.mutualScore - left.mutualScore || (right.dogsDeltas.nextThree ?? -999) - (left.dogsDeltas.nextThree ?? -999));
  const usedRivals = new Set();
  const recommendations = [];
  for (const idea of ideas) {
    if (usedRivals.has(idea.rivalTeam.teamId)) continue;
    usedRivals.add(idea.rivalTeam.teamId);
    const sendEvidence = tradePlayerEvidence(idea.send, week, context, researchSnapshot);
    const receiveEvidence = tradePlayerEvidence(idea.receive, week, context, researchSnapshot);
    const evidenceComplete = sendEvidence.weekProjection.directProjectionReady && receiveEvidence.weekProjection.directProjectionReady;
    const incomingInjury = Boolean(receiveEvidence.injury?.status && !/^active$/i.test(receiveEvidence.injury.status));
    const dogsCounts = rosterPositionCounts(dogs);
    const nextDogsCounts = rosterPositionCounts(idea.nextDogs);
    const rivalCounts = rosterPositionCounts(idea.rival);
    const nextRivalCounts = rosterPositionCounts(idea.nextRival);
    const positionalRisk = idea.send.player.position === "RB" && idea.receive.player.position !== "RB" && dogsCounts.RB <= 4
      ? `This sends away one of only ${dogsCounts.RB} running backs for a ${idea.receive.player.position} in a no-flex league, reducing startable RB depth.`
      : null;
    const classification = classifyTradeIdea({ dogsDeltas: idea.dogsDeltas, rivalDeltas: idea.rivalDeltas, evidenceComplete, incomingInjury, positionalRisk, week });
    const losingWindows = Object.entries(idea.rivalDeltas).filter(([, value]) => Number.isFinite(value) && value < -0.35).map(([label]) => label);
    const whyRivalAccepts = classification.verdict === "OFFER"
      ? `${idea.rivalTeam.teamName} gains ${idea.rivalDeltas.restOfSeason.toFixed(1)} average rest-of-season lineup points without a material loss in another tested window.`
      : losingWindows.length
        ? `${idea.rivalTeam.teamName} loses meaningful modeled value in ${losingWindows.join(", ")}; that weakens the acceptance case even if another horizon is slightly positive.`
        : `${idea.rivalTeam.teamName} is roughly flat, but the modeled benefit is too small to assume acceptance.`;
    const missingEvidence = [sendEvidence, receiveEvidence].filter((item) => !item.weekProjection.directProjectionReady).map((item) => item.name);
    const primaryRisk = [
      positionalRisk,
      missingEvidence.length ? `Fresh signed-in component-stat projections are missing for ${missingEvidence.join(" and ")}.` : null,
      incomingInjury ? `${idea.receive.player.name} carries a current ${receiveEvidence.injury.status} designation.` : null,
      classification.rivalNegativeWindows ? `${idea.rivalTeam.teamName} loses more than 0.35 points in ${classification.rivalNegativeWindows} tested window${classification.rivalNegativeWindows === 1 ? "" : "s"}.` : null,
    ].filter(Boolean).join(" ") || "Projection disagreement, role changes, and new injury evidence can alter both teams' incentives.";
    const proposal = classification.verdict === "OFFER"
      ? `Would you consider ${idea.send.player.name} for ${idea.receive.player.name}? The current evidence shows a meaningful legal-lineup benefit for both teams.`
      : classification.verdict === "MONITOR"
        ? `Keep ${idea.send.player.name} for ${idea.receive.player.name} on the watchlist; recheck direct projections, injury news, and both teams' usage before sending anything.`
        : `Do not send ${idea.send.player.name} for ${idea.receive.player.name}; the current edge or acceptance case is too weak.`;
    recommendations.push({
      verdict: classification.verdict,
      decisionConfidence: classification.confidence,
      rival: { teamId: idea.rivalTeam.teamId, teamName: idea.rivalTeam.teamName },
      sends: [sendEvidence],
      receives: [receiveEvidence],
      dogsDeltas: idea.dogsDeltas,
      rivalDeltas: idea.rivalDeltas,
      confidence: round(Math.min(cachedPlayerWeekEvidence(idea.send.player, week, projectionRows, cbsRows, context.evidenceCache).confidence ?? 0.4, cachedPlayerWeekEvidence(idea.receive.player, week, projectionRows, cbsRows, context.evidenceCache).confidence ?? 0.4), 2),
      whyRivalAccepts,
      primaryRisk,
      proposal,
      rosterContext: {
        dogs: { beforeSize: dogs.length, afterSize: idea.nextDogs.length, beforeCounts: dogsCounts, afterCounts: nextDogsCounts, outgoingRole: dogsStarterIds.has(idea.send.playerId) ? "STARTER" : "DEPTH" },
        rival: { beforeSize: idea.rival.length, afterSize: idea.nextRival.length, beforeCounts: rivalCounts, afterCounts: nextRivalCounts },
        positionalRisk,
        noFlex: true,
      },
      evidence: { method: "both teams' weekly exact legal optimal lineups; byes included; bench totals excluded; outgoing depth and direct player evidence are audited separately", formatsConsidered: ["automated rail: 1-for-1", "proposal analyzer: multi-player and two- or three-team trades"] },
    });
    if (recommendations.length === 11) break;
  }
  const counts = {
    offer: recommendations.filter((row) => row.verdict === "OFFER").length,
    monitor: recommendations.filter((row) => row.verdict === "MONITOR").length,
    pass: recommendations.filter((row) => row.verdict === "PASS").length,
  };
  const boardSummary = {
    verdict: counts.offer ? "OFFER" : "PASS",
    confidence: counts.offer ? "MEDIUM" : "HIGH",
    headline: counts.offer ? `${counts.offer} trade idea${counts.offer === 1 ? "" : "s"} clears the send-now gate` : "Pass on the current trade board",
    reason: counts.offer
      ? `${counts.offer} idea${counts.offer === 1 ? "" : "s"} provide meaningful, evidence-backed value for Dogs of War and a credible incentive for the other manager.`
      : `No displayed idea currently combines a meaningful Dogs of War gain, complete player evidence, protected no-flex roster depth, and a credible multi-horizon acceptance case. ${counts.monitor} idea${counts.monitor === 1 ? "" : "s"} remain monitor-only.`,
    counts,
  };
  return { recommendations, boardSummary, blockedReason: recommendations.length ? null : "No legal 1-for-1 comparison cleared the minimum model gate." };
}

function tradeImpact(beforeRoster, afterRoster, weeks, context) {
  const before = seriesAverage(beforeRoster, weeks.filter((candidate) => candidate >= context.currentWeek), context).average;
  const after = seriesAverage(afterRoster, weeks.filter((candidate) => candidate >= context.currentWeek), context).average;
  return { before: round(before), after: round(after), delta: before === null || after === null ? null : round(after - before) };
}

export function analyzeTradeProposal({ pack, leagueState, week, fbgSnapshot = null, fantasyProsSnapshot = null, pffSnapshot = null, statusSnapshot = null, transfers = [] }) {
  if (!leagueRostersReady(leagueState)) throw new Error(incompleteRosterMessage(leagueState, "Trade analysis"));
  if (!Array.isArray(transfers) || transfers.length < 2 || transfers.length > 3) throw new Error("Choose two or three outgoing team packages.");
  const playerById = new Map(pack.players.map((player) => [player.id, player]));
  const teamById = new Map((leagueState.teams || []).map((team) => [team.teamId, team]));
  const normalized = transfers.map((transfer) => ({
    fromTeamId: String(transfer?.fromTeamId || ""),
    toTeamId: String(transfer?.toTeamId || ""),
    playerIds: Array.isArray(transfer?.playerIds) ? transfer.playerIds.map(String) : [],
  }));
  const participantIds = new Set(normalized.flatMap((transfer) => [transfer.fromTeamId, transfer.toTeamId]));
  if (participantIds.size < 2 || participantIds.size > 3 || !participantIds.has(USER_TEAM_ID)) throw new Error("The proposal must include Dogs of War and one or two other league teams.");
  if (normalized.some((transfer) => !teamById.has(transfer.fromTeamId) || !teamById.has(transfer.toTeamId) || transfer.fromTeamId === transfer.toTeamId)) throw new Error("Every package must move between distinct current league teams.");
  if (new Set(normalized.map((transfer) => transfer.fromTeamId)).size !== normalized.length) throw new Error("Each participating team can have one outgoing package in this analyzer.");
  if (normalized.some((transfer) => transfer.playerIds.length < 1 || transfer.playerIds.length > 6)) throw new Error("Choose between one and six outgoing players for every participating team.");
  const allMovedIds = normalized.flatMap((transfer) => transfer.playerIds);
  if (new Set(allMovedIds).size !== allMovedIds.length) throw new Error("A player can appear in only one outgoing package.");

  const beforeByTeam = new Map([...participantIds].map((teamId) => [teamId, rosterPlayers(teamById.get(teamId).roster, playerById)]));
  const afterByTeam = new Map([...beforeByTeam].map(([teamId, roster]) => [teamId, [...roster]]));
  for (const transfer of normalized) {
    const fromRoster = afterByTeam.get(transfer.fromTeamId);
    const moved = transfer.playerIds.map((playerId) => {
      const player = fromRoster.find((entry) => entry.playerId === playerId);
      if (!player) throw new Error(`${teamById.get(transfer.fromTeamId).teamName} does not currently roster one of the selected players.`);
      return player;
    });
    afterByTeam.set(transfer.fromTeamId, fromRoster.filter((entry) => !transfer.playerIds.includes(entry.playerId)));
    afterByTeam.get(transfer.toTeamId).push(...moved);
  }
  for (const teamId of participantIds) {
    const roster = afterByTeam.get(teamId);
    if (roster.length < 8 || roster.length > 14) throw new Error(`${teamById.get(teamId).teamName} would have ${roster.length} players; every roster must remain between 8 and 14.`);
    if (!legalStarterPath(roster)) throw new Error(`${teamById.get(teamId).teamName} would no longer have 1 QB, 2 RB, 2 WR, 1 TE, 1 K, and 1 DST.`);
  }

  const projectionRows = projectionRowMaps({ fbgSnapshot, fantasyProsSnapshot, pffSnapshot });
  const context = { playerById, projectionRows, cbsRows: cbsRowMap(leagueState), statuses: statusMap(statusSnapshot), currentWeek: week, evidenceCache: new Map(), lineupCache: new Map() };
  const horizons = {
    week: [week],
    nextThree: weekRange(week, week + 2),
    restOfSeason: weekRange(week, 17),
    division: PRIORITY_WEEKS.division.filter((candidate) => candidate >= week),
    playoffs: PRIORITY_WEEKS.playoffs.filter((candidate) => candidate >= week),
  };
  const teams = [...participantIds].map((teamId) => {
    const team = teamById.get(teamId);
    const sends = normalized.filter((transfer) => transfer.fromTeamId === teamId).flatMap((transfer) => transfer.playerIds.map((playerId) => playerById.get(playerId)));
    const receives = normalized.filter((transfer) => transfer.toTeamId === teamId).flatMap((transfer) => transfer.playerIds.map((playerId) => playerById.get(playerId)));
    const impact = Object.fromEntries(Object.entries(horizons).map(([name, weeks]) => [name, weeks.length ? tradeImpact(beforeByTeam.get(teamId), afterByTeam.get(teamId), weeks, context) : { before: null, after: null, delta: null }]));
    return {
      teamId,
      teamName: team.teamName,
      beforeRosterSize: beforeByTeam.get(teamId).length,
      afterRosterSize: afterByTeam.get(teamId).length,
      sends: sends.map((player) => ({ playerId: player.id, name: player.name, position: player.position, nflTeam: player.nflTeam })),
      receives: receives.map((player) => ({ playerId: player.id, name: player.name, position: player.position, nflTeam: player.nflTeam })),
      impact,
    };
  });
  const dogs = teams.find((team) => team.teamId === USER_TEAM_ID);
  const rivals = teams.filter((team) => team.teamId !== USER_TEAM_ID);
  const dogsRos = dogs.impact.restOfSeason.delta ?? -999;
  const worstRival = Math.min(...rivals.map((team) => team.impact.restOfSeason.delta ?? -999));
  const verdict = dogsRos > 0.5 && worstRival >= -0.35 ? "GOOD IDEA" : dogsRos > 0 && worstRival >= -0.35 ? "POSSIBLE" : dogsRos > 0 ? "UNLIKELY" : "DECLINE";
  const rivalSummary = rivals.map((team) => `${team.teamName} ${team.impact.restOfSeason.delta >= 0 ? "gains" : "loses"} ${Math.abs(team.impact.restOfSeason.delta || 0).toFixed(1)}`).join("; ");
  return {
    verdict,
    summary: `Dogs of War ${dogsRos >= 0 ? "gains" : "loses"} ${Math.abs(dogsRos).toFixed(1)} average optimal-lineup points over the rest of the season; ${rivalSummary}.`,
    teams,
    risks: [
      worstRival < -0.35 ? "At least one other manager gives up too much projected lineup value, so acceptance is unlikely without a different package." : "Every other team stays within the configured rational-acceptance range.",
      "Injuries, role changes, projection disagreement, and manager preferences can change the practical value before acceptance.",
      "This analysis excludes roster salary because salary does not govern in-season trades; keeper salary is reviewed separately late in the season.",
    ],
    method: "Exact legal optimal lineups before and after the complete package; current week, next three, division, playoffs, and rest of season are scored with the available four-source blend.",
  };
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
  const evidenceCache = new Map();
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
        bye: player.weeklyProjection?.byeWeek ?? null,
        severity: status.severity,
        status: status.injuryStatus || status.status || "Status unclear",
        bodyPart: status.injuryBodyPart || "",
        practice: status.practiceParticipation || "",
        notes: status.injuryNotes || "",
        updatedAt: status.newsUpdated || statusSnapshot.capturedAt,
        leagueStatus: available.has(player.id) ? "AVAILABLE" : owner?.teamId === USER_TEAM_ID ? "DOGS OF WAR" : owner?.teamName || (availabilityConfirmed ? "UNRESOLVED" : "UNCONFIRMED"),
        projection: cachedPlayerWeekEvidence(player, week, projectionRows, cbsRows, evidenceCache),
        news: signals.news,
      };
    })
    .filter(Boolean)
    .sort((left, right) => ["critical", "high", "moderate"].indexOf(left.severity) - ["critical", "high", "moderate"].indexOf(right.severity) || (right.projection.points ?? -1) - (left.projection.points ?? -1));

  const irTargets = actionable
    .filter((row) => irEvidence((statusSnapshot?.updates || []).find((status) => status.playerId === row.playerId)))
    .map((row) => {
      const player = playerById.get(row.playerId);
      const ownerRosterEntry = owners.get(player.id)?.roster?.find((entry) => entry.playerId === player.id) || null;
      const remaining = weekRange(week, 17).map((candidateWeek) => cachedPlayerWeekEvidence(player, candidateWeek, projectionRows, cbsRows, evidenceCache).points);
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
        longTermStashAnalysisActive: true,
        keeperCost: keeperEvaluationActive && row.leagueStatus !== "AVAILABLE" ? owners.get(player.id)?.roster?.find((entry) => entry.playerId === player.id)?.salary ?? null : null,
        currentSalary: ownerRosterEntry?.salary ?? null,
        contractYear: ownerRosterEntry?.contractYear ?? null,
        acquisitionSalaryEvidence: row.leagueStatus === "AVAILABLE"
          ? { known: false, minimumPossible: 1, basis: "A winning blind FAB bid becomes the player's salary; the winning price is unknown before waivers process." }
          : { known: ownerRosterEntry?.salary != null, recordedSalary: ownerRosterEntry?.salary ?? null, basis: ownerRosterEntry?.salary != null ? "Captured CBS roster salary." : "No roster salary was captured." },
        returnOutlook: "Return date is not inferred. Confirm the official NFL/CBS eligibility window and practice activation before using a roster spot.",
        reason: row.leagueStatus === "AVAILABLE"
          ? `${player.name}'s governed healthy projection and ${keeperUpside.toLowerCase()} long-term upside merit monitoring. A winning FAB bid would become the player's keeper salary, but the price is unknown until waivers process.`
          : `${player.name}'s governed healthy projection and ${keeperUpside.toLowerCase()} long-term upside merit monitoring. The recorded roster salary may be used only by the explicit long-term stash analysis; it remains excluded from ordinary waiver and trade value.`,
      };
    })
    .sort((left, right) => (right.healthyRosAverage ?? -1) - (left.healthyRosAverage ?? -1) || right.preInjuryVbd - left.preInjuryVbd)
    .slice(0, 30);
  return { injuries: actionable.slice(0, 30), irTargets };
}

function buildPlayerStats({ pack, leagueState, week, projectionRows, cbsRows, statuses }) {
  const owners = teamOwnership(leagueState);
  const confirmedAvailable = new Set(leagueRostersReady(leagueState) ? leagueState.availablePlayerIds || [] : []);
  const evidenceCache = new Map();
  return pack.players.map((player) => {
    const projection = cachedPlayerWeekEvidence(player, week, projectionRows, cbsRows, evidenceCache);
    const owner = owners.get(player.id) || null;
    const ownerRosterEntry = owner?.roster?.find((entry) => entry.playerId === player.id) || null;
    const currentCbs = cbsRows.get(`${player.id}|${week}`) || null;
    const status = statuses.get(player.id) || null;
    const nextThreeAverage = average(weekRange(week, week + 2).map((candidateWeek) => cachedPlayerWeekEvidence(player, candidateWeek, projectionRows, cbsRows, evidenceCache).points));
    const divisionAverage = average(PRIORITY_WEEKS.division.filter((candidateWeek) => candidateWeek >= week).map((candidateWeek) => cachedPlayerWeekEvidence(player, candidateWeek, projectionRows, cbsRows, evidenceCache).points));
    const playoffAverage = average(PRIORITY_WEEKS.playoffs.filter((candidateWeek) => candidateWeek >= week).map((candidateWeek) => cachedPlayerWeekEvidence(player, candidateWeek, projectionRows, cbsRows, evidenceCache).points));
    const restOfSeasonAverage = average(weekRange(week, 17).map((candidateWeek) => cachedPlayerWeekEvidence(player, candidateWeek, projectionRows, cbsRows, evidenceCache).points));
    const leagueStatus = owner?.teamId === USER_TEAM_ID
      ? "DOGS OF WAR"
      : owner?.teamName || (confirmedAvailable.has(player.id) ? "FREE AGENT" : "UNCONFIRMED");
    return {
      playerId: player.id,
      name: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      opponent: currentCbs?.opponent || null,
      gameTime: currentCbs?.gameTime || null,
      kickoffAt: currentCbs?.gameTime ? kickoffAt(currentCbs.gameTime, week, pack.season) : null,
      bye: player.weeklyProjection?.byeWeek ?? null,
      leagueStatus,
      ownerTeamId: owner?.teamId || null,
      ownerTeamName: owner?.teamName || null,
      currentSalary: ownerRosterEntry?.salary ?? null,
      contractYear: ownerRosterEntry?.contractYear ?? null,
      injury: status ? { severity: status.severity, status: status.injuryStatus || status.status || "", bodyPart: status.injuryBodyPart || "", practice: status.practiceParticipation || "" } : null,
      points: projection.points,
      floor: projection.floor,
      ceiling: projection.ceiling,
      confidence: projection.confidence,
      sourceCount: projection.sources.length,
      sources: projection.sources,
      directSourceCount: projection.sources.filter((source) => source.basis === "DIRECT_WEEKLY").length,
      sourceNames: projection.sources.map((source) => source.source),
      nextThreeAverage: round(nextThreeAverage),
      divisionAverage: round(divisionAverage),
      playoffAverage: round(playoffAverage),
      restOfSeasonAverage: round(restOfSeasonAverage),
      projectedStats: blendProjectedStats(projection),
    };
  }).filter((row) => row.points !== null || row.restOfSeasonAverage !== null || row.leagueStatus !== "UNCONFIRMED");
}

function buildPublicLeague(pack, leagueState, week, projectionRows, cbsRows) {
  const playerById = new Map(pack.players.map((player) => [player.id, player]));
  return {
    userTeamId: USER_TEAM_ID,
    teams: (leagueState.teams || []).map((team) => ({
      teamId: team.teamId,
      teamName: team.teamName,
      roster: (team.roster || []).map((entry) => {
        const player = playerById.get(entry.playerId);
        const projection = player ? playerWeekEvidence(player, week, projectionRows, cbsRows) : null;
        return {
          playerId: entry.playerId,
          name: player?.name || entry.name,
          position: player?.position || entry.position,
          nflTeam: player?.nflTeam || entry.nflTeam || null,
          bye: player?.weeklyProjection?.byeWeek ?? entry.bye ?? null,
          points: projection?.points ?? null,
        };
      }),
    })),
  };
}

function buildScoringPreview({ pack, leagueState, week, projectionRows, cbsRows, statuses, selectedTeamId = USER_TEAM_ID }) {
  const captured = leagueState.scoringPreview || null;
  const unavailable = (errors) => ({
    status: captured?.status || "UNAVAILABLE",
    week,
    asOf: captured?.capturedAt || null,
    source: captured?.source || null,
    pageUrl: captured?.pageUrl || null,
    teams: [],
    errors,
    authorityNote: "CBS determines which players are submitted as starters or reserves. Thunder Bowl component-stat projections and league scoring determine the points shown here.",
  });
  const selectedTeam = rosterTeam(leagueState, selectedTeamId);
  const opponent = scheduleOpponent(leagueState, selectedTeamId, week);
  if (!selectedTeam) return unavailable(["The selected team is not present in the current CBS roster data."]);
  if (!opponent || opponent.allPlay || !opponent.teamId) return unavailable([opponent?.allPlay ? `Week ${week} is an all-play week, so there is no single head-to-head matchup.` : `No Week ${week} opponent is stored for ${selectedTeam.teamName}.`]);
  const opponentTeam = rosterTeam(leagueState, opponent.teamId);
  if (!opponentTeam) return unavailable(["The scheduled opponent is not present in the current CBS roster data."]);
  const playerById = new Map(pack.players.map((player) => [player.id, player]));
  const lineupDetails = new Map((leagueState.teams || []).flatMap((team) => (team.roster || []).map((row) => [row.playerId, row])));
  const publicRow = (row, team) => {
    const player = playerById.get(row.playerId);
    const roster = lineupDetails.get(row.playerId) || {};
    const cbs = cbsRows.get(`${row.playerId}|${week}`) || null;
    if (!player) return null;
    return lineupPublicRow({
      ...roster,
      playerId: row.playerId,
      player,
      projection: playerWeekEvidence(player, week, projectionRows, cbsRows),
      status: statuses.get(row.playerId) || null,
      opponent: cbs?.opponent ?? roster.opponent ?? null,
      gameTime: cbs?.gameTime ?? roster.gameTime ?? null,
      bye: roster.bye ?? player.weeklyProjection?.byeWeek ?? null,
    }, { includeGameDetails: leagueState.projectionWeek === week, adviceTeamId: team.teamId, adviceTeamName: team.teamName, week, season: pack.season });
  };
  const capturedTeams = new Map(captured?.week === week && captured?.status === "COMPLETE" ? captured.teams.map((team) => [team.teamId, team]) : []);
  const buildTeam = (team) => {
    const capturedTeam = capturedTeams.get(team.teamId);
    const optimized = capturedTeam ? null : optimizeExactLineup(team.roster, { week, playerById, projectionRows, cbsRows, statuses });
    const starters = capturedTeam
      ? capturedTeam.starters.map((row) => publicRow(row, team)).filter(Boolean)
      : optimized.starters.map((entry) => publicRow(entry, team)).filter(Boolean);
    const bench = capturedTeam
      ? capturedTeam.bench.map((row) => publicRow(row, team)).filter(Boolean)
      : optimized.bench.map((entry) => publicRow(entry, team)).filter(Boolean);
    const total = starters.length === 8 && starters.every((row) => Number.isFinite(row.points))
      ? round(starters.reduce((sum, row) => sum + row.points, 0))
      : null;
    return { teamId: team.teamId, teamName: team.teamName, total, starters, bench, submitted: Boolean(capturedTeam), lineupBasis: capturedTeam ? "CBS_SUBMITTED" : "PROJECTED_FROM_CBS_ROSTER" };
  };
  const teams = [buildTeam(selectedTeam), buildTeam(opponentTeam)];
  const [left, right] = teams;
  const margin = Number.isFinite(left?.total) && Number.isFinite(right?.total) ? round(left.total - right.total) : null;
  const absoluteMargin = Number.isFinite(margin) ? Math.abs(margin) : null;
  const edge = absoluteMargin === null ? "UNAVAILABLE" : absoluteMargin < 2 ? "EVEN" : absoluteMargin < 6 ? "SLIGHT" : absoluteMargin < 12 ? "MODERATE" : "STRONG";
  const allSubmitted = teams.every((team) => team.submitted);
  return {
    status: "COMPLETE",
    week,
    asOf: captured?.capturedAt || leagueState.capturedAt || null,
    source: allSubmitted ? captured.source : leagueState.source,
    pageUrl: allSubmitted ? captured.pageUrl : null,
    teams,
    selectedTeamId: left.teamId,
    opponentTeamId: right.teamId,
    projectedMargin: margin,
    favoriteTeamId: margin === null || margin === 0 ? null : margin > 0 ? left.teamId : right.teamId,
    edge,
    errors: [],
    authorityNote: allSubmitted
      ? "CBS determines the submitted starters and reserves; both lineups were captured from CBS. Thunder Bowl component-stat projections and league scoring determine the points shown here."
      : "This matchup uses the latest CBS rosters and projected exact legal lineups. Any team not marked CBS submitted is an optimized preview—not confirmation of the lineup saved at CBS. Thunder Bowl component-stat projections and league scoring determine the points shown here.",
  };
}

function sourceChip(label, timestamp, now, required = false) {
  return { label, asOf: timestamp || null, ageMinutes: ageMinutes(timestamp, now), required };
}

function startSitDecision(edgeStarter, bench, week) {
  const delta = round(edgeStarter.projection.points - bench.projection.points);
  const sourceDisagreement = round(Math.max(edgeStarter.projection.spread || 0, bench.projection.spread || 0));
  const materialityThreshold = 1;
  const strongThreshold = 2;
  const highDisagreement = sourceDisagreement > Math.max(strongThreshold, delta * 1.5);
  const strength = delta < materialityThreshold
    ? "TOSS-UP"
    : delta < strongThreshold || highDisagreement
      ? "LEAN"
      : "STRONG";
  const starterTime = Date.parse(edgeStarter.gameTime || "");
  const benchTime = Date.parse(bench.gameTime || "");
  const timingRisk = strength !== "STRONG" && Number.isFinite(starterTime) && Number.isFinite(benchTime) && starterTime < benchTime
    ? `${edgeStarter.player.name} plays earlier than ${bench.player.name}, so starting ${edgeStarter.player.name} reduces later lineup flexibility.`
    : null;
  const starterInjury = edgeStarter.status ? {
    severity: edgeStarter.status.severity,
    status: edgeStarter.status.injuryStatus || edgeStarter.status.status || "",
    bodyPart: edgeStarter.status.injuryBodyPart || "",
    practice: edgeStarter.status.practiceParticipation || "",
    updatedAt: edgeStarter.status.newsUpdated,
  } : null;
  const rangesOverlap = Number.isFinite(edgeStarter.projection.floor)
    && Number.isFinite(edgeStarter.projection.ceiling)
    && Number.isFinite(bench.projection.floor)
    && Number.isFinite(bench.projection.ceiling)
    && edgeStarter.projection.floor <= bench.projection.ceiling
    && bench.projection.floor <= edgeStarter.projection.ceiling;
  const reason = strength === "TOSS-UP"
    ? `${delta.toFixed(1)} points is below the ${materialityThreshold.toFixed(1)}-point materiality gate, so the optimizer's choice is acceptable but not a dependable edge.`
    : strength === "LEAN"
      ? `${delta.toFixed(1)} points supports a modest lean, but it does not clear the strong-call gate${highDisagreement ? " after accounting for provider disagreement" : ""}.`
      : `${delta.toFixed(1)} points clears the ${strongThreshold.toFixed(1)}-point strong-call gate.`;
  return {
    start: edgeStarter.player.name,
    sit: bench.player.name,
    startPlayerId: edgeStarter.playerId,
    sitPlayerId: bench.playerId,
    position: bench.player.position,
    delta,
    verdict: strength === "TOSS-UP" ? "PASS" : "START",
    strength,
    actionable: strength !== "TOSS-UP",
    confidence: round(Math.min(edgeStarter.projection.confidence ?? 0.4, bench.projection.confidence ?? 0.4), 2),
    materialityThreshold,
    strongThreshold,
    sourceDisagreement,
    rangesOverlap,
    starterInjury,
    timingRisk,
    reason,
  };
}

function starterMonitor(entry, week, options = {}) {
  if (!entry.status) return null;
  const status = entry.status.injuryStatus || entry.status.status || "";
  if (!status || /^active$/i.test(status)) return null;
  return {
    ...lineupPublicRow(entry, options),
    action: "MONITOR",
    reason: `${entry.player.name} remains the projection-based starter, but the ${status} designation must be rechecked before the Week ${week} lineup locks. Keep the current starter unless later evidence worsens the status.`,
  };
}

function sourceState({ leagueState, pack, week, currentWeek = week, fbgSnapshot, fantasyProsSnapshot, pffSnapshot, researchSnapshot, statusSnapshot, now }) {
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
  if (leagueState.authority.startsWith("authenticated") && !leagueState.leagueSchedule) alerts.push("The CBS league matchup schedule has not been captured. Install the current Thunder Bowl Data Helper, reload this page, and choose Update CBS.");
  if (week === currentWeek && leagueState.authority.startsWith("authenticated") && !leagueState.scoringPreview) alerts.push("The CBS submitted starters and reserves have not been captured. Install the current Thunder Bowl Data Helper, reload this page, and choose Update CBS.");
  else if (week === currentWeek && leagueState.scoringPreview?.status === "PARTIAL") alerts.push(`The CBS scoring preview is incomplete: ${leagueState.scoringPreview.errors?.[0] || "both submitted lineups did not reconcile safely"}`);
  if (leagueState.authority.startsWith("authenticated") && !rostersReady) alerts.push(incompleteRosterMessage(leagueState, "Waiver and trade advice"));
  if (leagueState.authority.startsWith("authenticated") && !cbsProjectionReady) alerts.push(week === currentWeek
    ? `CBS Week ${week} component-stat projections have not been captured yet. Keep the current Data Helper and choose Update CBS or Update everything; existing lineup and availability evidence remains usable but the plan stays PARTIAL.`
    : `Week ${week} is an early outlook. Direct CBS Week ${week} component-stat projections are not captured yet, so the schedule-shaped baseline is used until providers publish and the week becomes current.`);
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
  currentWeek = week,
  fbgSnapshot = null,
  fantasyProsSnapshot = null,
  pffSnapshot = null,
  researchSnapshot = null,
  statusSnapshot = null,
  leagueMoves = [],
  generatedAt = new Date().toISOString(),
  lineupTeamId = USER_TEAM_ID,
}) {
  const isForecast = week > currentWeek;
  const playerById = new Map(pack.players.map((player) => [player.id, player]));
  const projectionRows = projectionRowMaps({ fbgSnapshot, fantasyProsSnapshot, pffSnapshot, allowSeasonShapes: isForecast });
  const cbsRows = cbsRowMap(leagueState);
  const statuses = statusMap(statusSnapshot);
  const lineupTeam = rosterTeam(leagueState, lineupTeamId);
  if (!lineupTeam) throw new Error(`The requested lineup team '${lineupTeamId}' is not present in the CBS league state.`);
  const optimized = optimizeExactLineup(lineupTeam.roster, { week, playerById, projectionRows, cbsRows, statuses });
  const lineupOpponent = scheduleOpponent(leagueState, lineupTeamId, week);
  const userOpponent = scheduleOpponent(leagueState, USER_TEAM_ID, week);
  const lineupRowOptions = { includeGameDetails: leagueState.projectionWeek === week, adviceTeamId: lineupTeam.teamId, adviceTeamName: lineupTeam.teamName, week, season: pack.season };
  const starterIds = new Set(optimized.starters.map((entry) => entry.playerId));
  const confirmedAvailable = new Set(leagueRostersReady(leagueState) ? leagueState.availablePlayerIds || [] : []);
  const freeAgentEvidenceCache = new Map();
  const betterFreeAgents = pack.players
    .filter((player) => confirmedAvailable.has(player.id))
    .map((player) => {
      const cbs = cbsRows.get(`${player.id}|${week}`) || null;
      return {
        playerId: player.id,
        player,
        projection: cachedPlayerWeekEvidence(player, week, projectionRows, cbsRows, freeAgentEvidenceCache),
        status: statuses.get(player.id) || null,
        opponent: cbs?.opponent || null,
        gameTime: cbs?.gameTime || null,
        bye: player.weeklyProjection?.byeWeek ?? null,
      };
    })
    .filter((entry) => entry.projection.points !== null && !criticalStatus(entry.status));
  const swaps = optimized.bench
    .filter((bench) => bench.projection.points !== null && !criticalStatus(bench.status))
    .map((bench) => {
      const positionStarters = optimized.starters.filter((starter) => starter.player.position === bench.player.position);
      const edgeStarter = positionStarters.sort((left, right) => left.projection.points - right.projection.points)[0];
      return edgeStarter ? startSitDecision(edgeStarter, bench, week) : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.delta - right.delta)
    .slice(0, 6);
  const includeGameDetails = leagueState.projectionWeek === week;
  const freeAgentAlternatives = Object.fromEntries(optimized.starters.map((starter) => [starter.playerId, betterFreeAgents
    .filter((entry) => entry.player.position === starter.player.position && entry.projection.points > starter.projection.points)
    .sort((left, right) => right.projection.points - left.projection.points || left.player.name.localeCompare(right.player.name))
    .slice(0, 5)
    .map((entry) => ({
      ...lineupPublicRow(entry, lineupRowOptions),
      leagueStatus: "FREE AGENT",
      starterPlayerId: starter.playerId,
      starterName: starter.player.name,
      starterPoints: starter.projection.points,
      delta: round(entry.projection.points - starter.projection.points),
    }))]));
  const monitors = optimized.starters.map((entry) => starterMonitor(entry, week, lineupRowOptions)).filter(Boolean);
  const decisionCounts = {
    strong: swaps.filter((row) => row.strength === "STRONG").length,
    lean: swaps.filter((row) => row.strength === "LEAN").length,
    tossUp: swaps.filter((row) => row.strength === "TOSS-UP").length,
    monitors: monitors.length,
  };
  const decisionSummary = {
    verdict: optimized.missingSlots.length ? "INCOMPLETE" : "KEEP",
    headline: optimized.missingSlots.length
      ? "A complete legal lineup is not available"
      : isForecast
        ? `${lineupTeam.teamName}'s projected Week ${week} lineup`
        : lineupTeamId === USER_TEAM_ID ? `Keep the current Week ${week} lineup` : `Review ${lineupTeam.teamName}'s Week ${week} lineup`,
    reason: optimized.missingSlots.length
      ? `The roster is missing ${optimized.missingSlots.join(", ")} coverage.`
      : `${decisionCounts.strong} strong start call${decisionCounts.strong === 1 ? "" : "s"}, ${decisionCounts.lean} modest lean${decisionCounts.lean === 1 ? "" : "s"}, and ${decisionCounts.tossUp} toss-up${decisionCounts.tossUp === 1 ? "" : "s"} are registered. Toss-ups are preferences, not directives.${decisionCounts.monitors ? ` ${decisionCounts.monitors} starter status check${decisionCounts.monitors === 1 ? "" : "s"} remain before lock.` : ""}`,
    counts: decisionCounts,
  };
  const waiver = recommendWaivers({ pack, leagueState, week, fbgSnapshot, fantasyProsSnapshot, pffSnapshot, statusSnapshot, researchSnapshot, leagueMoves });
  const trades = recommendTrades({ pack, leagueState, week, fbgSnapshot, fantasyProsSnapshot, pffSnapshot, statusSnapshot, researchSnapshot });
  const watch = buildInjuryWatch({ pack, leagueState, week, statusSnapshot, researchSnapshot, fbgSnapshot, fantasyProsSnapshot, pffSnapshot });
  const playerStats = buildPlayerStats({ pack, leagueState, week, projectionRows, cbsRows, statuses });
  const league = buildPublicLeague(pack, leagueState, week, projectionRows, cbsRows);
  const scoringPreview = buildScoringPreview({ pack, leagueState, week, projectionRows, cbsRows, statuses, selectedTeamId: lineupTeamId });
  const freshness = sourceState({ leagueState, pack, week, currentWeek, fbgSnapshot, fantasyProsSnapshot, pffSnapshot, researchSnapshot, statusSnapshot, now: generatedAt });
  const directProjectionSources = [
    includeGameDetails && (leagueState.projectionCount ?? leagueState.weeklyProjections?.length ?? 0) >= 100 ? "CBS" : null,
    fbgSnapshot ? "Footballguys" : null,
    fantasyProsSnapshot ? "FantasyPros" : null,
    pffSnapshot ? "PFF" : null,
  ].filter(Boolean);
  return {
    schemaVersion: 1,
    kind: "thunder-bowl-season-recommendations",
    season: pack.season,
    week,
    generatedAt,
    state: freshness.state,
    sourceAudit: sourceAudit({ leagueState, fbgSnapshot, fantasyProsSnapshot, pffSnapshot, week, now: generatedAt }),
    viewing: {
      currentWeek,
      selectedWeek: week,
      mode: isForecast ? "FORECAST" : "CURRENT",
      maxSelectableWeek: Math.min(18, currentWeek + 2),
      directProjectionSources,
      baselineAsOf: pack.weeklyContext?.asOf || pack.asOf,
      selectedTeamId: lineupTeam.teamId,
      selectedTeamName: lineupTeam.teamName,
      opponentTeamId: lineupOpponent?.teamId || null,
      opponentTeamName: lineupOpponent?.teamName || null,
      userOpponentTeamId: userOpponent?.teamId || null,
      userOpponentTeamName: userOpponent?.teamName || null,
      scheduleAsOf: leagueState.leagueSchedule?.capturedAt || null,
    },
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
      scheduleCapturedAt: leagueState.leagueSchedule?.capturedAt || null,
      scheduleMatchups: leagueState.leagueSchedule?.matchupCount || 0,
      scoringPreviewStatus: leagueState.scoringPreview?.status || "UNAVAILABLE",
      scoringPreviewCapturedAt: leagueState.scoringPreview?.capturedAt || null,
      // Backward-compatible aliases for older clients.
      rosterTarget: leagueState.rosterMaximum ?? leagueState.rosterTarget ?? 14,
      completeTeamCount: leagueState.legalTeamCount ?? leagueState.completeTeamCount ?? null,
      rostersComplete: leagueRostersReady(leagueState),
    },
    lineup: {
      teamId: lineupTeam.teamId,
      teamName: lineupTeam.teamName,
      opponent: lineupOpponent,
      legal: optimized.missingSlots.length === 0 && starterIds.size === 8,
      total: optimized.total,
      requiredSlots: { ...STARTER_REQUIREMENTS },
      missingSlots: optimized.missingSlots,
      starters: optimized.starters.map((entry) => lineupPublicRow(entry, lineupRowOptions)),
      bench: optimized.bench.map((entry) => lineupPublicRow(entry, lineupRowOptions)),
      freeAgentAlternatives,
      swaps,
      monitors,
      decisionSummary,
    },
    waivers: waiver,
    trades,
    watch: { ...watch, leagueMoves: leagueMoves.slice(0, 50) },
    playerStats,
    scoringPreview,
    league,
    schedule: {
      source: leagueState.leagueSchedule?.source || null,
      asOf: leagueState.leagueSchedule?.capturedAt || null,
      userTeamId: USER_TEAM_ID,
      userTeam: teamSchedule(leagueState, USER_TEAM_ID),
      selectedTeamId: lineupTeam.teamId,
      selectedTeam: teamSchedule(leagueState, lineupTeam.teamId),
      matchups: (leagueState.leagueSchedule?.matchups || [])
        .filter((row) => row.week === week)
        .map((row) => ({ week: row.week, teamAId: row.teamAId, teamAName: row.teamAName, teamBId: row.teamBId, teamBName: row.teamBName })),
    },
    model: {
      deterministic: true,
      monteCarlo: false,
      seed: null,
      missingPolicy: "missing is excluded, never zero",
      contextPolicy: "news, injury, depth, matchup, weather, travel, and venue are evidence-only unless a time-forward gate earns authority",
      salaryPolicy: `roster salary and contract data are excluded from lineup, player ranking, ordinary waiver value, and current-season trade value; the separately captured $50 FAB balance is used to size blind-auction bids; salary is considered in the explicit long-term Stash Watch analysis in every week and in the formal Week ${KEEPER_EVALUATION_START_WEEK}+ keeper review`,
    },
  };
}
