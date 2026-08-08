import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createPlayerAnnotation,
  isEmptyAnnotation,
  personalBidLimit,
  playerTagSort,
  priceSignal,
  validatePlayerAnnotation,
  validatePlayerAnnotations,
} from "../public/thunder-bowl/player-annotations.mjs";

const indexHtml = await readFile(new URL("../public/thunder-bowl/index.html", import.meta.url), "utf8");
const appSource = await readFile(new URL("../public/thunder-bowl/app.mjs", import.meta.url), "utf8");

test("player decisions are exact, dated, and whole-dollar validated", () => {
  const annotation = createPlayerAnnotation(
    { tag: "target", stealPrice: "17", personalMax: "26", note: "Push only if RB need remains." },
    "2026-08-03T20:00:00.000Z",
  );
  assert.deepEqual(validatePlayerAnnotation(annotation), annotation);
  assert.equal(annotation.stealPrice, 17);
  assert.equal(annotation.personalMax, 26);
  assert.throws(() => createPlayerAnnotation({ stealPrice: 27, personalMax: 26 }), /cannot be higher/);
  assert.throws(() => createPlayerAnnotation({ tag: "favorite" }), /Target, Avoid, or Neutral/);
  assert.throws(() => validatePlayerAnnotation({ ...annotation, modelBoost: 1.2 }), /schema mismatch/);
});

test("personal prices can only lower the model/legal limit and never alter VBD", () => {
  const annotation = createPlayerAnnotation({ tag: "target", stealPrice: 18, personalMax: 27 });
  assert.equal(personalBidLimit({ modelMax: 40, legalMax: 35, annotation }), 27);
  assert.equal(personalBidLimit({ modelMax: 22, legalMax: 35, annotation }), 22);
  assert.equal(personalBidLimit({ modelMax: 40, legalMax: 20, annotation }), 20);
  assert.equal("vbd" in annotation, false);
  assert.equal("marketValue" in annotation, false);
  assert.equal(priceSignal(18, annotation), "steal");
  assert.equal(priceSignal(28, annotation), "over-max");
});

test("targets sort first, avoids last, and empty neutral decisions disappear", () => {
  assert.ok(playerTagSort("target") < playerTagSort("neutral"));
  assert.ok(playerTagSort(undefined) < playerTagSort("avoid"));
  assert.equal(isEmptyAnnotation(createPlayerAnnotation()), true);
  assert.equal(isEmptyAnnotation(createPlayerAnnotation({ note: "watch camp" })), false);
});

test("annotation maps reject malformed rows and drop stale player ids", () => {
  const good = createPlayerAnnotation({ tag: "avoid", personalMax: 3 });
  assert.deepEqual(validatePlayerAnnotations({ alpha: good, stale: good }, ["alpha"]), { alpha: good });
  assert.throws(() => validatePlayerAnnotations([]), /player-keyed object/);
  assert.throws(() => validatePlayerAnnotations({ "bad id": good }), /invalid player identifier/);
});

test("right-click intelligence and offline-shared preferences are wired into the draft UI", () => {
  for (const id of [
    "player-intel-dialog",
    "player-intel-form",
    "intel-news-link",
    "intel-cbs-link",
    "intel-fbg-link",
    "intel-steal-price",
    "intel-personal-max",
    "intel-personal-note",
  ]) assert.match(indexHtml, new RegExp(`id="${id}"`));
  assert.match(appSource, /playerRows\.addEventListener\("contextmenu"/);
  assert.match(appSource, /localStorage\.setItem\(PLAYER_ANNOTATIONS_KEY/);
  assert.match(appSource, /PERSONAL_AVOID/);
  assert.match(appSource, /PERSONAL_MAX/);
  assert.doesNotMatch(appSource, /annotation.*vbd\s*=/i);
});
