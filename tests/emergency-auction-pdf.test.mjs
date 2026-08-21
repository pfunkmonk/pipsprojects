import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EMERGENCY_PDF_LIMIT,
  EMERGENCY_PDF_ROWS_PER_PAGE,
  buildEmergencyAuctionRows,
  createEmergencyAuctionPdf,
} from "../public/thunder-bowl/emergency-auction-pdf.mjs";

const pack = JSON.parse(await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8"));
const indexHtml = await readFile(new URL("../public/thunder-bowl/index.html", import.meta.url), "utf8");
const appSource = await readFile(new URL("../public/thunder-bowl/app.mjs", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../public/thunder-bowl/service-worker.js", import.meta.url), "utf8");

test("emergency auction rows freeze the top 200 blank-room values in deterministic order", () => {
  const rows = buildEmergencyAuctionRows({ pack });
  assert.equal(rows.length, EMERGENCY_PDF_LIMIT);
  assert.equal(new Set(rows.map((row) => row.playerId)).size, EMERGENCY_PDF_LIMIT);
  rows.forEach((row, index) => {
    assert.equal(row.rank, index + 1);
    assert.match(row.position, /^(QB|RB|WR|TE|K|DST)$/);
    assert.ok(Number.isFinite(row.vbd));
    assert.ok(Number.isSafeInteger(row.preAuctionValue));
    assert.ok(row.preAuctionValue >= 1);
    assert.equal(row.draftedBy, "");
    assert.equal(row.actualPrice, null);
    if (index) {
      const prior = rows[index - 1];
      assert.ok(
        prior.preAuctionValue > row.preAuctionValue
          || (prior.preAuctionValue === row.preAuctionValue && prior.vbd >= row.vbd),
        `${prior.name} must not sort behind ${row.name}`,
      );
    }
  });
});

test("existing keepers and sales prefill writing columns without changing the pre-auction ranking", () => {
  const baseline = buildEmergencyAuctionRows({ pack });
  const top = baseline[0];
  const placementState = {
    teams: {
      "dogs-of-war": {
        name: "Dogs of War",
        roster: [{
          playerId: top.playerId,
          playerName: top.name,
          price: 4,
          acquisitionType: "keeper",
        }],
      },
    },
  };
  const placed = buildEmergencyAuctionRows({ pack, placementState });
  assert.deepEqual(
    placed.map(({ playerId, rank, vbd, preAuctionValue }) => ({ playerId, rank, vbd, preAuctionValue })),
    baseline.map(({ playerId, rank, vbd, preAuctionValue }) => ({ playerId, rank, vbd, preAuctionValue })),
  );
  assert.equal(placed[0].draftedBy, "Dogs of War");
  assert.equal(placed[0].actualPriceText, "K $4");
});

test("emergency PDF is an offline-safe eight-page landscape document with no private strategy fields", () => {
  const result = createEmergencyAuctionPdf({ pack, generatedAt: "2026-08-21T15:00:00.000Z" });
  const source = new TextDecoder().decode(result.bytes);
  assert.equal(result.pageCount, Math.ceil(EMERGENCY_PDF_LIMIT / EMERGENCY_PDF_ROWS_PER_PAGE));
  assert.match(source, /^%PDF-1\.4/);
  assert.match(source, /\/MediaBox \[0 0 792 612\]/);
  assert.match(source, /\/Count 8/);
  assert.match(source, /Emergency Auction Sheet/);
  assert.match(source, /DRAFTED BY/);
  assert.match(source, /ACTUAL \$/);
  assert.match(source, /Jahmyr Gibbs/);
  assert.doesNotMatch(source, /personalMaximum|runnerUp|privateAuctionTelemetry|playerAnnotations/);
});

test("Admin exposes and offline-caches the emergency PDF exporter", () => {
  assert.match(indexHtml, /id="export-emergency-auction-pdf"/);
  assert.match(indexHtml, /Top-200 emergency auction sheet/);
  assert.match(appSource, /createEmergencyAuctionPdf\(\{/);
  assert.match(serviceWorker, /emergency-auction-pdf\.mjs\?v=20260821a/);
});

