import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const hub = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const config = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");
const worker = await readFile(new URL("../public/draft-day/service-worker.js", import.meta.url), "utf8");
const auctioneerSource = await readFile(new URL("../public/draft-day/auctioneer/auctioneer.mjs", import.meta.url), "utf8");
const boardSource = await readFile(new URL("../public/draft-day/board/board.mjs", import.meta.url), "utf8");
const environment = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const pages = [new URL("../public/draft-day/index.html", import.meta.url), new URL("../public/draft-day/auctioneer/index.html", import.meta.url), new URL("../public/draft-day/board/index.html", import.meta.url), new URL("../public/draft-day/guide/index.html", import.meta.url)];

test("Pip's Projects card exposes setup, auctioneer, and Draft Board routes", () => {
  assert.match(hub, /Pip's Draft Day Tool/);
  assert.match(hub, /href="\/draft-day\/">Create \/ Manage/);
  assert.match(hub, /href="\/draft-day\/auctioneer\/">Auctioneer/);
  assert.match(hub, /href="\/draft-day\/board\/">Draft Board/);
});

test("Netlify routes all Draft Day APIs and applies a strict app policy", () => {
  for (const route of ["leagues", "auth", "snapshot", "commands"]) assert.match(config, new RegExp(`from = "\\/api\\/draft-day\\/${route}"`));
  assert.match(config, /for = "\/draft-day\/\*"[\s\S]*Content-Security-Policy/);
  assert.match(config, /for = "\/api\/draft-day\/\*"[\s\S]*Cache-Control = "no-store"/);
});

test("Draft Day pages use external assets and every local asset exists", async () => {
  for (const page of pages) {
    const html = await readFile(page, "utf8");
    assert.doesNotMatch(html, /<style\b/i);
    assert.match(html, /shell-safety\.css/);
    for (const match of html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)="([^"]+)"/g)) {
      const reference = match[1]; if (reference.startsWith("http") || reference.startsWith("data:")) continue;
      await assert.doesNotReject(access(new URL(reference.split("?")[0], page)), `Missing asset ${reference}`);
    }
  }
});

test("offline shell includes setup, auctioneer, board, and public player identities", () => {
  for (const path of ["/draft-day/", "/draft-day/auctioneer/", "/draft-day/board/", "/draft-day/guide/", "/draft-day/player-pool.json"]) assert.ok(worker.includes(`"${path}"`));
  assert.match(worker, /pathname\.startsWith\("\/draft-day\/"\)/);
});

test("repository contains only a Draft Day secret placeholder", () => {
  assert.match(environment, /^DRAFT_DAY_SESSION_SECRET=replace-with-a-separate-long-random-secret$/m);
});

test("offline role access requires a verifier saved after successful online sign-in", () => {
  for (const source of [auctioneerSource, boardSource]) {
    assert.match(source, /crypto\.subtle\.digest\("SHA-256"/);
    assert.match(source, /localStorage\.setItem\(verifierKey\(code\), await accessVerifier/);
    assert.match(source, /localStorage\.getItem\(verifierKey\(code\)\) === await accessVerifier/);
  }
});
