import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { calculateBoardGeometry } from "../public/thunder-bowl/board/board-layout.mjs";

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
