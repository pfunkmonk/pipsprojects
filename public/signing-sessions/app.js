// Signing Sessions — contractor sign-up board + Mike's admin screen.
// Plain JS on top of Supabase: the board reads/writes tables under RLS; anything that needs the service role
// (invites, role/status changes, broadcast email, Outlook) goes through the `admin` edge function.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = "https://jadvujhtaecrlerjpbth.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphZHZ1amh0YWVjcmxlcmpwYnRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3NTAyOTIsImV4cCI6MjEwNzMyNjI5Mn0.03P8MWkZ7oTyfUc7zpOXUgOqhMSLb5BXKuT6zaXipVI";
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
const PAGE_URL = location.origin + location.pathname;

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = {
  session: null, me: null, mode: "roster", tab: "sessions", showHistory: false,
  sessions: [], assignments: [], people: [], defaults: {}, editing: null, confirming: null,
};

// ---------------------------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------------------------
const SLOTS = [["notary", "Notary"], ["witness_1", "Witness 1"], ["witness_2", "Witness 2"]];
const fmtDate = (d) => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }); };
const fmtTime = (t) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };
const hhmm = (t) => t.slice(0, 5);
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtWhen = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

let toastTimer;
function toast(msg, bad = false) {
  const t = $("#toast"); t.textContent = msg; t.className = "toast" + (bad ? " bad" : ""); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 7000 : 4000);
}

function friendly(err) {
  const m = String(err?.message ?? err ?? "");
  if (m.includes("assignments_session_id_slot_key")) return "Someone just took that spot.";
  if (m.includes("assignments_session_id_person_id_key")) return "You already have a spot on that date.";
  if (m.includes("sessions_session_date_key")) return "There's already a session on that date.";
  if (m.includes("NOTARY_ONLY")) return "Only notaries can take the notary spot.";
  if (m.includes("SESSION_PAST")) return "That session has already started.";
  if (m.includes("SESSION_CANCELLED")) return "That session is cancelled.";
  if (m.includes("PERSON_INACTIVE")) return "That person is inactive.";
  if (m.includes("NOT_YOURS")) return "You can only take a spot for yourself.";
  if (m.includes("row-level security")) return "Not allowed.";
  if (m.includes("Signups not allowed")) return "That email isn't on the list. Ask Mike for an invite.";
  if (m.includes("Token has expired") || m.includes("otp_expired")) return "That code didn't work. Check the newest email, or send another link.";
  if (m.includes("rate limit") || m.includes("security purposes")) return "Too many requests — wait a minute and try again.";
  return m || "Something went wrong.";
}

