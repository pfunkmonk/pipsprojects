// Microsoft OAuth callback for "Connect Outlook". The admin page gets the authorize URL from the admin function,
// Microsoft sends the browser back here, and we store the refresh token so the mailer can send as that mailbox.
// Deployed with --no-verify-jwt (Microsoft calls it). The state nonce is the guard.
import { admin, json, MS_SCOPES, SITE_URL, SUPABASE_URL, setting } from "../_shared/deps.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (!url.pathname.endsWith("/callback")) return json({ error: "not found" }, 404);

  const site = (await setting("site_url")) ?? SITE_URL;
  const back = (q: string) => Response.redirect(site + (site.includes("?") ? "&" : "?") + q, 302);

  const err = url.searchParams.get("error");
  if (err) return back(`outlook=error&msg=${encodeURIComponent(url.searchParams.get("error_description") ?? err)}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const { data: st } = await admin.from("settings").select("value").eq("key", "ms_oauth_state").maybeSingle();
  const saved = st ? JSON.parse(st.value) : null;
  if (!code || !saved || saved.state !== state || Date.now() > saved.exp) {
    return back(`outlook=error&msg=${encodeURIComponent("That sign-in expired. Click Connect Outlook again.")}`);
  }
  await admin.from("settings").delete().eq("key", "ms_oauth_state");

  const tenant = Deno.env.get("MS_TENANT_ID")!;
  const body = new URLSearchParams({
    client_id: Deno.env.get("MS_CLIENT_ID")!,
    client_secret: Deno.env.get("MS_CLIENT_SECRET")!,
    grant_type: "authorization_code",
    code,
    redirect_uri: `${SUPABASE_URL}/functions/v1/ms-auth/callback`,
    scope: MS_SCOPES,
  });
  const tr = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, { method: "POST", body });
  const tok = await tr.json();
  if (!tr.ok || !tok.access_token || !tok.refresh_token) {
    console.error("token exchange failed", tok);
    return back(`outlook=error&msg=${encodeURIComponent(tok.error_description ?? "Microsoft didn't return a token.")}`);
  }

  const mr = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName", { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const meInfo = await mr.json();
  const mailbox = meInfo.mail ?? meInfo.userPrincipalName ?? null;

  const { error } = await admin.from("mail_accounts").upsert({
    id: 1, provider: "microsoft", mailbox, display_name: meInfo.displayName ?? null,
    refresh_token: tok.refresh_token, access_token: tok.access_token,
    expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
    connected_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString(),
  });
  if (error) return back(`outlook=error&msg=${encodeURIComponent(error.message)}`);
  await admin.from("audit_log").insert({ actor: saved.by, action: "outlook.connect", detail: { mailbox } });
  return back("outlook=connected");
});
