import { handlers } from "./_draft-day/configured-server.mjs";

export default async function handler(request) {
  return handlers.commands(request);
}