async function adminCall(action, payload = {}) {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(`${FUNCTIONS_URL}/admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ action, ...payload }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || r.statusText);
  return j;
}

// ---------------------------------------------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------------------------------------------
function showSignin(msg) {
  $("#view-signin").hidden = false; $("#view-app").hidden = true;
  $("#who").hidden = true; $("#signout").hidden = true;
  if (msg) { const e = $("#signin-error"); e.textContent = msg; e.hidden = false; }
}

$("#signin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#email").value.trim().toLowerCase();
  const btn = $("#signin-btn"); btn.disabled = true; btn.textContent = "Sending…";
  $("#signin-error").hidden = true;
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: PAGE_URL } });
  btn.disabled = false; btn.textContent = "Email me a sign-in link";
  if (error) { const el = $("#signin-error"); el.textContent = friendly(error); el.hidden = false; return; }
  $("#code-box").hidden = false; $("#code").focus();
});
$("#resend").addEventListener("click", () => $("#signin-form").requestSubmit());

$("#code-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#email").value.trim().toLowerCase();
  const token = $("#code").value.trim();
  if (!/^\d{6}$/.test(token)) { const el = $("#signin-error"); el.textContent = "Enter the 6-digit code from the email."; el.hidden = false; return; }
  const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
  if (error) { const el = $("#signin-error"); el.textContent = friendly(error); el.hidden = false; }
});

$("#signout").addEventListener("click", async () => { await sb.auth.signOut(); location.replace(PAGE_URL); });

sb.auth.onAuthStateChange((_event, session) => {
  state.session = session;
  if (session) boot(); else showSignin();
});

async function boot() {
  if (location.hash.includes("access_token")) history.replaceState(null, "", PAGE_URL + location.search);
  const { data: me, error } = await sb.from("people").select("*").eq("id", state.session.user.id).maybeSingle();
  if (error || !me) { await sb.auth.signOut(); showSignin("That account isn't on the list. Ask Mike for an invite."); return; }
  if (me.status === "inactive") { await sb.auth.signOut(); showSignin("Your account is inactive. Contact Mike."); return; }
  state.me = me;
  $("#view-signin").hidden = true; $("#view-app").hidden = false;
  $("#who").textContent = `${me.full_name} · ${me.role === "notary" ? "Notary" : "Witness"}${me.is_admin ? " · Admin" : ""}`;
  $("#who").hidden = false; $("#signout").hidden = false;
  $("#mode-bar").hidden = !me.is_admin;
  if (me.is_admin) {
    const params = new URLSearchParams(location.search);
    if (params.get("outlook")) {
      state.mode = "admin"; state.tab = "settings";
      toast(params.get("outlook") === "connected" ? "Outlook connected." : `Outlook: ${params.get("msg") || "connection failed"}`, params.get("outlook") !== "connected");
      history.replaceState(null, "", PAGE_URL);
    }
  }
  await loadAll();
  subscribe();
}

// ---------------------------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------------------------
async function loadAll() {
  const [s, a, p, d] = await Promise.all([
    sb.from("sessions_v").select("*").order("session_date"),
    sb.from("assignments").select("*"),
    sb.from("roster_people").select("*").order("full_name"),
    sb.from("settings").select("key,value").like("key", "default_%"),
  ]);
  for (const r of [s, a, p, d]) if (r.error) { toast(friendly(r.error), true); return; }
  state.sessions = s.data; state.assignments = a.data; state.people = p.data;
  state.defaults = Object.fromEntries(d.data.map((r) => [r.key, r.value]));
  render();
}

let reloadTimer;
function subscribe() {
  sb.channel("board")
    .on("postgres_changes", { event: "*", schema: "public", table: "assignments" }, () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(loadAll, 250); })
    .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(loadAll, 250); })
    .subscribe();
}

const personName = (id) => state.people.find((p) => p.id === id)?.full_name ?? "—";
const personStatus = (id) => state.people.find((p) => p.id === id)?.status;
const assignmentsFor = (sid) => Object.fromEntries(state.assignments.filter((a) => a.session_id === sid).map((a) => [a.slot, a]));
const upcoming = () => state.sessions.filter((s) => s.status === "scheduled" && s.session_date >= todayISO());

// ---------------------------------------------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------------------------------------------
function render() {
  const me = state.me;
  $$("#mode-bar .choice").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
  const adminMode = me.is_admin && state.mode === "admin";
  $("#roster-view").hidden = adminMode; $("#admin-view").hidden = !adminMode;
  renderRoster();
  if (adminMode) {
    $$("#admin-tabs .tab").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === state.tab)));
    $$(".tab-pane").forEach((p) => { p.hidden = p.id !== `tab-${state.tab}`; });
    if (state.tab === "sessions") renderAdminSessions();
    if (state.tab === "people") renderPeople();
    if (state.tab === "email") renderEmail();
    if (state.tab === "settings") renderSettings();
  }
}

function renderRoster() {
  const me = state.me, rows = upcoming();
  $("#roster-empty").hidden = rows.length > 0;
  $("#roster-body").innerHTML = rows.map((s) => {
    const a = assignmentsFor(s.id);
    const mine = Object.values(a).find((x) => x.person_id === me.id);
    const full = SLOTS.every(([k]) => a[k]);
    const cells = SLOTS.map(([slot]) => {
      const x = a[slot];
      if (x && x.person_id === me.id) {
        return `<td><div class="seat"><span class="you">You</span>${s.can_drop
          ? `<button class="btn sm danger" data-drop="${x.id}" data-sid="${s.id}">Drop</button>`
          : `<span class="status">Drops closed — email or text Mike</span>`}</div></td>`;
      }
      if (x) return `<td><div class="seat"><span>${esc(personName(x.person_id))}</span></div></td>`;
      const canTake = !mine && (slot !== "notary" || me.role === "notary");
      return `<td><div class="seat"><span class="open">Open</span>${canTake ? `<button class="btn sm" data-take="${slot}" data-sid="${s.id}">Take</button>` : ""}</div></td>`;
    }).join("");
    return `<tr><td class="d">${esc(fmtDate(s.session_date))}<small>${esc(fmtTime(s.start_time))} – ${esc(fmtTime(s.end_time))}<br>${esc(s.location)}${s.notes ? `<br>${esc(s.notes)}` : ""}</small></td>${cells}<td class="status ${mine ? "in" : ""}">${full ? "Full" : mine ? "You're in" : ""}</td></tr>`;
  }).join("");
}

$("#roster-body").addEventListener("click", async (e) => {
  const take = e.target.closest("[data-take]"), drop = e.target.closest("[data-drop]");
  if (take) {
    take.disabled = true;
    const { error } = await sb.from("assignments").insert({ session_id: take.dataset.sid, slot: take.dataset.take, person_id: state.me.id });
    if (error) { toast(friendly(error), true); take.disabled = false; }
    else toast("You're in. A confirmation email is on its way.");
    loadAll();
  }
  if (drop) {
    if (state.confirming !== drop.dataset.drop) {
      state.confirming = drop.dataset.drop;
      drop.replaceWith(Object.assign(document.createElement("span"), { className: "confirm", innerHTML: `Drop it? <button class="btn sm danger" data-drop-yes="${drop.dataset.drop}">Yes, drop</button> <button class="btn sm" data-drop-no>No</button>` }));
    }
  }
  const yes = e.target.closest("[data-drop-yes]"), no = e.target.closest("[data-drop-no]");
  if (no) { state.confirming = null; renderRoster(); }
  if (yes) {
    state.confirming = null;
    const { data, error } = await sb.from("assignments").delete().eq("id", yes.dataset.dropYes).eq("person_id", state.me.id).select("id");
    if (error) toast(friendly(error), true);
    else if (!data?.length) toast("Drops close 48 hours before the session. Email or text Mike.", true);
    else toast("Dropped. Mike has been notified.");
    loadAll();
  }
});

// --- Admin: sessions ---------------------------------------------------------------------------------------------
function renderAdminSessions() {
  const f = $("#add-session");
  if (!f.session_date.value) {
    f.start_time.value = state.defaults.default_start_time ?? "08:30";
    f.end_time.value = state.defaults.default_end_time ?? "16:00";
    f.location.value = state.defaults.default_location ?? "";
  }
  $("#toggle-history").textContent = state.showHistory ? "Hide history" : "Show history";
  const rows = state.showHistory ? [...state.sessions].reverse() : upcoming();
  $("#admin-sessions-empty").hidden = rows.length > 0;
  $("#admin-sessions-body").innerHTML = rows.map((s) => {
    const a = assignmentsFor(s.id);
    const past = s.session_date < todayISO() || s.status !== "scheduled";
    const onIt = new Set(Object.values(a).map((x) => x.person_id));
    const cells = SLOTS.map(([slot]) => {
      const x = a[slot];
      if (x) {
        const st = personStatus(x.person_id);
        return `<td><div class="seat"><span>${esc(personName(x.person_id))}${st === "inactive" ? ` <span class="inactive">inactive</span>` : ""}</span>${past ? "" : `<button class="link-btn danger" data-unassign="${x.id}" title="Remove">×</button>`}</div></td>`;
      }
      if (past) return `<td><span class="open">open</span></td>`;
      const eligible = state.people.filter((p) => p.status !== "inactive" && !onIt.has(p.id) && (slot !== "notary" || p.role === "notary"));
      return `<td><div class="assign"><select data-assign-slot="${slot}" data-sid="${s.id}"><option value="">Open — assign…</option>${eligible.map((p) => `<option value="${p.id}">${esc(p.full_name)}</option>`).join("")}</select></div></td>`;
    }).join("");
    const actions = past ? `<span class="pill ${s.status === "cancelled" ? "off" : ""}">${s.status === "cancelled" ? "Cancelled" : "Done"}</span>`
      : state.confirming === `cancel:${s.id}`
        ? `<span class="confirm">Cancel this session? <button class="btn sm danger" data-cancel-yes="${s.id}">Yes</button> <button class="btn sm" data-cancel-no>No</button></span>`
        : `<button class="link-btn" data-edit="${s.id}">Edit</button> · <button class="link-btn danger" data-cancel="${s.id}">Cancel</button>`;
    const main = `<tr class="${s.status === "cancelled" ? "cancelled" : ""}"><td class="d">${esc(fmtDate(s.session_date))}<small>${esc(fmtTime(s.start_time))} – ${esc(fmtTime(s.end_time))}<br>${esc(s.location)}${s.notes ? `<br>${esc(s.notes)}` : ""}</small></td>${cells}<td class="status">${actions}</td></tr>`;
    const edit = state.editing === s.id ? `<tr class="edit-row"><td colspan="5"><form data-edit-form="${s.id}">
        <label>Date <input type="date" name="session_date" value="${s.session_date}" required></label>
        <label>Start <input type="time" name="start_time" value="${hhmm(s.start_time)}" required></label>
        <label>End <input type="time" name="end_time" value="${hhmm(s.end_time)}" required></label>
        <label class="grow">Location <input type="text" name="location" value="${esc(s.location)}" required style="min-width:260px"></label>
        <label class="grow">Notes <input type="text" name="notes" value="${esc(s.notes)}" style="min-width:200px"></label>
        <button type="submit" class="btn primary">Save</button> <button type="button" class="btn" data-edit-cancel>Cancel</button>
      </form><p class="hint">Everyone with a spot gets an email if the date, time, or location changes.</p></td></tr>` : "";
    return main + edit;
  }).join("");
}

$("#toggle-history").addEventListener("click", () => { state.showHistory = !state.showHistory; renderAdminSessions(); });

$("#add-session").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, fd = Object.fromEntries(new FormData(f));
  const { error } = await sb.from("sessions").insert({ session_date: fd.session_date, start_time: fd.start_time, end_time: fd.end_time, location: fd.location.trim(), notes: fd.notes.trim() });
  if (error) return toast(friendly(error), true);
  toast(`Added ${fmtDate(fd.session_date)}.`); f.session_date.value = ""; f.notes.value = "";
  loadAll();
});

$("#admin-sessions-body").addEventListener("change", async (e) => {
  const sel = e.target.closest("[data-assign-slot]");
  if (!sel || !sel.value) return;
  const { error } = await sb.from("assignments").insert({ session_id: sel.dataset.sid, slot: sel.dataset.assignSlot, person_id: sel.value });
  if (error) toast(friendly(error), true); else toast(`${personName(sel.value)} assigned — they've been emailed.`);
  loadAll();
});

