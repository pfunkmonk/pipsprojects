import { assertSameOrigin, verifySession } from "./_lib/auth.mjs";
import { refreshSeasonPlan } from "./_lib/season-service.mjs";

export default async function handler(request) {
  if (request.method !== "POST") throw new Error("Method not allowed.");
  if (!verifySession(request)) throw new Error("Authentication required.");
  assertSameOrigin(request);
  const input = await request.json();
  if (!input || input.action !== "rebuild-plan" || Object.keys(input).length !== 1) throw new Error("Background rebuild request is invalid.");
  const startedAt = Date.now();
  console.info("Thunder Bowl background recommendation rebuild started");
  const result = await refreshSeasonPlan();
  console.info(`Thunder Bowl background recommendation rebuild completed in ${Date.now() - startedAt} ms for Week ${result.week}`);
}
