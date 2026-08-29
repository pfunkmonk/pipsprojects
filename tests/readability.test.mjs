import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const urls = {
  privateHtml: new URL("../public/thunder-bowl/index.html", import.meta.url),
  privateCss: new URL("../public/thunder-bowl/readability.css", import.meta.url),
  auctioneerHtml: new URL("../public/thunder-bowl/auctioneer/index.html", import.meta.url),
  auctioneerCss: new URL("../public/thunder-bowl/auctioneer/auctioneer-readability.css", import.meta.url),
  worker: new URL("../public/thunder-bowl/service-worker.js", import.meta.url),
  home: new URL("../public/index.html", import.meta.url),
};

test("every auction surface loads a dedicated final readability layer", async () => {
  const [privateHtml, auctioneerHtml, worker] = await Promise.all([
    readFile(urls.privateHtml, "utf8"),
    readFile(urls.auctioneerHtml, "utf8"),
    readFile(urls.worker, "utf8"),
  ]);
  assert.match(privateHtml, /<link[^>]+app\.css[^>]*>[\s\S]*<link[^>]+readability\.css[^>]*>/);
  assert.match(auctioneerHtml, /<link[^>]+shell-safety\.css[^>]*>[\s\S]*<link[^>]+auctioneer-readability\.css[^>]*>/);
  assert.match(worker, /readability\.css\?v=20260827a/);
  assert.match(worker, /auctioneer-readability\.css\?v=20260828a/);
  assert.match(worker, /thunder-bowl-shell-v120/);
});

test("private command center preserves geometry while raising microcopy floors", async () => {
  const css = await readFile(urls.privateCss, "utf8");
  assert.doesNotMatch(css, /grid-template|height\s*:|position\s*:/);
  assert.match(css, /--muted: #bfd0df/);
  assert.match(css, /\.metric span \{ font-size: 0\.73rem/);
  assert.match(css, /\.data-table th \{ font-size: 0\.71rem/);
  assert.match(css, /#view-draft \.decision-market-strip b \{ font-size: 0\.66rem/);
  assert.match(css, /\.room-team-card-counts \{[^}]*font-size: 0\.65rem/);
});

test("auctioneer microcopy and controls no longer rely on sub-10px text", async () => {
  const css = await readFile(urls.auctioneerCss, "utf8");
  assert.doesNotMatch(css, /font-size:\s*[0-9]px/);
  assert.match(css, /\.clock-console small[\s\S]*font-size: 11px/);
  assert.match(css, /\.quick-team-grid button \{ font-size: 11px/);
  assert.match(css, /\.activity-feed li \{ font-size: 12px/);
  assert.match(css, /th \{[^}]*font-size: 11px/);
});

test("Pip's Projects cards expose readable description, action, and badge text", async () => {
  const home = await readFile(urls.home, "utf8");
  assert.match(home, /\.card p \{[^}]*font-size: 15px/);
  assert.match(home, /\.card \.go \{[^}]*font-size: 14px/);
  assert.match(home, /\.badge \{[^}]*font-size: 11px/);
  assert.match(home, /--muted:#adb7c1/);
});
