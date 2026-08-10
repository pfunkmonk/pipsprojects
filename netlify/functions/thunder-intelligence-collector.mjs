import { readFile } from "node:fs/promises";
import { currentNewsSnapshot } from "./_lib/news-store.mjs";
import { currentResearchSnapshot } from "./_lib/research-store.mjs";
import { currentStatusSnapshot } from "./_lib/status-store.mjs";

const PACK_PATH = new URL("./_data/draft-pack-2026-provisional.json", import.meta.url);

export default async function handler() {
  const pack = JSON.parse(await readFile(PACK_PATH, "utf8"));
  const results = await Promise.allSettled([
    currentStatusSnapshot(pack, { force: true }),
    currentNewsSnapshot({ force: true }),
    currentResearchSnapshot({ force: true }),
  ]);
  const sourceNames = ["Sleeper status", "RotoWire news", "Footballguys news/depth plus CBS research"];
  const failures = results.flatMap((result, index) => result.status === "rejected"
    ? [{ source: sourceNames[index], diagnostic: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
    : []);
  if (failures.length === results.length) throw new Error(`All intelligence sources failed: ${failures.map((failure) => `${failure.source}: ${failure.diagnostic}`).join("; ")}`);
  return Response.json({
    capturedAt: new Date().toISOString(),
    refreshedSources: results.length - failures.length,
    failures,
    modelEffect: "none",
    ledgerEffect: "none",
  });
}

export const config = { schedule: "@hourly" };
