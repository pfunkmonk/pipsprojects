import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEmergencyAuctionPdf } from "../public/thunder-bowl/emergency-auction-pdf.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const packPath = resolve(repoRoot, "netlify/functions/_data/draft-pack-2026-provisional.json");
const outputPath = resolve(repoRoot, process.argv[2] || "output/pdf/thunder-bowl-2026-emergency-auction-sheet.pdf");
const pack = JSON.parse(await readFile(packPath, "utf8"));
const pdf = createEmergencyAuctionPdf({ pack, generatedAt: pack.asOf });
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, pdf.bytes);
console.log(`Built ${outputPath}: ${pdf.rows.length} players across ${pdf.pageCount} pages.`);

