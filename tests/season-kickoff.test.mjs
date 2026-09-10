import assert from "node:assert/strict";
import test from "node:test";
import { formatDenverKickoff, normalizedKickoffAt } from "../public/thunder-bowl/season/season-kickoff.mjs";

test("lineup kickoffs display the date and time in Denver", () => {
  assert.equal(normalizedKickoffAt("Sun 1:00pm ET", 1), "2026-09-13T17:00:00.000Z");
  assert.match(formatDenverKickoff({ gameTime: "Sun 1:00pm ET" }, 1), /^Sun, Sep 13, 11:00 AM MDT$/);
  assert.match(formatDenverKickoff({ kickoffAt: "2026-11-08T21:25:00.000Z" }, 9), /^Sun, Nov 8, 2:25 PM MST$/);
});

test("unknown lineup kickoffs stay explicitly unknown", () => {
  assert.equal(formatDenverKickoff({ gameTime: null }, 1), null);
  assert.equal(formatDenverKickoff({ gameTime: "Sun sometime" }, 1), null);
});
