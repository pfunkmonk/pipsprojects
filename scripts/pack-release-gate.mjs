import { createHash } from "node:crypto";
import { validateDraftPack } from "../public/thunder-bowl/state-engine.mjs";

const SEALED_HOLDOUT_PATTERN = /(?:2025.{0,24}(?:actual|outcome|final)|(?:actual|outcome|final).{0,24}2025)/i;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableText(value) {
  return JSON.stringify(stable(value));
}

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableText(value)).digest("hex");
}

function totalCap(pack) {
  return pack.leagueConfig.teams.reduce((sum, team) => sum + team.startingCap, 0);
}

const VERIFIED_2026_ORDER = [
  "orange-crush", "the-hobbits", "crime-and-punishment", "t-dogs",
  "super-suckers", "angry-face", "goon-skwad", "dogs-of-war",
  "el-guapo", "the-bungles", "big-head", "three-amigos",
];

function isEvidenceBackedFinalStandingsUpdate(current, candidate) {
  const hasEvidence = candidate.sources.some((source) =>
    source.name === "User-confirmed prior-season league order and 2026 bonus caps"
    && /configuration only; no player value effect/i.test(source.authority),
  );
  if (!hasEvidence) return false;
  const nextConfig = candidate.leagueConfig;
  if (nextConfig.nominationOrderStatus !== "verified" || nextConfig.verifiedPrefixCount !== 12) return false;
  if (stableText(nextConfig.nominationOrder) !== stableText(VERIFIED_2026_ORDER)) return false;
  const currentElGuapo = current.leagueConfig.teams.find((team) => team.id === "el-guapo");
  const nextElGuapo = nextConfig.teams.find((team) => team.id === "el-guapo");
  if (!currentElGuapo || !nextElGuapo || currentElGuapo.capStatus !== "provisional" || nextElGuapo.capStatus !== "confirmed") return false;
  if (currentElGuapo.startingCap !== 102 || nextElGuapo.startingCap !== 102) return false;
  const normalizedNext = {
    ...nextConfig,
    nominationOrder: current.leagueConfig.nominationOrder,
    nominationOrderStatus: current.leagueConfig.nominationOrderStatus,
    verifiedPrefixCount: current.leagueConfig.verifiedPrefixCount,
    teams: nextConfig.teams.map((team) => team.id === "el-guapo" ? { ...team, capStatus: currentElGuapo.capStatus } : team),
  };
  return stableText(normalizedNext) === stableText(current.leagueConfig);
}

function allocatedMarketDollars(pack) {
  const slots = pack.leagueConfig.teams.length * pack.leagueConfig.rosterSize;
  return pack.players
    .map((player) => player.marketValue)
    .sort((left, right) => right - left)
    .slice(0, slots)
    .reduce((sum, value) => sum + value, 0);
}

function playerMap(pack) {
  return new Map(pack.players.map((player) => [player.id, player]));
}

function materialPlayerChanges(current, candidate) {
  const oldPlayers = playerMap(current);
  const nextPlayers = playerMap(candidate);
  const added = [...nextPlayers.keys()].filter((id) => !oldPlayers.has(id));
  const removed = [...oldPlayers.keys()].filter((id) => !nextPlayers.has(id));
  const moved = [];
  for (const [id, next] of nextPlayers) {
    const prior = oldPlayers.get(id);
    if (!prior) continue;
    const projectionDelta = Number((next.projectedPoints - prior.projectedPoints).toFixed(1));
    const marketDelta = next.marketValue - prior.marketValue;
    const maxBidDelta = next.maxBid - prior.maxBid;
    if (Math.abs(projectionDelta) >= 20 || Math.abs(marketDelta) >= 3 || Math.abs(maxBidDelta) >= 3) {
      moved.push({
        playerId: id,
        name: next.name,
        position: next.position,
        projectionDelta,
        marketDelta,
        maxBidDelta,
      });
    }
  }
  moved.sort((left, right) => Math.abs(right.marketDelta) - Math.abs(left.marketDelta) || Math.abs(right.projectionDelta) - Math.abs(left.projectionDelta));
  return { added, removed, material: moved };
}

