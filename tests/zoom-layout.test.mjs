import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appCss = await readFile(new URL("../public/thunder-bowl/app.css", import.meta.url), "utf8");
const indexHtml = await readFile(new URL("../public/thunder-bowl/index.html", import.meta.url), "utf8");

test("short desktop view keeps live-auction actions visible at high browser zoom", () => {
  const start = appCss.indexOf("@media (min-width: 901px) and (max-height: 699px)");
  assert.notEqual(start, -1, "compact high-zoom media query is required");

  const compactRule = appCss.slice(start, appCss.indexOf(".section-intro", start));
  assert.match(compactRule, /\.topbar \.status-row \{ display: none; \}/);
  assert.match(compactRule, /#view-draft \.sale-bar,\s*#view-draft \.practice-console \{[\s\S]*position: fixed;/);
  assert.match(compactRule, /#view-draft \.practice-activity \{ display: none; \}/);
  assert.match(compactRule, /#view-draft \.practice-actions \.button \{ min-height: 60px; \}/);
  assert.match(compactRule, /#view-draft \.practice-bid-button \{ min-height: 60px; \}/);
  assert.match(compactRule, /#view-draft \{ padding-bottom: 8\.2rem; \}/);
});

test("runner-up capture stays in-bounds without blocking the auction", () => {
  assert.match(indexHtml, /id="runner-up-prompt"[\s\S]*id="runner-up-team"[\s\S]*id="runner-up-skip"/);
  assert.match(indexHtml, /Optional · closes in 30 seconds · editable later in Admin/);

  const promptRule = appCss.slice(appCss.indexOf(".runner-up-prompt {"), appCss.indexOf(".runner-up-prompt[hidden]"));
  assert.match(promptRule, /position: fixed;/);
  assert.match(promptRule, /grid-template-columns: minmax\(180px, 1fr\) minmax\(180px, 0\.9fr\) auto;/);
  assert.match(promptRule, /width: min\(640px, calc\(100vw - 2rem\)\);/);
  assert.match(appCss, /@media \(max-width: 760px\) \{[\s\S]*\.runner-up-prompt \{[\s\S]*right: 0\.75rem;[\s\S]*bottom: 0\.75rem;[\s\S]*left: 0\.75rem;[\s\S]*grid-template-columns: 1fr auto;/);
  assert.match(appCss, /\.runner-up-prompt\[hidden\] \{ display: none; \}/);
});
