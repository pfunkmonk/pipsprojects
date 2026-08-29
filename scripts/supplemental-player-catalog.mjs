import { readFileSync } from "node:fs";
import { canonicalPlayerIdentity, validateDraftPack } from "../public/thunder-bowl/state-engine.mjs";
import { recomputeClassicValues } from "./projection-refresh-core.mjs";

const CATALOG_URL = new URL("./data/supplemental-player-catalog-2026.json", import.meta.url);
const RAW_CATALOG = JSON.parse(readFileSync(CATALOG_URL, "utf8"));
const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DST"]);

function fail(message) {
  const error = new Error(message);
  error.code = "SUPPLEMENTAL_PLAYER_CATALOG";
  throw error;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.join("|") !== required.join("|")) fail(`${label} fields changed.`);
}

function validateCatalog(input = RAW_CATALOG) {
  exactKeys(input, ["schemaVersion", "season", "players"], "supplemental player catalog");
  if (input.schemaVersion !== 1 || input.season !== 2026 || !Array.isArray(input.players)) fail("The supplemental catalog metadata is invalid.");
  const ids = new Set();
  const identities = new Set();
  const players = input.players.map((player, index) => {
    const label = `supplemental player ${index + 1}`;
    exactKeys(player, [
      "id", "name", "position", "nflTeam", "byeWeek", "tier", "sourceRank", "projectedPoints",
      "projectionSource", "projectionAsOf", "receptions", "recYds", "recTd", "reason",
    ], label);
    if (!/^fbg:[A-Za-z0-9]+$/.test(player.id) || ids.has(player.id)) fail(`${label} has an invalid or duplicate permanent id.`);
    if (typeof player.name !== "string" || player.name.length < 2 || !POSITIONS.has(player.position)) fail(`${label} has an invalid name or position.`);
    if (!/^[A-Z]{2,3}$/.test(player.nflTeam)) fail(`${label} has an invalid NFL team.`);
    if (!Number.isInteger(player.byeWeek) || player.byeWeek < 1 || player.byeWeek > 18) fail(`${label} has an invalid bye week.`);
    for (const field of ["tier", "sourceRank", "projectedPoints", "receptions", "recYds", "recTd"]) {
      if (!Number.isFinite(player[field]) || player[field] < 0) fail(`${label} has an invalid ${field}.`);
    }
    if (!Number.isFinite(Date.parse(player.projectionAsOf))) fail(`${label} has an invalid projection timestamp.`);
    if (typeof player.projectionSource !== "string" || player.projectionSource.length < 2 || typeof player.reason !== "string" || player.reason.length < 20) {
      fail(`${label} is missing source provenance.`);
    }
    const identity = canonicalPlayerIdentity(player.name, player.position, player.nflTeam);
    if (identities.has(identity)) fail(`${label} repeats a canonical identity.`);
    ids.add(player.id);
    identities.add(identity);
    return Object.freeze({ ...player, identity });
  });
  return Object.freeze({ ...input, players: Object.freeze(players) });
}

export const SUPPLEMENTAL_PLAYER_CATALOG = validateCatalog();

export function approvedSupplementalPlayerById(id) {
  return SUPPLEMENTAL_PLAYER_CATALOG.players.find((player) => player.id === id) || null;
}