function exactStrategyChanges(current, candidate) {
  const fields = ["projectedPoints", "vbd", "intrinsicValue", "marketValue", "maxBid"];
  const oldPlayers = playerMap(current);
  const changes = [];
  for (const player of candidate.players) {
    const prior = oldPlayers.get(player.id);
    if (!prior) continue;
    const changedFields = fields.filter((field) => player[field] !== prior[field]);
    if (changedFields.length) changes.push({ playerId: player.id, name: player.name, changedFields });
  }
  return changes;
}

function declaredPrimaryProjectionSource(candidate) {
  const declared = candidate.sources.filter((source) => source.authority === "primary projection; Thunder Bowl computes value");
  if (declared.length !== 1) return null;
  const sourceName = declared[0].name;
  const everyPlayerUsesSource = candidate.players.every((player) => {
    const primary = (player.projectionSources || []).filter((source) => source.modelEffect === "primary_projection");
    return primary.length === 1
      && primary[0].source === sourceName
      && Math.abs(primary[0].points - player.projectedPoints) <= 0.11;
  });
  return everyPlayerUsesSource ? sourceName : null;
}

function primaryProjectionChanged(candidate, current, sourceName) {
  if (!sourceName) return false;
  if (!current) return true;
  const currentSourceName = declaredPrimaryProjectionSource(current);
  if (currentSourceName !== sourceName) return true;
  const candidateSource = candidate.sources.find((source) => source.name === sourceName);
  const currentSource = current.sources.find((source) => source.name === sourceName);
  if (stableText(candidateSource) !== stableText(currentSource)) return true;
  const currentPlayers = playerMap(current);
  return candidate.players.some((player) => {
    const prior = currentPlayers.get(player.id);
    if (!prior || player.projectedPoints !== prior.projectedPoints) return true;
    const nextPrimary = (player.projectionSources || []).find((source) => source.modelEffect === "primary_projection");
    const priorPrimary = (prior.projectionSources || []).find((source) => source.modelEffect === "primary_projection");
    return stableText(nextPrimary) !== stableText(priorPrimary);
  });
}

