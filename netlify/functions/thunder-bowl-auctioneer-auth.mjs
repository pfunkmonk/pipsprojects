import { handlers } from "./_auctioneer/configured-server.mjs";

export default async function handler(request) {
  return handlers.auth(request);
}

export const config = {
  path: ["/api/thunder-bowl/auctioneer/auth", "/.netlify/functions/thunder-bowl-auctioneer-auth"],
  rateLimit: {
    windowLimit: 15,
    windowSize: 180,
    aggregateBy: ["ip", "domain"],
  },
};
