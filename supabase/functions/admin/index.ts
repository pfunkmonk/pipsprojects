// Admin-only actions that need the service role: inviting people (auth users), role/status changes that touch
// auth, broadcast email, and the Outlook connection. Everything else the admin does is a plain table write
// under RLS from the page. Requires a signed-in admin (people.is_admin, status active).
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { admin, json, processOutbox, MS_SCOPES, SITE_URL, SUPABASE_URL, setting } from "../_shared/deps.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROLE_LABEL: Record<string, string> = { notary: "notary", witness: "witness" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, cors);

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Not signed in." }, 401, cors);
  const { data: me } = await admin.from("people").select("*").eq("id", user.id).maybeSingle();
  if (!me?.is_admin || me.status !== "active") return json({ error: "Admins only." }, 403, cors);

  const body = await req.json().catch(() => ({}));
  try {
    const out = await handle(String(body.action ?? ""), body, me);
    return json(out ?? { ok: true }, 200, cors);
  } catch (e: any) {
    console.error(body.action, e);
    return json({ error: String(e?.message ?? e) }, 400, cors);
  }
});

async function audit(actor: string, action: string, detail: unknown) {
  await admin.from("audit_log").insert({ actor, action, detail });
}

async function siteUrl() {
  return (await setting("site_url")) ?? SITE_URL;
}

// Build a one-click sign-in link for an invite (24-hour magic link) and queue the invite email.
async function queueInvite(person: { id: string; email: string; full_name: string; role: string }) {
  const site = await siteUrl();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: person.email, options: { redirectTo: site } });
  if (error) throw error;
  const link = `${SUPABASE_URL}/auth/v1/verify?token=${encodeURIComponent(data.properties.hashed_token)}&type=magiclink&redirect_to=${encodeURIComponent(site)}`;
  const { data: row, error: qe } = await admin.from("mail_outbox").insert({
    kind: "invite", to_email: person.email, to_name: person.full_name,
    payload: { person_name: person.full_name, link, role: person.role, role_label: ROLE_LABEL[person.role] ?? person.role, site_url: site },
  }).select("id").single();
  if (qe) throw qe;
  await processOutbox(5);
  const { data: after } = await admin.from("mail_outbox").select("status,provider,last_error").eq("id", row.id).single();
  await admin.from("people").update({ invited_at: new Date().toISOString() }).eq("id", person.id);
  return after;
}