function classicChampionIssues(candidate, current) {
  const issues = [];
  const teamCount = candidate.leagueConfig.teams.length;
  const slots = teamCount * candidate.leagueConfig.rosterSize;
  const cap = totalCap(candidate);
  const rows = candidate.players.map((player) => ({
    id: player.id,
    position: player.position,
    points: player.projectedPoints,
    player,
  }));
  const replacement = new Map();
  for (const [position, starters] of Object.entries(candidate.leagueConfig.starterRequirements)) {
    const group = rows.filter((row) => row.position === position).sort((left, right) => right.points - left.points || left.id.localeCompare(right.id));
    const rank = Math.min(group.length, teamCount * starters);
    replacement.set(position, group[Math.max(0, rank - 1)]?.points ?? 0);
  }
  const valued = rows.map((row) => {
    const rawVbd = row.points - replacement.get(row.position);
    return { ...row, rawVbd, positiveVbd: Math.max(0, rawVbd) };
  });
  const vbdRanked = [...valued].sort((left, right) => right.positiveVbd - left.positiveVbd || left.id.localeCompare(right.id));
  const purchasable = vbdRanked.slice(0, slots);
  const totalPositiveVbd = purchasable.reduce((sum, row) => sum + row.positiveVbd, 0);
  const discretionary = cap - slots;
  const exact = purchasable.map((row) => ({
    ...row,
    exactValue: 1 + (totalPositiveVbd ? discretionary * row.positiveVbd / totalPositiveVbd : 0),
  }));
  const intrinsicById = new Map(candidate.players.map((player) => [player.id, 1]));
  const rounded = exact.map((row) => Math.floor(row.exactValue));
  const remainderOrder = exact.map((row, index) => ({ row, index }))
    .sort((left, right) =>
      (right.row.exactValue - Math.floor(right.row.exactValue)) - (left.row.exactValue - Math.floor(left.row.exactValue))
      || left.row.id.localeCompare(right.row.id));
  for (const { index } of remainderOrder.slice(0, cap - rounded.reduce((sum, value) => sum + value, 0))) rounded[index] += 1;
  exact.forEach((row, index) => intrinsicById.set(row.id, rounded[index]));

  const currentMarketCurves = {};
  for (const position of Object.keys(candidate.leagueConfig.starterRequirements)) {
    currentMarketCurves[position] = current.players
      .filter((player) => player.position === position && player.marketValue > 0)
      .map((player) => player.marketValue)
      .sort((left, right) => right - left)
      .slice(0, candidate.players.filter((player) => player.position === position && player.marketValue > 0).length);
  }
  const marketById = new Map(candidate.players.map((player) => [player.id, 1]));
  for (const [position, curve] of Object.entries(currentMarketCurves)) {
    const positionRows = valued.filter((row) => row.position === position)
      .sort((left, right) => right.rawVbd - left.rawVbd || left.id.localeCompare(right.id));
    positionRows.slice(0, curve.length).forEach((row, index) => marketById.set(row.id, curve[index]));
  }

  for (const row of valued) {
    const expectedVbd = Number(row.rawVbd.toFixed(1));
    if (Math.abs(row.player.vbd - expectedVbd) > 0.01) issues.push(`${row.player.name} has non-champion VBD.`);
    if (row.player.intrinsicValue !== intrinsicById.get(row.id)) issues.push(`${row.player.name} has non-champion intrinsic dollars.`);
    if (row.player.marketValue !== marketById.get(row.id) || row.player.maxBid !== marketById.get(row.id)) {
      issues.push(`${row.player.name} has a market/max-bid value outside the frozen curve.`);
    }
    if (issues.length >= 10) break;
  }
  const candidateKeepers = new Map(candidate.keeperCandidates.map((keeper) => [keeper.playerId, keeper]));
  for (const prior of current.keeperCandidates) {
    const keeper = candidateKeepers.get(prior.playerId);
    if (!keeper) {
      issues.push(`${prior.playerName} disappeared from keeper evidence.`);
      continue;
    }
    const staticFields = ["playerName", "position", "teamId", "priorSalary", "keeperSalary", "keeperYear", "evidenceStatus"];
    if (staticFields.some((field) => keeper[field] !== prior[field])) issues.push(`${prior.playerName} changed non-value keeper evidence.`);
    const expectedMarket = marketById.get(prior.playerId);
    const expectedSurplus = prior.keeperYear <= 3 ? expectedMarket - prior.keeperSalary : 0;
    if (keeper.marketValue !== expectedMarket || keeper.surplus !== expectedSurplus) issues.push(`${prior.playerName} has unreconciled keeper value.`);
    if (issues.length >= 10) break;
  }
  return issues;
}

