const DEFAULT_HEADER_WEIGHT = 1.42;

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function calculateBoardGeometry({
  availableHeight,
  boardWidth,
  teamCount,
  totalRosterRows,
  visibleRosterRows,
  headerWeight = DEFAULT_HEADER_WEIGHT,
}) {
  const height = finiteNonNegative(availableHeight);
  const width = finiteNonNegative(boardWidth);
  const columns = Math.max(1, Math.trunc(finiteNonNegative(teamCount)) || 1);
  const totalRows = Math.max(1, Math.trunc(finiteNonNegative(totalRosterRows)) || 1);
  const rosterRows = Math.max(1, Math.trunc(finiteNonNegative(visibleRosterRows)) || 1);
  const safeHeaderWeight = Math.max(0.5, finiteNonNegative(headerWeight) || DEFAULT_HEADER_WEIGHT);
  const fullGridUnits = totalRows + safeHeaderWeight;
  const visibleGridUnits = Math.min(totalRows, rosterRows) + safeHeaderWeight;
  const boardHeight = Math.min(height, height * visibleGridUnits / fullGridUnits);
  const rowUnit = boardHeight / visibleGridUnits;
  const gridChromeWidth = 2 + Math.max(0, columns - 1);

  return Object.freeze({
    boardHeight,
    rosterRowHeight: rowUnit,
    headerRowHeight: rowUnit * safeHeaderWeight,
    teamColumnWidth: Math.max(0, (width - gridChromeWidth) / columns),
  });
}