$("#admin-sessions-body").addEventListener("click", async (e) => {
  const un = e.target.closest("[data-unassign]");
  if (un) {
    const { error } = await sb.from("assignments").delete().eq("id", un.dataset.unassign);
    if (error) toast(friendly(error), true); else toast("Removed — they've been emailed.");
    return loadAll();
  }
  const ed = e.target.closest("[data-edit]");
  if (ed) { state.editing = ed.dataset.edit; return renderAdminSessions(); }
  if (e.target.closest("[data-edit-cancel]")) { state.editing = null; return renderAdminSessions(); }
  const c = e.target.closest("[data-cancel]");
  if (c) { state.confirming = `cancel:${c.dataset.cancel}`; return renderAdminSessions(); }
  if (e.target.closest("[data-cancel-no]")) { state.confirming = null; return renderAdminSessions(); }
  const cy = e.target.closest("[data-cancel-yes]");
  if (cy) {
    state.confirming = null;
    const { error } = await sb.from("sessions").update({ status: "cancelled" }).eq("id", cy.dataset.cancelYes);
    if (error) toast(friendly(error), true); else toast("Session cancelled — everyone on it has been emailed.");
    return loadAll();
  }
});

$("#admin-sessions-body").addEventListener("submit", async (e) => {
  const f = e.target.closest("[data-edit-form]");
  if (!f) return;
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(f));
  const { error } = await sb.from("sessions").update({ session_date: fd.session_date, start_time: fd.start_time, end_time: fd.end_time, location: fd.location.trim(), notes: fd.notes.trim() }).eq("id", f.dataset.editForm);
  if (error) return toast(friendly(error), true);
  state.editing = null; toast("Saved."); loadAll();
});