export function auditDraftPack(candidateInput, currentInput = null) {
  const candidate = validateDraftPack(candidateInput);
  const current = currentInput ? validateDraftPack(currentInput) : null;
  const blockingIssues = [];
  const warnings = [];
  const expectedCap = totalCap(candidate);
  const allocated = allocatedMarketDollars(candidate);
  const candidatePlayerIds = new Set(candidate.players.map((player) => player.id));
  const keeperTeams = new Set(candidate.keeperCandidates.map((keeper) => keeper.teamId));
  const sourceText = candidate.sources.map((source) => `${source.name} ${source.authority}`).join(" | ");
  const supplementalProjectionSources = candidate.sources.filter((source) => /supplemental projection/i.test(source.authority));
  const primaryProjectionSource = declaredPrimaryProjectionSource(candidate);
  const declaredPrimarySources = candidate.sources.filter((source) => source.authority === "primary projection; Thunder Bowl computes value");
  const primaryProjectionUpdate = primaryProjectionChanged(candidate, current, primaryProjectionSource);
  const managerAdvisorySources = candidate.sources.filter((source) => /manager.*profile|advisory/i.test(`${source.name} ${source.authority}`));
  const scheduleEvidenceSources = candidate.sources.filter((source) => /Thunder Bowl 2026 schedule/i.test(source.name));
  const weeklyContextSources = candidate.sources.filter((source) => source.name === "Thunder Bowl weekly context v3");
  const fbgAuctionValueSources = candidate.sources.filter((source) => source.name === "Footballguys 2026 Draft Dominator auction values");
  const weeklyProjectionRows = candidate.players.filter((player) => player.weeklyProjection?.modelEffect === "none").length;
  const supplementalProjectionRows = candidate.players.reduce(
    (sum, player) => sum + (player.projectionSources || []).filter((source) => source.role === "supplemental" && source.modelEffect === "none").length,
    0,
  );

  if (!['practice', 'draft-ready'].includes(candidate.status)) blockingIssues.push(`Pack status '${candidate.status}' is not releasable.`);
  if (!Number.isFinite(Date.parse(candidate.asOf))) blockingIssues.push("Pack asOf is not a valid timestamp.");
  if (candidate.players.length < 650) blockingIssues.push(`Only ${candidate.players.length} players were supplied; at least 650 are required.`);
  if (candidate.sources.length < 2) blockingIssues.push("At least two independently labeled projection/evidence sources are required.");
  if (candidate.sources.some((source) => !source.name || !source.asOf || !source.authority || !source.scoringFingerprint)) {
    blockingIssues.push("Every source must include name, asOf, authority, and scoringFingerprint.");
  }
  if (candidate.sources.some((source) => !Number.isFinite(Date.parse(source.asOf)))) blockingIssues.push("Every source asOf must be a valid timestamp.");
  if (candidate.sources.some((source) => source.scoringFingerprint !== candidate.sources[0].scoringFingerprint)) {
    blockingIssues.push("Source scoring fingerprints disagree.");
  }
  if (SEALED_HOLDOUT_PATTERN.test(sourceText)) blockingIssues.push("A source label appears to reference sealed 2025 outcome evidence.");
  if (supplementalProjectionSources.length && supplementalProjectionRows === 0) {
    blockingIssues.push("A supplemental projection source is declared but no value-neutral player evidence is attached.");
  }
  if (declaredPrimarySources.length && !primaryProjectionSource) {
    blockingIssues.push("Exactly one declared primary projection source must reconcile to every player's projected points.");
  }
  if (managerAdvisorySources.length && candidate.managerProfiles.length === 0) {
    blockingIssues.push("A manager-profile advisory source is declared but no validated manager profiles are attached.");
  }
  if (scheduleEvidenceSources.length !== (candidate.scheduleContext ? 1 : 0)) {
    blockingIssues.push("The authenticated schedule source and validated value-neutral schedule context must appear together exactly once.");
  }
  if (weeklyContextSources.length !== (candidate.weeklyContext ? 1 : 0)) {
    blockingIssues.push("The weekly-context source and validated value-neutral weekly context must appear together exactly once.");
  }
  if (candidate.weeklyContext && weeklyProjectionRows !== candidate.weeklyContext.coveredPlayers) {
    blockingIssues.push("Weekly-context player evidence does not reconcile to the declared coverage count.");
  }
  if (fbgAuctionValueSources.length !== (candidate.fbgAuctionValues ? 1 : 0)) {
    blockingIssues.push("The Footballguys auction-value source and validated value-neutral comparison rows must appear together exactly once.");
  }
  if (candidate.fbgAuctionValues && candidate.fbgAuctionValues.modelEffect !== "none") {
    blockingIssues.push("Footballguys auction values exceed comparison-only authority.");
  }
  if (allocated !== expectedCap) blockingIssues.push(`Top-roster market allocation is $${allocated}, not the $${expectedCap} league cap.`);
  if (keeperTeams.size !== candidate.leagueConfig.teams.length) {
    blockingIssues.push(`Keeper evidence covers ${keeperTeams.size} teams, not all ${candidate.leagueConfig.teams.length}.`);
  }
  if (candidate.keeperCandidates.some((keeper) => !candidatePlayerIds.has(keeper.playerId))) {
    blockingIssues.push("At least one keeper candidate does not resolve to the candidate player pool.");
  }

  let changes = { added: [], removed: [], material: [] };
  let exactValueChanges = [];
  let contentChanged = true;
  if (current) {
    contentChanged = sha256(candidate) !== sha256(current);
    if (stableText(candidate.leagueConfig) !== stableText(current.leagueConfig)) {
      if (isEvidenceBackedFinalStandingsUpdate(current, candidate)) {
        warnings.push("Accepted the evidence-backed final standings order and El Guapo's confirmed $2 bonus; player strategy values are unchanged.");
      } else {
        blockingIssues.push("League configuration changed from the active pack.");
      }
    }
    if (Date.parse(candidate.asOf) < Date.parse(current.asOf)) blockingIssues.push("Candidate pack is older than the active pack.");
    if (contentChanged && candidate.packId === current.packId) blockingIssues.push("Pack content changed without a new packId.");
    changes = materialPlayerChanges(current, candidate);
    exactValueChanges = exactStrategyChanges(current, candidate);
    const hasStrategyChanges = changes.added.length || changes.removed.length || exactValueChanges.length;
    if (supplementalProjectionSources.length && hasStrategyChanges && !primaryProjectionUpdate) {
      blockingIssues.push(
        `A value-neutral supplemental projection release changed ${changes.added.length} additions, ${changes.removed.length} removals, or ${exactValueChanges.length} player strategy records.`,
      );
    }
    if (candidate.managerProfiles.length && hasStrategyChanges && !primaryProjectionUpdate) {
      blockingIssues.push(
        `An advisory-only manager-profile release changed ${changes.added.length} additions, ${changes.removed.length} removals, or ${exactValueChanges.length} player strategy records.`,
      );
    }
    if (candidate.scheduleContext && hasStrategyChanges && !primaryProjectionUpdate) {
      blockingIssues.push(
        `A value-neutral schedule-context release changed ${changes.added.length} additions, ${changes.removed.length} removals, or ${exactValueChanges.length} player strategy records.`,
      );
    }
    if (candidate.weeklyContext && hasStrategyChanges && !primaryProjectionUpdate) {
      blockingIssues.push(
        `A value-neutral weekly-context release changed ${changes.added.length} additions, ${changes.removed.length} removals, or ${exactValueChanges.length} player strategy records.`,
      );
    }
    if (candidate.fbgAuctionValues && hasStrategyChanges && !primaryProjectionUpdate) {
      blockingIssues.push(
        `A value-neutral Footballguys auction comparison changed ${changes.added.length} additions, ${changes.removed.length} removals, or ${exactValueChanges.length} player strategy records.`,
      );
    }
    if (primaryProjectionUpdate) {
      if (changes.added.length || changes.removed.length) {
        blockingIssues.push("A projection-only candidate changed the player universe.");
      }
      if (stableText(candidate.managerProfiles) !== stableText(current.managerProfiles)) {
        blockingIssues.push("A primary projection update changed advisory manager profiles.");
      }
      if (stableText(candidate.scheduleContext) !== stableText(current.scheduleContext)) {
        blockingIssues.push("A primary projection update changed value-neutral schedule context.");
      }
      const replacingPrimarySource = current.sources.some((source) => source.name === primaryProjectionSource);
      const priorSourceFingerprints = new Set(current.sources
        .filter((source) => !replacingPrimarySource || source.name !== primaryProjectionSource)
        .map(stableText));
      const retainedSourceCount = candidate.sources.filter((source) => priorSourceFingerprints.has(stableText(source))).length;
      const expectedRetainedSources = current.sources.length - (replacingPrimarySource ? 1 : 0);
      const expectedCandidateSources = current.sources.length + (replacingPrimarySource ? 0 : 1);
      if (retainedSourceCount !== expectedRetainedSources || candidate.sources.length !== expectedCandidateSources) {
        blockingIssues.push("A primary projection update changed prior source evidence outside the registered append-or-replace path.");
      }
      const evidenceFields = ["id", "name", "position", "nflTeam", "injury", "sos", "notes"];
      const currentPlayers = playerMap(current);
      if (candidate.players.some((player) => {
        const prior = currentPlayers.get(player.id);
        return !prior || evidenceFields.some((field) => player[field] !== prior[field]);
      })) {
        blockingIssues.push("A primary projection update changed player identity, injury, SOS, or notes evidence.");
      }
      const championIssues = classicChampionIssues(candidate, current);
      if (championIssues.length) blockingIssues.push(`Champion VBD recomputation failed: ${championIssues.join(" | ")}`);
      else warnings.push(`Accepted '${primaryProjectionSource}' as a candidate projection source; Thunder Bowl recomputed every strategy value.`);
    }
    if (changes.removed.length > Math.max(10, Math.floor(current.players.length * 0.05))) {
      blockingIssues.push(`${changes.removed.length} existing players disappeared; the 5% removal safety limit was exceeded.`);
    }
    if (changes.material.length > 100) warnings.push(`${changes.material.length} players have a projection or price movement large enough for review.`);
  }

  return {
    schemaVersion: 1,
    auditedAt: new Date().toISOString(),
    approved: blockingIssues.length === 0,
    candidate: {
      packId: candidate.packId,
      asOf: candidate.asOf,
      sha256: sha256(candidate),
      players: candidate.players.length,
      keeperCandidates: candidate.keeperCandidates.length,
      keeperTeams: keeperTeams.size,
      sources: candidate.sources.length,
      supplementalProjectionRows,
      managerProfiles: candidate.managerProfiles.length,
      scheduleContext: candidate.scheduleContext?.status || null,
      weeklyContext: candidate.weeklyContext?.status || null,
      weeklyProjectionRows,
      fbgAuctionValueRows: candidate.fbgAuctionValues?.matchedRows || 0,
      primaryProjectionSource,
      primaryProjectionUpdate,
      expectedCap,
      allocatedMarketDollars: allocated,
    },
    current: current ? { packId: current.packId, asOf: current.asOf, sha256: sha256(current), players: current.players.length } : null,
    contentChanged,
    blockingIssues,
    warnings,
    changes: {
      addedCount: changes.added.length,
      removedCount: changes.removed.length,
      materialCount: changes.material.length,
      exactStrategyValueChangeCount: exactValueChanges.length,
      addedPlayerIds: changes.added,
      removedPlayerIds: changes.removed,
      largestMaterialChanges: changes.material.slice(0, 50),
      exactStrategyValueChanges: exactValueChanges.slice(0, 50),
    },
  };
}

