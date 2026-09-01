import { readFile } from "node:fs/promises";
import { validateDraftPack } from "../../../public/thunder-bowl/state-engine.mjs";

const PACK_PATHS = [
  new URL("./_data/draft-pack-2026-provisional.json", import.meta.url),
  new URL("../_data/draft-pack-2026-provisional.json", import.meta.url),
];
let cachedText = null;

export async function readSeasonPack() {
  if (!cachedText) {
    let lastError;
    for (const path of PACK_PATHS) {
      try {
        cachedText = await readFile(path, "utf8");
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!cachedText) throw lastError || new Error("The protected in-season player catalog is unavailable.");
  }
  return validateDraftPack(JSON.parse(cachedText));
}
