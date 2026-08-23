import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [appSource, storageSource, serviceWorker, appCss] = await Promise.all([
  readFile(new URL("../public/thunder-bowl/app.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/thunder-bowl/storage.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/thunder-bowl/service-worker.js", import.meta.url), "utf8"),
  readFile(new URL("../public/thunder-bowl/app.css", import.meta.url), "utf8"),
]);

test("startup reads cached metadata and the event ledger concurrently", () => {
  assert.match(storageSource, /export async function getMetaBatch/);
  assert.match(appSource, /Promise\.all\(\[\s*getOrCreateDeviceId\(\),[\s\S]*getMetaBatch\(\{[\s\S]*readEvents\(\),/);
  assert.match(appSource, /loadPack\(Boolean\(session\?\.authenticated\), startupMeta\.draftPack\)/);
  assert.match(appSource, /if \(cachedPack\) \{[\s\S]*return validateDraftPack\(cachedPack\);[\s\S]*setMeta\("draftPack", null\)/);
});

test("only the active command-center tab is rendered", () => {
  assert.match(appSource, /function renderCurrentView\(\)/);
  assert.match(appSource, /if \(currentView === "keepers"\)/);
  assert.match(appSource, /if \(currentView === "settings"\)/);
  assert.match(appSource, /const rosterSafety = renderCurrentView\(\)/);
  assert.match(appSource, /if \(draftPack && !appView\.hidden\) renderCurrentView\(\)/);
});

test("the player pool virtualizes 716-player packs without losing offline support", () => {
  assert.match(appSource, /calculatePlayerWindow\(/);
  assert.match(appSource, /virtualPlayerList\.slice\(windowState\.start, windowState\.end\)/);
  assert.match(appSource, /playerTableWrap\.addEventListener\("scroll"/);
  assert.match(appCss, /\.player-pool-spacer td/);
  assert.match(serviceWorker, /player-virtual-window\.mjs\?v=/);
});
