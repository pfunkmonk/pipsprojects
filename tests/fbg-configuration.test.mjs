import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FBG_AUCTION_VALUE_CONFIGURATION,
  fbgAuctionValueCompatibilityText,
} from "../public/thunder-bowl/fbg-configuration.mjs";

const importerSource = await readFile(new URL("../scripts/import-fbg-auction-values.py", import.meta.url), "utf8");

test("FBG auction values disclose every audited configuration mismatch and have no model authority", () => {
  assert.equal(FBG_AUCTION_VALUE_CONFIGURATION.status, "incompatible_with_thunder_bowl");
  assert.equal(FBG_AUCTION_VALUE_CONFIGURATION.modelEffect, "none");
  assert.equal(FBG_AUCTION_VALUE_CONFIGURATION.issueCount, 23);
  assert.equal(FBG_AUCTION_VALUE_CONFIGURATION.issues.length, 23);
  assert.match(fbgAuctionValueCompatibilityText(), /differs from Thunder Bowl in 23 roster\/scoring fields/);
  assert.match(fbgAuctionValueCompatibilityText(), /raw dollars are not Thunder Bowl-compatible/);
});

test("FBG importer fails closed unless a configuration mismatch is explicitly quarantined", () => {
  assert.match(importerSource, /parser\.add_argument\("--ddf", required=True/);
  assert.match(importerSource, /parser\.add_argument\("--allow-config-mismatch", action="store_true"\)/);
  assert.match(importerSource, /configuration_issues and not args\.allow_config_mismatch/);
  assert.match(importerSource, /raw dollars are incompatible/);
});