// --- Admin: people -----------------------------------------------------------------------------------------------
async function renderPeople() {
  const { data, error } = await sb.from("people").select("*").order("full_name");
  if (error) return toast(friendly(error), true);
  $("#people-body").innerHTML = data.map((p) => `<tr>
    <td>${esc(p.full_name)}${p.is_admin ? ` <span class="pill">Admin</span>` : ""}</td>
    <td>${esc(p.email)}</td>
    <td><select data-role="${p.id}"><option value="notary" ${p.role === "notary" ? "selected" : ""}>Notary</option><option value="witness" ${p.role === "witness" ? "selected" : ""}>Witness</option></select></td>
    <td><span class="pill ${p.status === "active" ? "ok" : p.status === "invited" ? "gold" : "off"}">${p.status === "invited" ? "Invited" : p.status === "active" ? "Active" : "Inactive"}</span></td>
    <td class="status">${p.status === "inactive"
      ? `<button class="link-btn" data-status="active" data-pid="${p.id}">Reactivate</button>`
      : `<button class="link-btn" data-resend="${p.id}">${p.status === "invited" ? "Resend invite" : "Send sign-in link"}</button>${p.id === state.me.id ? "" : ` · <button class="link-btn danger" data-status="inactive" data-pid="${p.id}">Deactivate</button>`}`}</td>
  </tr>`).join("");
}