async function handle(action: string, b: any, me: any) {
  switch (action) {
    case "invite": {
      const email = String(b.email ?? "").trim().toLowerCase();
      const full_name = String(b.full_name ?? "").trim();
      const role = b.role === "notary" ? "notary" : "witness";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
      if (!full_name) throw new Error("Enter the person's name.");

      let { data: userId } = await admin.rpc("user_id_by_email", { p_email: email });
      if (!userId) {
        const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name } });
        if (error) throw error;
        userId = data.user.id;
      } else {
        await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
      }
      const { data: existing } = await admin.from("people").select("*").eq("id", userId).maybeSingle();
      const status = existing?.status === "active" ? "active" : "invited";
      const { data: person, error: pe } = await admin.from("people").upsert({ id: userId, email, full_name, role, status }).select("*").single();
      if (pe) throw pe;
      const delivery = await queueInvite(person);
      await audit(me.id, "person.invite", { person_id: person.id, email, role, delivery });
      return { ok: true, person, delivery };
    }

    case "resend_invite": {
      const { data: person } = await admin.from("people").select("*").eq("id", b.person_id).single();
      if (!person) throw new Error("No such person.");
      if (person.status === "inactive") throw new Error("Reactivate them first.");
      const delivery = await queueInvite(person);
      await audit(me.id, "person.resend_invite", { person_id: person.id, delivery });
      return { ok: true, delivery };
    }

    case "set_role": {
      const role = b.role === "notary" ? "notary" : "witness";
      const { data: person, error } = await admin.from("people").update({ role }).eq("id", b.person_id).select("*").single();
      if (error) throw error;
      let conflicts: string[] = [];
      if (role === "witness") {
        const { data } = await admin.rpc("future_notary_spots", { p_person: person.id });
        conflicts = (data ?? []).map((r: any) => r.session_date);
      }
      await audit(me.id, "person.set_role", { person_id: person.id, role, conflicts });
      return { ok: true, person, conflicts };
    }

    case "set_status": {
      const status = b.status === "inactive" ? "inactive" : "active";
      const { data: person, error } = await admin.from("people").update({ status }).eq("id", b.person_id).select("*").single();
      if (error) throw error;
      await admin.auth.admin.updateUserById(person.id, { ban_duration: status === "inactive" ? "876000h" : "none" });
      await audit(me.id, "person.set_status", { person_id: person.id, status });
      return { ok: true, person };
    }

    case "rename": {
      const full_name = String(b.full_name ?? "").trim();
      if (!full_name) throw new Error("Enter a name.");
      const { data: person, error } = await admin.from("people").update({ full_name }).eq("id", b.person_id).select("*").single();
      if (error) throw error;
      return { ok: true, person };
    }

    case "broadcast": {
      const subject = String(b.subject ?? "").trim();
      const text = String(b.body ?? "").trim();
      if (!subject) throw new Error("Enter a subject.");
      if (!text) throw new Error("Write the message.");
      let q = admin.from("people").select("id,email,full_name,role").neq("status", "inactive");
      if (b.audience === "notary" || b.audience === "witness") q = q.eq("role", b.audience);
      const { data: people, error } = await q;
      if (error) throw error;
      let recipients = people ?? [];
      if (b.audience === "not_signed_up") {
        if (!b.session_id) throw new Error("Pick a session.");
        const { data: taken } = await admin.from("assignments").select("person_id").eq("session_id", b.session_id);
        const takenIds = new Set((taken ?? []).map((t: any) => t.person_id));
        recipients = recipients.filter((p) => !takenIds.has(p.id));
      }
      if (b.audience === "only" && Array.isArray(b.person_ids)) {
        const want = new Set(b.person_ids);
        recipients = recipients.filter((p) => want.has(p.id));
      }
      if (recipients.length === 0) return { ok: true, queued: 0, sent: 0 };
      const site = await siteUrl();
      const rows = recipients.map((p) => ({
        kind: "broadcast", to_email: p.email, to_name: p.full_name,
        payload: { subject, body: text, person_name: p.full_name, site_url: site },
      }));
      const { error: qe } = await admin.from("mail_outbox").insert(rows);
      if (qe) throw qe;
      const result = await processOutbox(100);
      await audit(me.id, "broadcast", { audience: b.audience, subject, queued: rows.length, ...result });
      return { ok: true, queued: rows.length, ...result };
    }

    case "send_test": {
      const to = String(b.to ?? me.email).trim().toLowerCase();
      const { data: row, error } = await admin.from("mail_outbox").insert({ kind: "test", to_email: to, to_name: me.full_name, payload: {} }).select("id").single();
      if (error) throw error;
      await processOutbox(5);
      const { data: after } = await admin.from("mail_outbox").select("status,provider,last_error").eq("id", row.id).single();
      return { ok: after?.status === "sent", delivery: after };
    }

    case "run_outbox":
      return { ok: true, ...(await processOutbox(25)) };

    case "outlook_status": {
      const { data } = await admin.from("mail_accounts").select("mailbox,display_name,connected_at,last_error,expires_at").eq("id", 1).maybeSingle();
      const fallback = await setting("fallback_from");
      return { connected: !!data?.mailbox, account: data ?? null, fallback_from: fallback,
        redirect_uri: `${SUPABASE_URL}/functions/v1/ms-auth/callback`, client_id: Deno.env.get("MS_CLIENT_ID") ?? null };
    }

    case "outlook_connect_url": {
      const tenant = Deno.env.get("MS_TENANT_ID"), clientId = Deno.env.get("MS_CLIENT_ID");
      if (!tenant || !clientId) throw new Error("Microsoft app settings are missing.");
      const state = crypto.randomUUID();
      await admin.from("settings").upsert({ key: "ms_oauth_state", value: JSON.stringify({ state, by: me.id, exp: Date.now() + 10 * 60_000 }) });
      const p = new URLSearchParams({
        client_id: clientId, response_type: "code", response_mode: "query",
        redirect_uri: `${SUPABASE_URL}/functions/v1/ms-auth/callback`,
        scope: MS_SCOPES, state, prompt: "select_account",
      });
      return { url: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${p}` };
    }

    case "outlook_disconnect": {
      await admin.from("mail_accounts").delete().eq("id", 1);
      await audit(me.id, "outlook.disconnect", {});
      return { ok: true };
    }

    default:
      throw new Error(`Unknown action "${action}".`);
  }
}
