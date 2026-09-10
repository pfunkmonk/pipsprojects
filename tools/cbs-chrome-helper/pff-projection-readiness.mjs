const REQUIRED_COLUMNS = ["PLAYER", "TEAM", "POS", "PTS"];

export function pffProjectionTableReady(input = {}) {
  const heading = String(input.heading || "").replace(/\s+/g, " ").trim().toUpperCase();
  const playerLinkCount = Number(input.playerLinkCount || 0);
  const identityRowCount = Number(input.identityRowCount || 0);
  const statRowCount = Number(input.statRowCount || 0);
  const columns = new Set((input.columnLabels || []).map((label) => String(label || "").trim().toUpperCase()));
  return heading === "FANTASY FOOTBALL PROJECTIONS"
    && playerLinkCount >= 20
    && identityRowCount >= 20
    && statRowCount >= 20
    && REQUIRED_COLUMNS.every((column) => columns.has(column));
}
