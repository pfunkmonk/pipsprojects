import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { calculateBoardGeometry, calculateSaleFlight } from "../public/thunder-bowl/board/board-layout.mjs";

test("public board preserves compact row height while typography receives exact row dimensions", () => {
  const early = calculateBoardGeometry({
    availableHeight: 900,
    boardWidth: 3072,
    teamCount: 12,
    totalRosterRows: 14,
    visibleRosterRows: 2,
  });
  const full = calculateBoardGeometry({
    availableHeight: 900,
    boardWidth: 3072,
    teamCount: 12,
    totalRosterRows: 14,
    visibleRosterRows: 14,
  });

  assert.ok(early.boardHeight < 250);
  assert.equal(full.boardHeight, 900);
  assert.ok(Math.abs(early.rosterRowHeight - full.rosterRowHeight) < 0.0001);
  assert.ok(Math.abs((early.headerRowHeight + (early.rosterRowHeight * 2)) - early.boardHeight) < 0.0001);
  assert.ok(Math.abs((full.headerRowHeight + (full.rosterRowHeight * 14)) - 900) < 0.0001);
  assert.ok(early.teamColumnWidth > 250 && early.teamColumnWidth < 256);
});

test("public board geometry fails soft for incomplete dimensions", () => {
  const geometry = calculateBoardGeometry({
    availableHeight: -20,
    boardWidth: Number.NaN,
    teamCount: 0,
    totalRosterRows: 0,
    visibleRosterRows: 0,
  });

  assert.deepEqual(geometry, {
    boardHeight: 0,
    rosterRowHeight: 0,
    headerRowHeight: 0,
    teamColumnWidth: 0,
  });
});

test("sale flight derives its transform from the live spotlight and destination sticker rectangles", () => {
  assert.deepEqual(calculateSaleFlight(
    { left: 300, top: 200, width: 600, height: 200 },
    { left: 100, top: 500, width: 100, height: 50 },
  ), {
    translateX: -200,
    translateY: 300,
    scaleX: 1 / 6,
    scaleY: 0.25,
  });
  assert.equal(calculateSaleFlight(
    { left: 0, top: 0, width: 0, height: 200 },
    { left: 100, top: 500, width: 100, height: 50 },
  ), null);
});

test("public board loads the responsive legibility layer and prints bye weeks on stickers", async () => {
  const [boardIndex, boardFallback, serviceWorker, styles, boardSource] = await Promise.all([
    readFile(new URL("../public/thunder-bowl/board/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/board.html", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/service-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/board/board-legibility.css", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/board/board.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(boardIndex, /board-legibility\.css/);
  assert.match(boardFallback, /board-legibility\.css/);
  assert.match(serviceWorker, /board-legibility\.css/);
  assert.match(serviceWorker, /board-layout\.mjs/);
  assert.match(styles, /--team-column-width/);
  assert.match(styles, /--roster-row-height/);
  assert.match(styles, /calc\(var\(--roster-row-height\)/);
  assert.match(boardSource, /BYE \$\{assignment\.byeWeek\}/);
  assert.match(boardSource, /playerMeta\.textContent = `\$\{assignment\.position\} · \$\{assignment\.nflTeam\} · \$\{byeLabel\}`/);
});

test("manager headers open an accessible salary ledger that closes by X, backdrop, or Escape", async () => {
  const [boardSource, styles] = await Promise.all([
    readFile(new URL("../public/thunder-bowl/board/board.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/board/board-transactions.css", import.meta.url), "utf8"),
  ]);
  assert.match(boardSource, /document\.createElement\("button"\)[\s\S]*header\.setAttribute\("aria-haspopup", "dialog"\)/);
  assert.match(boardSource, /salaryLedgerDialog\.close\.addEventListener\("click", closeSalaryLedger\)/);
  assert.match(boardSource, /event\.target === salaryLedgerDialog\.backdrop/);
  assert.match(boardSource, /event\.key === "Escape"/);
  assert.match(boardSource, /teamSalaryLedger\(snapshot, teamId\)/);
  assert.match(styles, /\.salary-ledger-backdrop\{/);
  assert.match(styles, /\.salary-ledger-dialog\{/);
  assert.match(styles, /\.salary-ledger-rows\{[\s\S]*overflow-y:auto/);
});

test("nomination and sale spotlights stay below the measured manager-information row", async () => {
  const [boardSource, styles, boardIndex, boardFallback] = await Promise.all([
    readFile(new URL("../public/thunder-bowl/board/board.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/board/board-transactions.css", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/board/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/board.html", import.meta.url), "utf8"),
  ]);
  assert.match(boardSource, /teamHeader\.getBoundingClientRect\(\)\.bottom/);
  assert.match(boardSource, /--board-spotlight-safe-top/);
  assert.match(boardSource, /syncTransactionSpotlightSafeZone\(\)/);
  assert.match(styles, /:is\(\.nomination-spotlight,\.sale-spotlight\)\{top:var\(--board-spotlight-safe-top/);
  assert.match(styles, /max-height:calc\(100vh - var\(--board-spotlight-safe-top/);
  assert.match(boardIndex, /board-transactions\.css\?v=20260830c/);
  assert.match(boardFallback, /board-transactions\.css\?v=20260830c/);
});

test("sold spotlight holds for five seconds, flies to its assignment sticker, and fails soft", async () => {
  const [boardSource, styles] = await Promise.all([
    readFile(new URL("../public/thunder-bowl/board/board.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/board/board-transactions.css", import.meta.url), "utf8"),
  ]);
  assert.match(boardSource, /SALE_SPOTLIGHT_HOLD_MS = 5_000/);
  assert.match(boardSource, /SALE_SPOTLIGHT_FLIGHT_MS = 900/);
  assert.match(boardSource, /SALE_TARGET_PULSE_MS = 2_800/);
  assert.match(boardSource, /candidate\.dataset\.assignmentId === assignmentId/);
  assert.match(boardSource, /calculateSaleFlight\(sourceRect, targetRect\)/);
  assert.match(boardSource, /prefers-reduced-motion: reduce/);
  assert.match(boardSource, /typeof spotlight\.animate !== "function"/);
  assert.match(boardSource, /finishActiveSaleSpotlight\(\{ pulse: false \}\)/);
  assert.match(styles, /\.player-sticker\.is-sale-arrival-pending\{opacity:0\}/);
  assert.match(styles, /\.sale-flight-card\{[^}]*transform-origin:top left/);
});

test("small-screen board names use a readable system face and protected minimum sizes", async () => {
  const styles = await readFile(new URL("../public/thunder-bowl/board/board-legibility.css", import.meta.url), "utf8");
  assert.match(styles, /\.team-header \.team-name \{[\s\S]*font-family: "Segoe UI", Arial, sans-serif;[\s\S]*font-weight: 800;[\s\S]*11px/);
  assert.match(styles, /\.sticker-meta \{[\s\S]*font-weight: 750;[\s\S]*9px/);
  assert.match(styles, /\.player-name \{[\s\S]*font-family: "Segoe UI", Arial, sans-serif;[\s\S]*font-weight: 800;[\s\S]*11px/);
  assert.match(styles, /\.player-name small \{ font-family: inherit; font-weight: 700; \}/);
});
