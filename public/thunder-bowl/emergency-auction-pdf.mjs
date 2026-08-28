import {
  EVENT_TYPES,
  createEvent,
  replayDraft,
  validateDraftPack,
} from "./state-engine.mjs?v=20260828a";
import { calculateAuctionDemandMarket } from "./auction-demand.mjs?v=20260816a";
import {
  applyPriorityVbdOverlay,
  buildPriorityVbdOverlay,
  DEFAULT_PRIORITY_SCENARIO,
} from "./priority-weights.mjs?v=20260810b";

export const EMERGENCY_PDF_LIMIT = 200;
export const EMERGENCY_PDF_ROWS_PER_PAGE = 25;
export const EMERGENCY_PDF_SORT_ORDERS = Object.freeze({
  VALUE: "value",
  ALPHABETICAL: "alphabetical",
});

const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;
const MARGIN = 24;
const COLUMNS = Object.freeze([
  { key: "rank", label: "#", width: 28, align: "right" },
  { key: "position", label: "POS", width: 34 },
  { key: "name", label: "PLAYER", width: 164 },
  { key: "nflTeam", label: "NFL", width: 40 },
  { key: "vbdText", label: "VBD", width: 52, align: "right" },
  { key: "preAuctionText", label: "PRE-$", width: 64, align: "right" },
  { key: "draftedBy", label: "DRAFTED BY", width: 286 },
  { key: "actualPriceText", label: "ACTUAL $", width: 76, align: "center" },
]);

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`);
  return number;
}

function configuredPreAuctionState(config) {
  return replayDraft([
    createEvent(EVENT_TYPES.DRAFT_CONFIGURED, config, { deviceId: "emergency-pdf" }),
  ]);
}

function placementMap(state) {
  const placements = new Map();
  if (!state?.teams) return placements;
  for (const team of Object.values(state.teams)) {
    for (const player of team.roster || []) {
      if (placements.has(player.playerId)) throw new Error(`${player.playerName || player.playerId} has more than one active placement.`);
      const price = finite(player.price, `${player.playerName || player.playerId} placement price`);
      if (!Number.isSafeInteger(price) || price < 1) throw new Error(`${player.playerName || player.playerId} placement price must be a positive whole dollar.`);
      placements.set(player.playerId, {
        teamName: team.name,
        price,
        keeper: player.acquisitionType === "keeper",
      });
    }
  }
  return placements;
}

function valueOrder(left, right) {
  return (
    right.preAuctionValue - left.preAuctionValue
    || right.vbd - left.vbd
    || right.projectedPoints - left.projectedPoints
    || left.name.localeCompare(right.name)
  );
}

function alphabeticalOrder(left, right) {
  return (
    left.name.localeCompare(right.name)
    || left.position.localeCompare(right.position)
    || left.nflTeam.localeCompare(right.nflTeam)
    || left.rank - right.rank
  );
}

export function buildEmergencyAuctionRows({
  pack: packInput,
  priorityScenario = DEFAULT_PRIORITY_SCENARIO,
  weeklyContext = null,
  placementState = null,
  limit = EMERGENCY_PDF_LIMIT,
  sortOrder = EMERGENCY_PDF_SORT_ORDERS.VALUE,
} = {}) {
  const pack = validateDraftPack(packInput);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > EMERGENCY_PDF_LIMIT) {
    throw new Error(`Emergency PDF limit must be an integer from 1-${EMERGENCY_PDF_LIMIT}.`);
  }
  if (!Object.values(EMERGENCY_PDF_SORT_ORDERS).includes(sortOrder)) {
    throw new Error(`Emergency PDF sort order must be ${Object.values(EMERGENCY_PDF_SORT_ORDERS).join(" or ")}.`);
  }
  const overlay = buildPriorityVbdOverlay(pack.players, priorityScenario, weeklyContext || pack.weeklyContext);
  const valuationPack = applyPriorityVbdOverlay(pack, overlay);
  const market = calculateAuctionDemandMarket(valuationPack, configuredPreAuctionState(pack.leagueConfig));
  const valuesById = new Map(valuationPack.players.map((player) => [player.id, player]));
  const placements = placementMap(placementState);
  const rows = pack.players.map((sourcePlayer) => {
    const player = valuesById.get(sourcePlayer.id);
    const preAuctionValue = finite(market.valuesByPlayerId[player.id], `${player.name} pre-auction value`);
    const vbd = finite(player.vbd, `${player.name} VBD`);
    const placement = placements.get(player.id);
    return {
      playerId: player.id,
      position: player.position,
      name: player.name,
      nflTeam: player.nflTeam || "FA",
      projectedPoints: finite(player.projectedPoints, `${player.name} projected points`),
      vbd,
      preAuctionValue,
      draftedBy: placement?.teamName || "",
      actualPrice: placement?.price ?? null,
      keeper: placement?.keeper === true,
    };
  }).sort(valueOrder).slice(0, limit).map((row, index) => ({
    ...row,
    rank: index + 1,
    vbdText: `${row.vbd >= 0 ? "+" : ""}${row.vbd.toFixed(1)}`,
    preAuctionText: `$${Math.round(row.preAuctionValue)}`,
    actualPriceText: row.actualPrice === null ? "" : `${row.keeper ? "K " : ""}$${Math.round(row.actualPrice)}`,
  }));

  if (sortOrder === EMERGENCY_PDF_SORT_ORDERS.ALPHABETICAL) rows.sort(alphabeticalOrder);

  if (rows.length !== limit || new Set(rows.map((row) => row.playerId)).size !== rows.length) {
    throw new Error(`Emergency PDF expected ${limit} unique players but built ${rows.length}.`);
  }
  return rows;
}

function ascii(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^\x20-\x7E]/g, "?");
}

function clipped(value, maximum) {
  const text = ascii(value);
  return text.length <= maximum ? text : `${text.slice(0, Math.max(0, maximum - 3))}...`;
}

function pdfString(value) {
  return `(${ascii(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")})`;
}

function fieldName(prefix, playerId) {
  const safeId = ascii(playerId).replace(/[^A-Za-z0-9_-]/g, "_");
  if (!safeId) throw new Error("Emergency PDF player ID cannot produce an empty form-field name.");
  return `${prefix}_${safeId}`;
}

function text(command, { x, y, size = 9, font = "F1", color = "0.07 0.15 0.25", align = "left", width = 0 }) {
  const averageCharacterWidth = size * 0.52;
  const estimatedWidth = ascii(command).length * averageCharacterWidth;
  const textX = align === "right" ? x + width - estimatedWidth - 4 : align === "center" ? x + (width - estimatedWidth) / 2 : x + 4;
  return `BT /${font} ${size} Tf ${color} rg 1 0 0 1 ${textX.toFixed(2)} ${y.toFixed(2)} Tm ${pdfString(command)} Tj ET`;
}

function rect({ x, y, width, height, fill = null, stroke = null, lineWidth = 0.5 }) {
  const commands = ["q"];
  if (fill) commands.push(`${fill} rg`);
  if (stroke) commands.push(`${stroke} RG ${lineWidth} w`);
  commands.push(`${x} ${y} ${width} ${height} re ${fill && stroke ? "B" : fill ? "f" : "S"}`, "Q");
  return commands.join(" ");
}

function pageContent({ rows, pageNumber, pageCount, season, packId, generatedAt, sortOrder }) {
  const commands = [];
  commands.push(rect({ x: MARGIN, y: 552, width: PAGE_WIDTH - MARGIN * 2, height: 36, fill: "0.035 0.165 0.300" }));
  commands.push(rect({ x: MARGIN, y: 548, width: PAGE_WIDTH - MARGIN * 2, height: 4, fill: "0.965 0.735 0.220" }));
  commands.push(text(`Thunder Bowl ${season} - Emergency Auction Sheet${sortOrder === EMERGENCY_PDF_SORT_ORDERS.ALPHABETICAL ? " - A-Z" : ""}`, { x: MARGIN + 8, y: 568, size: 16, font: "F2", color: "1 1 1" }));
  commands.push(text("Team and Actual $ cells are fillable. Pre-auction values stay frozen; K = keeper.", { x: MARGIN + 8, y: 555.5, size: 7.5, color: "0.86 0.91 0.96" }));
  commands.push(text(sortOrder === EMERGENCY_PDF_SORT_ORDERS.ALPHABETICAL
    ? `Same Top ${EMERGENCY_PDF_LIMIT}, alphabetized by player name (# retains value rank)`
    : `Top ${EMERGENCY_PDF_LIMIT} by blank-room pre-auction value`, { x: MARGIN, y: 533, size: 8.5, font: "F2" }));
  commands.push(text(`Generated ${ascii(generatedAt).replace("T", " ").replace("Z", " UTC")}`, { x: 470, y: 533, size: 7.5 }));

  let x = MARGIN;
  const tableTop = 516;
  const headerHeight = 18;
  const rowHeight = 18;
  commands.push(rect({ x: MARGIN, y: tableTop - headerHeight, width: PAGE_WIDTH - MARGIN * 2, height: headerHeight, fill: "0.87 0.91 0.95", stroke: "0.42 0.52 0.62" }));
  for (const column of COLUMNS) {
    commands.push(text(column.label, { x, y: tableTop - 12.2, width: column.width, size: 7.5, font: "F2", align: column.align }));
    commands.push(`${(x + column.width).toFixed(2)} ${tableTop - headerHeight} m ${(x + column.width).toFixed(2)} ${tableTop} l 0.42 0.52 0.62 RG 0.4 w S`);
    x += column.width;
  }

  rows.forEach((row, index) => {
    const y = tableTop - headerHeight - (index + 1) * rowHeight;
    const fill = index % 2 ? "0.965 0.975 0.985" : "1 1 1";
    commands.push(rect({ x: MARGIN, y, width: PAGE_WIDTH - MARGIN * 2, height: rowHeight, fill, stroke: "0.72 0.78 0.84", lineWidth: 0.35 }));
    let cellX = MARGIN;
    for (const column of COLUMNS) {
      const value = column.key === "name" ? clipped(row[column.key], 31) : row[column.key];
      commands.push(text(value, { x: cellX, y: y + 5.8, width: column.width, size: 9.2, font: column.key === "name" ? "F2" : "F1", align: column.align }));
      commands.push(`${(cellX + column.width).toFixed(2)} ${y} m ${(cellX + column.width).toFixed(2)} ${y + rowHeight} l 0.72 0.78 0.84 RG 0.35 w S`);
      cellX += column.width;
    }
  });

  const footer = `Page ${pageNumber} of ${pageCount}  |  ${clipped(packId, 72)}  |  Paper backup only - obey legal max and roster requirements.`;
  commands.push(text(footer, { x: MARGIN, y: 20, size: 6.8, color: "0.30 0.37 0.44" }));
  return commands.join("\n");
}

function fieldAppearance({ value, width, height, align = "left" }) {
  const display = clipped(value, align === "center" ? 7 : 38);
  const size = 8.5;
  const estimatedWidth = ascii(display).length * size * 0.52;
  const x = align === "center" ? Math.max(3, (width - estimatedWidth) / 2) : 3;
  const stream = [
    "q",
    "0.985 0.99 1 rg 0.25 0.46 0.66 RG 0.7 w",
    `0.35 0.35 ${(width - 0.7).toFixed(2)} ${(height - 0.7).toFixed(2)} re B`,
    `BT /Helv ${size} Tf 0.07 0.15 0.25 rg 1 0 0 1 ${x.toFixed(2)} ${((height - size) / 2 + 1).toFixed(2)} Tm ${pdfString(display)} Tj ET`,
    "Q",
  ].join("\n");
  return `<< /Type /XObject /Subtype /Form /BBox [0 0 ${width.toFixed(2)} ${height.toFixed(2)}] /Resources << /Font << /Helv 3 0 R >> >> /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`;
}

function formFieldObject({ name, tooltip, value, rect: box, pageId, appearanceId, maxLength, align }) {
  return [
    "<< /Type /Annot /Subtype /Widget /FT /Tx",
    `/T ${pdfString(name)} /TU ${pdfString(tooltip)}`,
    `/Rect [${box.map((valuePart) => valuePart.toFixed(2)).join(" ")}] /P ${pageId} 0 R`,
    `/F 4 /Ff 0 /MaxLen ${maxLength} /Q ${align === "center" ? 1 : 0}`,
    `/V ${pdfString(value)} /DV ${pdfString(value)}`,
    "/DA (/Helv 8.5 Tf 0.07 0.15 0.25 rg)",
    "/MK << /BG [0.985 0.99 1] /BC [0.25 0.46 0.66] >> /BS << /W 0.7 /S /S >>",
    `/AP << /N ${appearanceId} 0 R >> >>`,
  ].join(" ");
}

function rowFormFields(row, rowIndex) {
  const y = 516 - 18 - (rowIndex + 1) * 18;
  return [
    {
      name: fieldName("drafted_by", row.playerId),
      tooltip: `${row.name} - winning fantasy team`,
      value: row.draftedBy,
      rect: [408, y + 2, 690, y + 16],
      width: 282,
      height: 14,
      maxLength: 40,
      align: "left",
    },
    {
      name: fieldName("actual_price", row.playerId),
      tooltip: `${row.name} - actual auction price`,
      value: row.actualPrice === null ? "" : String(row.actualPrice),
      rect: [694, y + 2, 766, y + 16],
      width: 72,
      height: 14,
      maxLength: 4,
      align: "center",
    },
  ];
}

function encodePdf(objects, infoId) {
  const encoder = new TextEncoder();
  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];
  let byteOffset = encoder.encode(chunks[0]).length;
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = byteOffset;
    const chunk = `${index} 0 obj\n${objects[index]}\nendobj\n`;
    chunks.push(chunk);
    byteOffset += encoder.encode(chunk).length;
  }
  const xrefOffset = byteOffset;
  const xref = [
    `xref\n0 ${objects.length}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");
  chunks.push(xref);
  return encoder.encode(chunks.join(""));
}

export function createEmergencyAuctionPdf({
  pack,
  priorityScenario = DEFAULT_PRIORITY_SCENARIO,
  weeklyContext = null,
  placementState = null,
  generatedAt = new Date().toISOString(),
  sortOrder = EMERGENCY_PDF_SORT_ORDERS.VALUE,
} = {}) {
  const rows = buildEmergencyAuctionRows({ pack, priorityScenario, weeklyContext, placementState, sortOrder });
  const pages = [];
  for (let index = 0; index < rows.length; index += EMERGENCY_PDF_ROWS_PER_PAGE) {
    pages.push(rows.slice(index, index + EMERGENCY_PDF_ROWS_PER_PAGE));
  }

  const objects = [null, null, null, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"];
  const pageIds = [];
  const fieldIds = [];
  for (let index = 0; index < pages.length; index += 1) {
    const pageId = objects.length;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const content = pageContent({
      rows: pages[index],
      pageNumber: index + 1,
      pageCount: pages.length,
      season: pack.season,
      packId: pack.packId,
      generatedAt,
      sortOrder,
    });
    objects.push(null);
    objects.push(`<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`);
    const pageFieldIds = [];
    pages[index].forEach((row, rowIndex) => {
      rowFormFields(row, rowIndex).forEach((field) => {
        const widgetId = objects.length;
        const appearanceId = widgetId + 1;
        pageFieldIds.push(widgetId);
        fieldIds.push(widgetId);
        objects.push(formFieldObject({ ...field, pageId, appearanceId }));
        objects.push(fieldAppearance(field));
      });
    });
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R /Annots [${pageFieldIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  }
  const infoId = objects.length;
  objects.push(`<< /Title ${pdfString(`Thunder Bowl ${pack.season} Emergency Auction Sheet`)} /Creator ${pdfString("Thunder Bowl Command Center")} /CreationDate ${pdfString(`D:${generatedAt.replace(/[-:TZ.]/g, "").slice(0, 14)}Z`)} >>`);
  objects[1] = `<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [${fieldIds.map((id) => `${id} 0 R`).join(" ")}] /NeedAppearances true /DA (/Helv 8.5 Tf 0.07 0.15 0.25 rg) /DR << /Font << /Helv 3 0 R >> >> >> >>`;
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  return { bytes: encodePdf(objects, infoId), rows, pageCount: pages.length };
}