$("#invite-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, fd = Object.fromEntries(new FormData(f));
  const btn = f.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Sending…";
  try {
    const r = await adminCall("invite", { email: fd.email, full_name: fd.full_name, role: fd.role });
    if (r.delivery?.status === "sent") toast(`Invite sent to ${fd.email}.`);
    else toast(`${fd.full_name} added, but the email didn't go out: ${r.delivery?.last_error ?? "unknown"}. Use "Resend invite".`, true);
    f.reset();
  } catch (err) { toast(friendly(err), true); }
  btn.disabled = false; btn.textContent = "Send invite";
  loadAll();
});

$("#people-body").addEventListener("change", async (e) => {
  const sel = e.target.closest("[data-role]");
  if (!sel) return;
  try {
    const r = await adminCall("set_role", { person_id: sel.dataset.role, role: sel.value });
    if (r.conflicts?.length) toast(`Role changed. Heads up: they still hold the notary spot on ${r.conflicts.map(fmtDate).join(", ")} — reassign if needed.`, true);
    else toast("Role changed.");
  } catch (err) { toast(friendly(err), true); }
  loadAll();
});

$("#people-body").addEventListener("click", async (e) => {
  const rs = e.target.closest("[data-resend]");
  if (rs) {
    rs.disabled = true;
    try { const r = await adminCall("resend_invite", { person_id: rs.dataset.resend }); toast(r.delivery?.status === "sent" ? "Sent." : `Didn't send: ${r.delivery?.last_error ?? "unknown"}`, r.delivery?.status !== "sent"); }
    catch (err) { toast(friendly(err), true); }
    return renderPeople();
  }
  const st = e.target.closest("[data-status]");
  if (st) {
    try { await adminCall("set_status", { person_id: st.dataset.pid, status: st.dataset.status }); toast(st.dataset.status === "inactive" ? "Deactivated — they can no longer sign in." : "Reactivated."); }
    catch (err) { toast(friendly(err), true); }
    loadAll(); renderPeople();
  }
});

// --- Admin: email ------------------------------------------------------------------------------------------------
async function renderEmail() {
  $("#audience-session").innerHTML = upcoming().map((s) => `<option value="${s.id}">${esc(fmtDate(s.session_date))}</option>`).join("");
  $("#audience-session-wrap").hidden = $("#audience").value !== "not_signed_up";
  renderLog();
}
$("#audience").addEventListener("change", () => { $("#audience-session-wrap").hidden = $("#audience").value !== "not_signed_up"; });

