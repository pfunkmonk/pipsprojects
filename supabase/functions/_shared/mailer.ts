// One mailer for every email the system sends.
//   1. If Mike has connected his Outlook mailbox (mail_accounts row), send through Microsoft Graph as that mailbox.
//   2. Otherwise fall back to Resend from the pipsprojects.com sender.
// Callers never pick a provider; they just call sendMail().
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SITE_URL = Deno.env.get("SITE_URL") ?? "https://pipsprojects.com/signing-sessions/";

export const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type Mail = { to: string; toName?: string | null; subject: string; html: string; text: string };

const MS_TENANT = Deno.env.get("MS_TENANT_ID") ?? "";
const MS_CLIENT_ID = Deno.env.get("MS_CLIENT_ID") ?? "";
const MS_CLIENT_SECRET = Deno.env.get("MS_CLIENT_SECRET") ?? "";
export const MS_SCOPES = "offline_access Mail.Send User.Read";

export async function setting(key: string): Promise<string | null> {
  const { data } = await admin.from("settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

export async function sendMail(m: Mail): Promise<{ provider: string }> {
  const { data: acct } = await admin.from("mail_accounts").select("*").eq("id", 1).maybeSingle();
  if (acct?.refresh_token) {
    try {
      await sendViaGraph(acct, m);
      return { provider: `microsoft:${acct.mailbox}` };
    } catch (e) {
      // record it and fall through to Resend so the email still goes out
      await admin.from("mail_accounts").update({ last_error: String(e).slice(0, 500), updated_at: new Date().toISOString() }).eq("id", 1);
      console.error("graph send failed, falling back to resend:", e);
    }
  }
  await sendViaResend(m);
  return { provider: "resend" };
}

// --- Microsoft Graph (delegated, refresh-token flow) ------------------------------------------------------------
export async function refreshGraphToken(acct: { refresh_token: string }) {
  const body = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    client_secret: MS_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: acct.refresh_token,
    scope: MS_SCOPES,
  });
  const r = await fetch(`https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`, { method: "POST", body });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`token refresh failed: ${j.error_description ?? JSON.stringify(j)}`);
  const expires_at = new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString();
  await admin.from("mail_accounts").update({
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? acct.refresh_token, // Microsoft rotates refresh tokens
    expires_at,
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
  return j.access_token as string;
}

async function graphAccessToken(acct: { access_token?: string | null; expires_at?: string | null; refresh_token: string }) {
  if (acct.access_token && acct.expires_at && new Date(acct.expires_at).getTime() - Date.now() > 120_000) return acct.access_token;
  return await refreshGraphToken(acct);
}

async function sendViaGraph(acct: any, m: Mail) {
  const token = await graphAccessToken(acct);
  const r = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: m.subject,
        body: { contentType: "HTML", content: m.html },
        toRecipients: [{ emailAddress: { address: m.to, name: m.toName ?? undefined } }],
      },
      saveToSentItems: true,
    }),
  });
  if (r.status !== 202) throw new Error(`graph sendMail ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

// --- Resend fallback --------------------------------------------------------------------------------------------
async function sendViaResend(m: Mail) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("no mail provider configured (RESEND_API_KEY missing and Outlook not connected)");
  const from = (await setting("fallback_from")) ?? "Signing Sessions <signing@pipsprojects.com>";
  const replyTo = await setting("fallback_reply_to");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [m.toName ? `${m.toName} <${m.to}>` : m.to],
      subject: m.subject,
      html: m.html,
      text: m.text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

// --- Outbox delivery (shared by the cron worker and the admin function) ------------------------------------------
import { render } from "./templates.ts";

export async function processOutbox(limit = 25): Promise<{ sent: number; failed: number }> {
  const { data: rows, error } = await admin
    .from("mail_outbox").select("*").eq("status", "queued").lt("attempts", 5)
    .order("created_at", { ascending: true }).limit(limit);
  if (error) throw error;
  let sent = 0, failed = 0;
  for (const row of rows ?? []) {
    try {
      const mail = render(row.kind, row.payload ?? {}, { to: row.to_email, toName: row.to_name });
      const { provider } = await sendMail(mail);
      await admin.from("mail_outbox").update({ status: "sent", provider, sent_at: new Date().toISOString(), attempts: row.attempts + 1, last_error: null }).eq("id", row.id);
      sent++;
    } catch (e) {
      const attempts = row.attempts + 1;
      await admin.from("mail_outbox").update({ attempts, last_error: String(e).slice(0, 500), status: attempts >= 5 ? "failed" : "queued" }).eq("id", row.id);
      failed++;
      console.error(`outbox ${row.id} (${row.kind}) failed:`, e);
    }
  }
  return { sent, failed };
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });
}
