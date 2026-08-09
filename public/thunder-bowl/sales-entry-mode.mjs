export const SALES_ENTRY_MODES = Object.freeze({
  AUCTIONEER: "auctioneer",
  MANUAL: "manual",
});

export const AUCTIONEER_FEED_POLL_MS = 1500;
export const MANUAL_ENTRY_POLL_MS = 4000;

export function normalizeSalesEntryMode(value, { localOnly = false } = {}) {
  if (localOnly) return SALES_ENTRY_MODES.MANUAL;
  return value === SALES_ENTRY_MODES.MANUAL ? SALES_ENTRY_MODES.MANUAL : SALES_ENTRY_MODES.AUCTIONEER;
}

export function salesEntryPolicy({ mode, localOnly = false, online = true, cloudReachable = true, lastSale = null } = {}) {
  const normalizedMode = normalizeSalesEntryMode(mode, { localOnly });
  const auctioneer = normalizedMode === SALES_ENTRY_MODES.AUCTIONEER;
  let detail;
  if (!auctioneer) {
    detail = "Manual backup is active. Confirm the auctioneer has stopped entering sales before you record one here.";
  } else if (!online || !cloudReachable) {
    detail = "Auctioneer feed is unavailable. If bidding continues, switch to Manual backup and record sales on this screen.";
  } else if (lastSale) {
    detail = `Live feed checked every 1.5 seconds. Last confirmed: ${lastSale.playerName} to ${lastSale.teamName} for $${lastSale.amount}.`;
  } else {
    detail = "Live feed checked every 1.5 seconds. Waiting for the first confirmed sale.";
  }
  return {
    mode: normalizedMode,
    auctioneer,
    manualControlsEnabled: !auctioneer,
    pollIntervalMs: auctioneer ? AUCTIONEER_FEED_POLL_MS : MANUAL_ENTRY_POLL_MS,
    title: auctioneer ? "Auctioneer is entering sales" : "I am entering sales",
    detail,
    healthy: auctioneer ? Boolean(online && cloudReachable) : true,
  };
}
