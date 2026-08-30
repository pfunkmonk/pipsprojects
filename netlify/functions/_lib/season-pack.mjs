import { readFile } from "node:fs/promises";
import { validateDraftPack } from "../../../public/thunder-bowl/state-engine.mjs";
import { readDraftPackRelease, releasedPackText } from "./pack-release-store.mjs";

const PACK_PATH = new URL("../_data/draft-pack-2026-provisional.json", import.meta.url);
let cachedText = null;

export async function readSeasonPack() {
  cachedText ||= await readFile(PACK_PATH, "utf8");
  const releasedText = releasedPackText(cachedText, await readDraftPackRelease());
  return validateDraftPack(JSON.parse(releasedText));
}
