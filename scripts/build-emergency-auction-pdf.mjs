import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EMERGENCY_PDF_SORT_ORDERS,
  createEmergencyAuctionPdf,
} from "../public/thunder-bowl/emergency-auction-pdf.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const packPath = resolve(repoRoot, "netlify/functions/_data/draft-pack-2026-provisional.json");
const valueOutputPath = resolve(repoRoot, process.argv[2] || "output/pdf/thunder-bowl-2026-emergency-auction-sheet.pdf");
const alphabeticalOutputPath = resolve(repoRoot, process.argv[3] || "output/pdf/thunder-bowl-2026-emergency-auction-sheet-alphabetical.pdf");
const pack = JSON.parse(await readFile(packPath, "utf8"));
const valuePdf = createEmergencyAuctionPdf({ pack, generatedAt: pack.asOf });
const alphabeticalPdf = createEmergencyAuctionPdf({
  pack,
  generatedAt: pack.asOf,
  sortOrder: EMERGENCY_PDF_SORT_ORDERS.ALPHABETICAL,
});
await Promise.all([
  mkdir(dirname(valueOutputPath), { recursive: true }),
  mkdir(dirname(alphabeticalOutputPath), { recursive: true }),
]);
await Promise.all([
  writeFile(valueOutputPath, valuePdf.bytes),
  writeFile(alphabeticalOutputPath, alphabeticalPdf.bytes),
]);
console.log(`Built ${valueOutputPath}: ${valuePdf.rows.length} players across ${valuePdf.pageCount} fillable pages.`);
console.log(`Built ${alphabeticalOutputPath}: ${alphabeticalPdf.rows.length} players across ${alphabeticalPdf.pageCount} fillable pages.`);
