export function fantasyProsProjectionTableReady(state, expectedHeaders, position) {
  const minimumRows = position === "k" || position === "dst" ? 30 : 50;
  return Boolean(
    state?.pageMatches
    && state.rowCount >= minimumRows
    && Array.isArray(state.headers)
    && state.headers.join("|") === expectedHeaders.join("|"),
  );
}
