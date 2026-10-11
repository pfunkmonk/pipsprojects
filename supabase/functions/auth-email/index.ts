// Supabase Auth "Send Email" hook: every sign-in link Supabase would send comes here instead, so it goes out
// through the same mailer (Outlook when connected, Resend otherwise) with the firm's look.
// Deployed with --no-verify-jwt; the request is authenticated by the Standard Webhooks signature.
import { Webhook } from "npm:standardwebhooks@1.0.0";
import { admin, json, render, sendMail, SUPABASE_URL, setting } from "../_shared/deps.ts";

Deno.serve(async (req) => {
  const raw = Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "";
  const secret = raw.replace(/^v1,whsec_/, "");
  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  let data: any;
  try {
    data = new Webhook(secret).verify(payload, headers);
  } catch (e) {
    console.error("bad signature", e);
    return json({ error: { http_code: 401, message: "bad signature" } }, 401);
  }

  const email: string = data.user?.email ?? "";
  const ed = data.email_data ?? {};
  const type: string = ed.email_action_type ?? "magiclink";

  const { data: person } = await admin.from("people").select("full_name,status").eq("id", data.user?.id).maybeSingle();
  if (!person) {
    // not invited — say nothing useful to the requester
    return json({ error: { http_code: 403, message: "That email isn't on the list. Ask Mike for an invite." } }, 403);
  }
  if (person.status === "inactive") {
    return json({ error: { http_code: 403, message: "Your account is inactive. Contact Mike." } }, 403);
  }

  if (!["magiclink", "recovery", "email", "signup", "invite"].includes(type)) {
    // email_change etc. are not part of this app; refuse quietly
    return json({ error: { http_code: 400, message: `unsupported email type ${type}` } }, 400);
  }

  const site = (await setting("site_url")) ?? "https://pipsprojects.com/signing-sessions/";
  const redirect = ed.redirect_to || site;
  const verifyType = type === "email" ? "magiclink" : type;
  const link = `${SUPABASE_URL}/auth/v1/verify?token=${encodeURIComponent(ed.token_hash)}&type=${verifyType}&redirect_to=${encodeURIComponent(redirect)}`;

  const mail = render("signin", { person_name: person.full_name, link, code: ed.token, site_url: site }, { to: email, toName: person.full_name });
  try {
    const { provider } = await sendMail(mail);
    await admin.from("mail_outbox").insert({ kind: "signin", to_email: email, to_name: person.full_name, payload: { type }, status: "sent", provider, attempts: 1, sent_at: new Date().toISOString() });
  } catch (e) {
    console.error("signin mail failed", e);
    await admin.from("mail_outbox").insert({ kind: "signin", to_email: email, to_name: person.full_name, payload: { type }, status: "failed", attempts: 1, last_error: String(e).slice(0, 500) });
    return json({ error: { http_code: 500, message: "Couldn't send the email. Try again in a minute." } }, 500);
  }
  return json({});
});
