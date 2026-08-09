import test from "node:test";
import assert from "node:assert/strict";
import {
  AUCTIONEER_FEED_POLL_MS,
  MANUAL_ENTRY_POLL_MS,
  SALES_ENTRY_MODES,
  normalizeSalesEntryMode,
  salesEntryPolicy,
} from "../public/thunder-bowl/sales-entry-mode.mjs";

test("the live draft room defaults to the protected auctioneer feed", () => {
  assert.equal(normalizeSalesEntryMode(undefined), SALES_ENTRY_MODES.AUCTIONEER);
  const policy = salesEntryPolicy({ mode: undefined, online: true, cloudReachable: true });
  assert.equal(policy.auctioneer, true);
  assert.equal(policy.manualControlsEnabled, false);
  assert.equal(policy.pollIntervalMs, AUCTIONEER_FEED_POLL_MS);
});

test("manual backup restores local sale controls and retains cloud polling", () => {
  const policy = salesEntryPolicy({ mode: SALES_ENTRY_MODES.MANUAL, online: false, cloudReachable: false });
  assert.equal(policy.manualControlsEnabled, true);
  assert.equal(policy.pollIntervalMs, MANUAL_ENTRY_POLL_MS);
  assert.match(policy.detail, /auctioneer has stopped entering sales/i);
});

test("practice and replay rooms remain manual-only", () => {
  assert.equal(normalizeSalesEntryMode(SALES_ENTRY_MODES.AUCTIONEER, { localOnly: true }), SALES_ENTRY_MODES.MANUAL);
});

test("a broken auctioneer feed gives an explicit manual-fallback instruction", () => {
  const policy = salesEntryPolicy({ mode: SALES_ENTRY_MODES.AUCTIONEER, online: false, cloudReachable: false });
  assert.equal(policy.healthy, false);
  assert.match(policy.detail, /switch to Manual backup/i);
});
