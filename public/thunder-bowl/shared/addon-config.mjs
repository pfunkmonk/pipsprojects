export const ADDON_CONFIG = Object.freeze({
  auctioneerAuthUrl: "/api/thunder-bowl/auctioneer/auth",
  auctioneerSnapshotUrl: "/api/thunder-bowl/auctioneer/snapshot",
  auctioneerCommandsUrl: "/api/thunder-bowl/auctioneer/commands",
  boardSnapshotUrl: "/api/thunder-bowl/board/snapshot",
  pollIntervalMs: 1500,
});

export function demoMode() {
  return new URLSearchParams(window.location.search).get("demo") === "1";
}
