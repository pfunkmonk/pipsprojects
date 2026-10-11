// Delivers queued rows from mail_outbox. Called every minute by pg_cron (see call_mail_worker in the migration)
// and inline by the admin function after it queues something. Deployed with --no-verify-jwt; guarded by CRON_SECRET.
import { json, processOutbox } from "../_shared/mailer.ts";

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "forbidden" }, 403);
  try {
    const result = await processOutbox(25);
    return json(result);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