async function renderLog() {
  const { data, error } = await sb.from("mail_outbox").select("id,kind,to_email,to_name,status,provider,last_error,created_at,sent_at").order("created_at", { ascending: false }).limit(50);
  if (error) return toast(friendly(error), true);
  $("#log-body").innerHTML = data.length ? data.map((r) => `<tr>
    <td>${esc(fmtWhen(r.created_at))}</td><td>${esc(r.kind.replace(/_/g, " "))}</td><td>${esc(r.to_name ? `${r.to_name} <${r.to_email}>` : r.to_email)}</td>
    <td><span class="pill ${r.status === "sent" ? "ok" : r.status === "failed" ? "off" : "gold"}">${r.status}</span>${r.provider ? ` <span class="status">${esc(r.provider)}</span>` : ""}${r.last_error ? `<div class="err">${esc(r.last_error)}</div>` : ""}</td>
  </tr>`).join("") : `<tr><td colspan="4" class="empty">Nothing sent yet.</td></tr>`;
}
$("#refresh-log").addEventListener("click", renderLog);

$("#broadcast-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, fd = Object.fromEntries(new FormData(f));
  const btn = f.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Sending…";
  try {
    const r = await adminCall("broadcast", { audience: fd.audience, session_id: fd.session_id, subject: fd.subject, body: fd.body });
    toast(r.queued === 0 ? "Nobody matched that audience." : `Sent to ${r.sent} of ${r.queued}.${r.failed ? " Check the log for failures." : ""}`, !!r.failed);
    if (r.sent) f.reset();
  } catch (err) { toast(friendly(err), true); }
  btn.disabled = false; btn.textContent = "Send";
  renderLog();
});

// --- Admin: settings ---------------------------------------------------------------------------------------------
async function renderSettings() {
  const f = $("#defaults-form");
  f.default_start_time.value = state.defaults.default_start_time ?? "08:30";
  f.default_end_time.value = state.defaults.default_end_time ?? "16:00";
  f.default_location.value = state.defaults.default_location ?? "";
  try {
    const s = await adminCall("outlook_status");
    if (s.connected) {
      $("#outlook-status").textContent = `Connected — sending as ${s.account.display_name ? `${s.account.display_name} <${s.account.mailbox}>` : s.account.mailbox}.${s.account.last_error ? ` Last error: ${s.account.last_error}` : ""}`;
      $("#outlook-help").textContent = "";
    } else {
      $("#outlook-status").textContent = `Not connected. Emails go out from ${s.fallback_from} with replies to michael@pippengerlaw.com until Outlook is connected.`;
      $("#outlook-help").innerHTML = `Before the first connect, this redirect URI must be on the Azure app (<code>${esc(s.client_id)}</code>) under Authentication → Web: <code>${esc(s.redirect_uri)}</code>`;
    }
    $("#outlook-connect").hidden = false; $("#outlook-connect").textContent = s.connected ? "Reconnect Outlook" : "Connect Outlook";
    $("#outlook-disconnect").hidden = !s.connected;
  } catch (err) { $("#outlook-status").textContent = friendly(err); }
}

$("#outlook-connect").addEventListener("click", async () => {
  try { const r = await adminCall("outlook_connect_url"); location.href = r.url; } catch (err) { toast(friendly(err), true); }
});
$("#outlook-disconnect").addEventListener("click", async () => {
  try { await adminCall("outlook_disconnect"); toast("Outlook disconnected."); renderSettings(); } catch (err) { toast(friendly(err), true); }
});
$("#send-test").addEventListener("click", async (e) => {
  e.target.disabled = true;
  try { const r = await adminCall("send_test"); toast(r.ok ? `Test sent to ${state.me.email} via ${r.delivery.provider}.` : `Didn't send: ${r.delivery?.last_error}`, !r.ok); }
  catch (err) { toast(friendly(err), true); }
  e.target.disabled = false;
});
$("#defaults-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const rows = Object.entries(fd).map(([key, value]) => ({ key, value: String(value).trim() }));
  const { error } = await sb.from("settings").upsert(rows);
  if (error) return toast(friendly(error), true);
  toast("Defaults saved."); loadAll();
});

// --- Mode + tabs --------------------------------------------------------------------------------------------------
$("#mode-bar").addEventListener("click", (e) => { const b = e.target.closest("[data-mode]"); if (b) { state.mode = b.dataset.mode; render(); } });
$("#admin-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { state.tab = b.dataset.tab; render(); } });

$("#year").textContent = new Date().getFullYear();

// Kick off: onAuthStateChange fires INITIAL_SESSION, which routes to the right view.
