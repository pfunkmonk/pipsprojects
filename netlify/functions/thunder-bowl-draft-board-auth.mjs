import { handlers } from "./_auctioneer/configured-server.mjs";

export default async function handler(request) {
  return handlers.draftBoardAuth(request);
}

export const config = {
  path: ["/api/thunder-bowl/draft-board/auth", "/.netlify/functions/thunder-bowl-draft-board-auth"],
  rateLimit: {
    windowLimit: 60,
    windowSize: 180,
    aggregateBy: ["ip", "domain"],
  },
};
