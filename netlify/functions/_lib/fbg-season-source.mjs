import { createHash } from "node:crypto";
import { canonicalPlayerIdentity } from "../../../public/thunder-bowl/state-engine.mjs";

export const FBG_WEEKLY_COLUMNS = Object.freeze([
  "player_id", "player_name", "nfl_team", "position", "week", "projected_points", "floor", "ceiling", "provider_as_of",
]);

function csvRows(text) {
  if (typeof text !== "string" || text.length > 2_000_000) throw new Error("Footballguys import must be a CSV under 2 MB.");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell.trim()); cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim()); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += character;
  }
  if (quoted) throw new Error("Footballguys CSV contains an unterminated quoted field.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function optionalNumber(value, label) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error(`${label} must be blank or from 0 through 100.`);
  return number;
}

export function parseFbgWeeklyCsv(text, pack, { minimumRows = 8 } = {}) {
  const rows = csvRows(text);
  const header = rows.shift()?.map((value) => value.toLowerCase()) || [];
  if (header.join(",") !== FBG_WEEKLY_COLUMNS.join(",")) throw new Error(`Footballguys CSV headers must be exactly ${FBG_WEEKLY_COLUMNS.join(",")}.`);
  const byId = new Map(pack.players.map((player) => [player.id, player]));
  const byIdentity = new Map(pack.players.map((player) => [canonicalPlayerIdentity(player.name, player.position, player.nflTeam), player]));
  const seen = new Set();
  const items = rows.map((cells, index) => {
    if (cells.length !== FBG_WEEKLY_COLUMNS.length) throw new Error(`Footballguys row ${index + 2} has ${cells.length} columns, not ${FBG_WEEKLY_COLUMNS.length}.`);
    const values = Object.fromEntries(FBG_WEEKLY_COLUMNS.map((column, columnIndex) => [column, cells[columnIndex]]));
    const suppliedId = values.player_id.trim();
    const position = values.position.toUpperCase();
    const nflTeam = values.nfl_team.toUpperCase();
    const player = (suppliedId && byId.get(suppliedId)) || byIdentity.get(canonicalPlayerIdentity(values.player_name, position, nflTeam));
    if (!player) throw new Error(`Footballguys row ${index + 2} does not resolve to the governed player catalog.`);
    if (suppliedId && suppliedId !== player.id) throw new Error(`Footballguys row ${index + 2} player id conflicts with its player identity.`);
    const week = Number(values.week);
    if (!Number.isSafeInteger(week) || week < 1 || week > 18) throw new Error(`Footballguys row ${index + 2} has an invalid week.`);
    const key = `${player.id}|${week}`;
    if (seen.has(key)) throw new Error(`Footballguys import repeats ${player.name} Week ${week}.`);
    seen.add(key);
    const points = optionalNumber(values.projected_points, `${player.name} projected points`);
    if (points === null) throw new Error(`${player.name} Week ${week} is missing projected points; omit missing rows instead of writing zero or blank.`);
    const floor = optionalNumber(values.floor, `${player.name} floor`);
    const ceiling = optionalNumber(values.ceiling, `${player.name} ceiling`);
    if (floor !== null && floor > points) throw new Error(`${player.name} floor cannot exceed its projection.`);
    if (ceiling !== null && ceiling < points) throw new Error(`${player.name} ceiling cannot be below its projection.`);
    if (!Number.isFinite(Date.parse(values.provider_as_of)) || Date.parse(values.provider_as_of) > Date.now() + 24 * 60 * 60_000) throw new Error(`Footballguys row ${index + 2} has an invalid provider timestamp.`);
    return { playerId: player.id, playerName: player.name, position: player.position, nflTeam, week, points, floor, ceiling, providerAsOf: new Date(values.provider_as_of).toISOString() };
  });
  if (items.length < minimumRows || items.length > pack.players.length * 18) throw new Error(`Footballguys import has unexpected coverage (${items.length} rows).`);
  const weeks = [...new Set(items.map((item) => item.week))];
  if (weeks.length !== 1) throw new Error("A Footballguys import must contain exactly one NFL week.");
  const capturedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    season: pack.season,
    week: weeks[0],
    source: "Footballguys owner-exported weekly projections",
    authority: "registered projection input; user-triggered import",
    capturedAt,
    providerAsOf: items.map((item) => item.providerAsOf).sort().at(-1),
    rawSha256: createHash("sha256").update(text).digest("hex"),
    itemCount: items.length,
    items,
  };
}

export function validateFbgWeeklySnapshot(value, pack) {
  if (!value || value.schemaVersion !== 1 || value.season !== pack.season || !Number.isSafeInteger(value.week) || value.week < 1 || value.week > 18) throw new Error("Footballguys weekly snapshot failed its source contract.");
  if (!Number.isFinite(Date.parse(value.capturedAt)) || !Number.isFinite(Date.parse(value.providerAsOf)) || Date.parse(value.providerAsOf) > Date.now() + 24 * 60 * 60_000 || !/^[a-f0-9]{64}$/.test(value.rawSha256 || "")) throw new Error("Footballguys weekly provenance is invalid.");
  if (!Array.isArray(value.items) || value.items.length !== value.itemCount) throw new Error("Footballguys weekly coverage does not reconcile.");
  const known = new Set(pack.players.map((player) => player.id));
  const ids = new Set();
  for (const item of value.items) {
    if (!known.has(item.playerId) || item.week !== value.week || !Number.isFinite(item.points) || item.points < 0) throw new Error("Footballguys weekly snapshot contains an invalid row.");
    if (ids.has(item.playerId)) throw new Error("Footballguys weekly snapshot repeats a player.");
    ids.add(item.playerId);
  }
  return value;
}
