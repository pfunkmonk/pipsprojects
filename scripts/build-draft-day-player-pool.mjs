import { readFile, writeFile } from "node:fs/promises";

const sourceUrl = new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url);
const outputUrl = new URL("../public/draft-day/player-pool.json", import.meta.url);
const source = JSON.parse(await readFile(sourceUrl, "utf8"));
const seen = new Set();
const players = source.players.map((player, index) => {
  let id = String(player.id || `player-${index + 1}`).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
  if (id.length < 2) id = `player-${index + 1}`;
  while (seen.has(id)) id = `${id}-${index + 1}`;
  seen.add(id);
  return { id, name: player.name, position: player.position, nflTeam: player.nflTeam || "FA" };
}).sort((left, right) => left.name.localeCompare(right.name) || left.position.localeCompare(right.position));
await writeFile(outputUrl, `${JSON.stringify(players, null, 2)}\n`, "utf8");
console.log(`Built public-only Draft Day player pool with ${players.length} players.`);

