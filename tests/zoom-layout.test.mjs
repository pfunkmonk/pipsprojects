import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appCss = await readFile(new URL("../public/thunder-bowl/app.css", import.meta.url), "utf8");

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
