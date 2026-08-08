import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { replayDraft, validateRecoveryBundle } from "../public/thunder-bowl/state-engine.mjs";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Usage: node scripts/validate-thunder-recovery.mjs <recovery.json>");

const bundle = validateRecoveryBundle(JSON.parse(await readFile(resolve(inputPath), "utf8")));
const state = replayDraft(bundle.events);
const lastSale = [...bundle.events].reverse().find((event) => event.type === "PLAYER_SOLD");
const soldPlayers = state.totalPlayers;
const roomCash = Object.values(state.teams).reduce((total, team) => total + team.cash, 0);

console.log(JSON.stringify({
  valid: true,
  packId: bundle.pack.packId,
  playersInPack: bundle.pack.players.length,
  events: bundle.events.length,
  soldPlayers,
  roomCash,
  nextNominator: state.teams[state.currentNominatorTeamId].name,
  lastSale: lastSale ? {
    player: lastSale.payload.playerName,
    team: state.teams[lastSale.payload.teamId].name,
    amount: lastSale.payload.amount,
  } : null,
}, null, 2));