export function renderAuditMarkdown(audit) {
  const lines = [
    `# Thunder Bowl pack refresh audit`,
    ``,
    `- Audited: ${audit.auditedAt}`,
    `- Candidate: \`${audit.candidate.packId}\` (${audit.candidate.players} players, ${audit.candidate.keeperCandidates} keeper rows)`,
    `- Decision: **${audit.approved ? "PASS" : "BLOCK"}**`,
    `- Market allocation: $${audit.candidate.allocatedMarketDollars} / $${audit.candidate.expectedCap}`,
    `- Changes: ${audit.changes.addedCount} added, ${audit.changes.removedCount} removed, ${audit.changes.materialCount} material`,
    ``,
    `## Blocking issues`,
    ``,
    ...(audit.blockingIssues.length ? audit.blockingIssues.map((issue) => `- ${issue}`) : ["- None"]),
    ``,
    `## Warnings`,
    ``,
    ...(audit.warnings.length ? audit.warnings.map((warning) => `- ${warning}`) : ["- None"]),
    ``,
    `## Largest material player changes`,
    ``,
    ...(audit.changes.largestMaterialChanges.length
      ? audit.changes.largestMaterialChanges.map((change) => `- ${change.name} (${change.position}): projection ${change.projectionDelta >= 0 ? "+" : ""}${change.projectionDelta}, market ${change.marketDelta >= 0 ? "+" : ""}$${change.marketDelta}, max ${change.maxBidDelta >= 0 ? "+" : ""}$${change.maxBidDelta}`)
      : ["- None"]),
    ``,
  ];
  return lines.join("\n");
}