function scaledWeeklyPoints(total, byeWeek, referencePoints) {
  const usable = referencePoints?.length === 18
    ? referencePoints.map((value, index) => index + 1 === byeWeek ? null : Math.max(0, Number(value) || 0))
    : Array.from({ length: 18 }, (_, index) => index + 1 === byeWeek ? null : 1);
  const targetTenths = Math.round(total * 10);
  const denominator = usable.reduce((sum, value) => sum + (value ?? 0), 0);
  const allocations = usable.map((value, index) => {
    if (value === null) return null;
    const exact = denominator > 0 ? value / denominator * targetTenths : targetTenths / 17;
    return { index, tenths: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let remainder = targetTenths - allocations.reduce((sum, row) => sum + (row?.tenths || 0), 0);
  const priority = allocations.filter(Boolean).sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; index < remainder; index += 1) priority[index % priority.length].tenths += 1;
  return allocations.map((row) => row ? row.tenths / 10 : null);
}

export function addApprovedSupplementalPlayers(packInput, { exportedAt = new Date().toISOString() } = {}) {
  const current = validateDraftPack(packInput);
  if (current.season !== SUPPLEMENTAL_PLAYER_CATALOG.season) fail("The supplemental catalog season does not match the draft pack.");
  if (!Number.isFinite(Date.parse(exportedAt))) fail("The supplemental catalog export time is invalid.");
  const candidate = structuredClone(current);
  const existingIds = new Set(candidate.players.map((player) => player.id));
  const existingIdentities = new Set(candidate.players.map((player) => canonicalPlayerIdentity(player.name, player.position, player.nflTeam)));
  const added = [];

  for (const entry of SUPPLEMENTAL_PLAYER_CATALOG.players) {
    const existing = candidate.players.find((player) => player.id === entry.id || canonicalPlayerIdentity(player.name, player.position, player.nflTeam) === entry.identity);
    if (existing) {
      if (existing.id !== entry.id || existing.name !== entry.name || existing.position !== entry.position || existing.nflTeam !== entry.nflTeam) {
        fail(`${entry.name} conflicts with an existing player identity.`);
      }
      continue;
    }
    if (existingIds.has(entry.id) || existingIdentities.has(entry.identity)) fail(`${entry.name} collides with the protected player universe.`);
    const reference = candidate.players.find((player) => player.nflTeam === entry.nflTeam && player.position === entry.position && player.weeklyProjection?.byeWeek === entry.byeWeek)
      || candidate.players.find((player) => player.nflTeam === entry.nflTeam && player.weeklyProjection?.byeWeek === entry.byeWeek);
    const weeklyPoints = scaledWeeklyPoints(entry.projectedPoints, entry.byeWeek, reference?.weeklyProjection?.points);
    candidate.players.push({
      id: entry.id,
      name: entry.name,
      position: entry.position,
      nflTeam: entry.nflTeam,
      tier: entry.tier,
      projectedPoints: entry.projectedPoints,
      vbd: 0,
      intrinsicValue: 1,
      marketValue: 1,
      maxBid: 1,
      sourceRank: entry.sourceRank,
      injury: "No current injury flag in the final source snapshot",
      sos: "2026 league schedule loaded; supplemental catalog identity",
      notes: `${entry.projectionSource} ${entry.projectedPoints.toFixed(1)}. Thunder Bowl consensus ${entry.projectedPoints.toFixed(1)} drives VBD; availability-aware weekly weighting and QA-approved automatic correction +0.0.`,
      projectionSources: [
        {
          source: entry.projectionSource,
          points: entry.projectedPoints,
          asOf: entry.projectionAsOf,
          role: "supplemental",
          modelEffect: "none",
          note: "Source-backed late identity addition; final catalog valuation is display-safe",
        },
        {
          source: "Thunder Bowl Consensus",
          points: entry.projectedPoints,
          asOf: entry.projectionAsOf,
          role: "primary",
          modelEffect: "primary_projection",
          note: "Governed supplemental catalog identity; no invented projection uplift",
        },
      ],
      weeklyProjection: {
        source: "Thunder Bowl weekly assets v1",
        asOf: entry.projectionAsOf,
        modelEffect: "none",
        games: 17,
        byeWeek: entry.byeWeek,
        points: weeklyPoints,
        sourceSeasonTotal: entry.projectedPoints,
      },
      assetProjection: {
        source: "Thunder Bowl weekly assets v1",
        asOf: entry.projectionAsOf,
        modelEffect: "none",
        seasonSource: entry.projectionSource === "FantasyPros" ? "FP" : entry.projectionSource,
        shapeSource: reference ? "TEAM" : "FLAT",
        passYds: 0,
        passTd: 0,
        passInt: 0,
        rushYds: 0,
        rushTd: 0,
        receptions: entry.receptions,
        recYds: entry.recYds,
        recTd: entry.recTd,
        fumblesLost: 0,
        fgMade: 0,
        xpMade: 0,
        dstSacks: 0,
        dstInt: 0,
        dstFumRec: 0,
        dstTd: 0,
        dstSafety: 0,
        dstPtsAllowed: 0,
      },
    });
    existingIds.add(entry.id);
    existingIdentities.add(entry.identity);
    added.push(entry.id);
  }

  if (!added.length) return { candidate: current, added };
  candidate.packId = `tb26-final-supplemental-catalog-${exportedAt.replace(/\D/g, "").slice(0, 14)}`;
  candidate.asOf = exportedAt;
  candidate.status = "practice";
  if (candidate.weeklyContext) {
    candidate.weeklyContext.coveredPlayers = candidate.players.filter((player) => player.weeklyProjection).length;
    const topCount = Math.min(168, candidate.players.length);
    candidate.weeklyContext.top168Coverage = Number((candidate.players.slice(0, topCount).filter((player) => player.weeklyProjection).length / topCount).toFixed(6));
  }
  recomputeClassicValues(candidate, current);
  return { candidate: validateDraftPack(candidate), added };
}

export function isApprovedSupplementalTransition(current, candidate, playerId) {
  const entry = approvedSupplementalPlayerById(playerId);
  if (!entry || current.players.some((player) => player.id === playerId)) return false;
  const player = candidate.players.find((row) => row.id === playerId);
  if (!player) return false;
  if (player.name !== entry.name || player.position !== entry.position || player.nflTeam !== entry.nflTeam || player.tier !== entry.tier || player.sourceRank !== entry.sourceRank) return false;
  if (player.weeklyProjection?.byeWeek !== entry.byeWeek || player.marketValue !== 1 || player.maxBid !== 1) return false;
  if (candidate.keeperCandidates.some((keeper) => keeper.playerId === playerId)) return false;
  const source = player.projectionSources.find((row) => row.source === entry.projectionSource && row.modelEffect === "none");
  const primary = player.projectionSources.find((row) => row.source === "Thunder Bowl Consensus" && row.modelEffect === "primary_projection");
  return Boolean(source && primary && Math.abs(primary.points - player.projectedPoints) <= 0.11);
}
