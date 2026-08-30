import { refreshSeasonPlan } from "./_lib/season-service.mjs";

export default async function handler() {
  const result = await refreshSeasonPlan();
  return Response.json({ week: result.week, state: result.plan.state, sourceFingerprint: result.plan.sourceFingerprint, generatedAt: result.plan.generatedAt });
}

export const config = { schedule: "17 */3 * * *" };
