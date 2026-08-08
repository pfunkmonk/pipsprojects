import { handlers } from "./_auctioneer/configured-server.mjs";

export default async function handler(request) {
  return handlers.boardSnapshot(request);
}
