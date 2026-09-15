import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { decisionCheckpoint, weeklyProjectionArchive } from "./season-management.mjs";

const db = () => getStore({ name: "thunder-bowl-2026-season", consistency: "strong" });
const key = "management/v1/evidence";
const hash = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const fail = (message) => { const e = new Error(message); e.code = "INVALID_INPUT"; throw e; };
const fields = {
  usage: ["snapShare", "routeShare", "targets", "carries", "redZoneTouches"],
  bid: ["teamId", "amount", "outcome", "transactionId"],
  result: ["points", "final"],
  stash: ["eligible", "returnEvidence", "keeperCost", "nextYearValue"],
  "ir-slot": [],
};

export function validateManagementRecords(input, pack, teams, now = new Date().toISOString(), { allowCurrentCbsFinals = false } = {}) {
  if (!Array.isArray(input) || !input.length || input.length > 2000) fail("Import must contain 1–2000 evidence rows.");
  const playerIds = new Set(pack.players.map((p) => p.id));
  const teamIds = new Set(teams.map((t) => t.teamId));
  return input.map((r, i) => {
    const label = `Row ${i + 1}`;
    if (!r || typeof r !== "object" || !Object.hasOwn(fields, r.kind)) fail(`${label}: invalid evidence kind.`);
    for (const k of Object.keys(r)) if (!["kind", "playerId", "season", "week", "observedAt", "sourceUrl", ...fields[r.kind]].includes(k)) fail(`${label}: unsupported field ${k}.`);
    if (r.season !== pack.season || !Number.isInteger(r.week) || r.week < 1 || r.week > 18) fail(`${label}: invalid season/week.`);
    if (!(r.kind === "ir-slot" && r.playerId === null) && !playerIds.has(r.playerId)) fail(`${label}: player identity must match the current catalog.`);
    if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(r.observedAt || "") || !Number.isFinite(Date.parse(r.observedAt)) || Date.parse(r.observedAt) > Date.parse(now)) fail(`${label}: observedAt must be a real timestamp, not in the future.`);
    let url;
    try { url = new URL(r.sourceUrl); } catch { fail(`${label}: sourceUrl must be a source report link.`); }
    if (url.protocol !== "https:" || url.username || url.password || r.sourceUrl.length > 1500) fail(`${label}: use an HTTPS evidence link without credentials.`);
    const number = (k, max = 200, min = 0) => { if (typeof r[k] !== "number" || !Number.isFinite(r[k]) || r[k] < min || r[k] > max) fail(`${label}: invalid ${k}.`); };
    if (r.kind === "usage") {
      if (!fields.usage.some((k) => r[k] != null)) fail(`${label}: at least one observed workload metric is required.`);
      for (const k of fields.usage) if (r[k] != null) number(k, k.endsWith("Share") ? 100 : 100);
    }
    const trustedCurrentCbsFinal = allowCurrentCbsFinals && r.kind === "result" && r.final === true && url.hostname === "berrymvp.football.cbssports.com" && /^\/scoring\/live(?:\/|$)/.test(url.pathname);
    if (["usage", "result"].includes(r.kind) && Date.parse(r.observedAt) < Date.UTC(2026, 8, 8 + r.week * 7) && !trustedCurrentCbsFinal) fail(`${label}: workload and actual scores require a completed regular-season week.`);
    if (r.kind === "bid") {
      number("amount", 50);
      if (!Number.isInteger(r.amount) || !teamIds.has(r.teamId) || !["WON", "LOST"].includes(r.outcome) || !/^[\w.:-]{1,100}$/.test(r.transactionId || "")) fail(`${label}: invalid bid, team, transaction ID or outcome.`);
    }
    if (r.kind === "result") {
      number("points", 150, -50);
      if (r.final !== true) fail(`${label}: only finalized Thunder Bowl-scored actuals can be imported.`);
    }
    if (r.kind === "stash") {
      if (typeof r.eligible !== "boolean" || typeof r.returnEvidence !== "string" || r.returnEvidence.trim().length < 10 || r.returnEvidence.length > 1500) fail(`${label}: explicit CBS eligibility and sourced return evidence are required.`);
      number("keeperCost", 200); number("nextYearValue", 200);
    }
    return { ...r, observedAt: new Date(r.observedAt).toISOString(), recordedAt: now,
      id: hash(r.kind === "ir-slot" ? [r.kind, r.season] : [r.kind, r.season, r.week, r.playerId, r.kind === "bid" ? [r.teamId, r.transactionId] : null]) };
  });
}

export function mergeManagementRecords(previous, incoming) {
  const rows = new Map(previous.map((r) => [r.id, r]));
  for (const r of incoming) {
    const old = rows.get(r.id);
    if (!old || old.observedAt <= r.observedAt) rows.set(r.id, r);
  }
  return [...rows.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));
}

export async function readManagementState(store = db(), { throughWeek = 18 } = {}) {
  const lastWeek = Number.isSafeInteger(throughWeek) ? Math.max(0, Math.min(18, throughWeek)) : 18;
  const [state, ...projectionArchives] = await Promise.all([
    store.get(key, { type: "json" }),
    ...Array.from({ length: lastWeek }, (_, index) => store.get(`management/v1/projection-archives/2026/week-${index + 1}`, { type: "json" })),
  ]);
  return { ...(state || { records: [], checkpoints: [] }), projectionArchives: projectionArchives.filter(Boolean) };
}

async function updateState(transform, store = db()) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const old = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
    const next = transform(old?.data || { records: [], checkpoints: [] });
    const result = await store.setJSON(key, next, old?.etag ? { onlyIfMatch: old.etag } : { onlyIfNew: true });
    if (result.modified) return next;
  }
  throw new Error("Another evidence update is still completing. Saved data was not overwritten; retry once it finishes.");
}

export async function saveManagementRecords(records, store = db()) {
  // Preserve each import before updating the current index, including corrections.
  await store.setJSON(`management/v1/imports/${hash(records)}`, records, { onlyIfNew: true });
  return updateState((old) => ({ ...old, records: mergeManagementRecords(old.records, records) }), store);
}

export async function archiveManagementCheckpoint(plan, now = new Date().toISOString(), store = db()) {
  const candidates = ["EARLY", "FINAL"].map((type) => decisionCheckpoint(plan, now, type)).filter(Boolean);
  if (!candidates.length) return null;
  return updateState((old) => {
    const checkpoints = [...old.checkpoints];
    for (const checkpoint of candidates) {
      const type = checkpoint.checkpointType || "EARLY";
      if (checkpoints.some((row) => row.season === plan.season && row.week === plan.week && (row.checkpointType || "EARLY") === type)) continue;
      checkpoints.push({ ...checkpoint, id: hash([plan.season, plan.week, type]) });
    }
    return { ...old, checkpoints };
  }, store);
}

export async function archiveWeeklyProjections(plan, now = new Date().toISOString(), store = db()) {
  const archive = weeklyProjectionArchive(plan, now);
  if (!archive) return null;
  const archiveKey = `management/v1/projection-archives/${plan.season}/week-${plan.week}`;
  const result = await store.setJSON(archiveKey, archive, { onlyIfNew: true });
  return result.modified ? archive : store.get(archiveKey, { type: "json" });
}
