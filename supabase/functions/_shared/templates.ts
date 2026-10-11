// Every email the system sends, in one place. render(kind, payload) -> { subject, html, text }.
// Tone: a short note from Mike. Never include his phone number; the admin address is only ever a recipient.
import type { Mail } from "./mailer.ts";

type P = Record<string, any>;

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const first = (name?: string | null) => (name ?? "").trim().split(/\s+/)[0] || "there";

function wrap(title: string, bodyHtml: string, site: string) {
  return `<!doctype html><html><body style="margin:0;background:#d5e8da;font-family:Inter,Segoe UI,Arial,sans-serif;color:#142019">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#176b45;color:#fff;padding:14px 20px;border-radius:12px 12px 0 0;font-family:Georgia,serif;font-size:17px">Pippenger Law &nbsp;<span style="font-family:Inter,Arial,sans-serif;font-size:12px;background:#a78546;padding:2px 8px;border-radius:999px;vertical-align:middle">Signing Sessions</span></div>
  <div style="background:#fffdf7;border:1px solid #9daf9f;border-top:none;border-radius:0 0 12px 12px;padding:20px 20px 24px;font-size:15px;line-height:1.55">
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:20px;margin:0 0 12px">${esc(title)}</h1>
    ${bodyHtml}
  </div>
  <p style="font-size:12px;color:#3f4b43;text-align:center;margin:14px 0 0">Sign in any time at <a href="${esc(site)}" style="color:#176b45">${esc(site.replace(/^https?:\/\//, ""))}</a></p>
</div></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:18px 0"><a href="${esc(href)}" style="display:inline-block;background:#176b45;color:#fff;text-decoration:none;padding:11px 20px;border-radius:7px;font-weight:500">${esc(label)}</a></p>`;

const sessionBlock = (p: P) => `<div style="border:1px solid #d8cec0;border-radius:8px;padding:12px 14px;margin:14px 0;background:#f6f1e8">
  <div style="font-family:Georgia,serif;font-size:17px">${esc(p.date_text)}</div>
  <div style="color:#3f4b43">${esc(p.time_text)}<br>${esc(p.location)}</div>
  ${p.notes ? `<div style="color:#3f4b43;margin-top:6px">${esc(p.notes)}</div>` : ""}
</div>`;

const roster = (p: P) => `<table style="font-size:14px;border-collapse:collapse;margin:8px 0"><tr><td style="padding:2px 12px 2px 0;color:#3f4b43">Notary</td><td>${esc(p.notary ?? "open")}</td></tr><tr><td style="padding:2px 12px 2px 0;color:#3f4b43">Witness 1</td><td>${esc(p.witness_1 ?? "open")}</td></tr><tr><td style="padding:2px 12px 2px 0;color:#3f4b43">Witness 2</td><td>${esc(p.witness_2 ?? "open")}</td></tr></table>`;

const sessionText = (p: P) => `${p.date_text}\n${p.time_text}\n${p.location}${p.notes ? "\n" + p.notes : ""}`;
const rosterText = (p: P) => `Notary: ${p.notary ?? "open"}\nWitness 1: ${p.witness_1 ?? "open"}\nWitness 2: ${p.witness_2 ?? "open"}`;
const sig = `<p style="margin:16px 0 0">Thanks,<br>Mike</p>`;

export function render(kind: string, p: P, to: { to: string; toName?: string | null }): Mail {
  const site = p.site_url ?? "https://pipsprojects.com/signing-sessions/";
  const name = first(p.person_name ?? to.toName);
  let subject = "", body = "", text = "";

  switch (kind) {
    case "invite":
      subject = "New way to sign up for Saturday signing sessions";
      body = `<p>Hi ${esc(name)},</p>
<p>We're moving signing-session sign-ups to a web page so you can grab the dates you want without waiting on an email thread. Click the button below to sign in — there's no password, the link just works.</p>
${button(p.link, "Sign in to Signing Sessions")}
<p>You're set up as a <strong>${esc(p.role_label)}</strong>, so ${p.role === "notary" ? "you can take either the notary spot or a witness spot" : "you can take a witness spot"}. It's first come, first served, so check in early. You can drop a date up to 48 hours before; after that, email or text me.</p>
<p style="font-size:13px;color:#3f4b43">If the button has expired by the time you open this, go to <a href="${esc(site)}" style="color:#176b45">${esc(site)}</a>, enter your email, and a fresh link will be sent.</p>${sig}`;
      text = `Hi ${name},\n\nWe're moving signing-session sign-ups to a web page so you can grab the dates you want without waiting on an email thread. Open this link to sign in — there's no password, the link just works:\n\n${p.link}\n\nYou're set up as a ${p.role_label}. It's first come, first served, so check in early. You can drop a date up to 48 hours before; after that, email or text me.\n\nIf the link has expired, go to ${site}, enter your email, and a fresh one will be sent.\n\nThanks,\nMike`;
      break;

    case "signin":
      subject = `Your sign-in link${p.code ? ` (code ${p.code})` : ""}`;
      body = `<p>Hi ${esc(name)},</p><p>Click the button to sign in to Signing Sessions.</p>${button(p.link, "Sign in")}
${p.code ? `<p>Or enter this code on the sign-in page: <span style="font-family:monospace;font-size:20px;letter-spacing:3px;background:#f6f1e8;padding:4px 10px;border-radius:6px">${esc(p.code)}</span></p>` : ""}
<p style="font-size:13px;color:#3f4b43">The link and code work for one hour. If you didn't ask for this, ignore it.</p>`;
      text = `Hi ${name},\n\nSign in to Signing Sessions:\n${p.link}\n${p.code ? `\nOr enter this code on the sign-in page: ${p.code}\n` : ""}\nThe link and code work for one hour. If you didn't ask for this, ignore it.`;
      break;

    case "take_confirmation":
      subject = `You're on for ${p.date_text} (${p.slot})`;
      body = `<p>Hi ${esc(name)},</p><p>You've got the <strong>${esc(p.slot)}</strong> spot for this session:</p>${sessionBlock(p)}${roster(p)}
<p style="font-size:13px;color:#3f4b43">You'll get a reminder 11 days out and again 48 hours before. Need to drop it? Sign in and click Drop, up to 48 hours before; after that, email or text me.</p>${sig}`;
      text = `Hi ${name},\n\nYou've got the ${p.slot} spot for this session:\n\n${sessionText(p)}\n\n${rosterText(p)}\n\nYou'll get a reminder 11 days out and again 48 hours before. Need to drop it? Sign in and click Drop, up to 48 hours before; after that, email or text me.\n\nThanks,\nMike`;
      break;

    case "admin_assigned":
      subject = `I put you down for ${p.date_text} (${p.slot})`;
      body = `<p>Hi ${esc(name)},</p><p>I've put you in the <strong>${esc(p.slot)}</strong> spot for this session:</p>${sessionBlock(p)}${roster(p)}
<p style="font-size:13px;color:#3f4b43">If that doesn't work for you, sign in and click Drop (up to 48 hours before), or just email or text me.</p>${sig}`;
      text = `Hi ${name},\n\nI've put you in the ${p.slot} spot for this session:\n\n${sessionText(p)}\n\n${rosterText(p)}\n\nIf that doesn't work for you, sign in and click Drop (up to 48 hours before), or just email or text me.\n\nThanks,\nMike`;
      break;

    case "admin_removed":
      subject = `Taken off ${p.date_text} (${p.slot})`;
      body = `<p>Hi ${esc(name)},</p><p>I've taken you off the <strong>${esc(p.slot)}</strong> spot for ${esc(p.date_text)}. Nothing you need to do — just letting you know. Other dates are open on the page if you want one.</p>${sig}`;
      text = `Hi ${name},\n\nI've taken you off the ${p.slot} spot for ${p.date_text}. Nothing you need to do — just letting you know. Other dates are open on the page if you want one.\n\nThanks,\nMike`;
      break;

    case "drop_notice":
      subject = `${p.person_name} dropped ${p.slot} on ${p.date_text}`;
      body = `<p><strong>${esc(p.person_name)}</strong> dropped the <strong>${esc(p.slot)}</strong> spot.</p>${sessionBlock(p)}<p>Staffing now:</p>${roster(p)}<p>${p.open_slots} open spot${p.open_slots === 1 ? "" : "s"}.</p>${button(site, "Open Signing Sessions")}`;
      text = `${p.person_name} dropped the ${p.slot} spot.\n\n${sessionText(p)}\n\nStaffing now:\n${rosterText(p)}\n\n${p.open_slots} open spot(s).\n${site}`;
      break;

    case "session_cancelled":
      subject = `Cancelled: ${p.date_text} signing session`;
      body = `<p>Hi ${esc(name)},</p><p>The signing session on <strong>${esc(p.date_text)}</strong> is cancelled, so your ${esc(p.slot)} spot is off. Sorry for the change — other dates are on the page.</p>${sig}`;
      text = `Hi ${name},\n\nThe signing session on ${p.date_text} is cancelled, so your ${p.slot} spot is off. Sorry for the change — other dates are on the page.\n\nThanks,\nMike`;
      break;

    case "session_changed":
      subject = `Changed: ${p.old_date_text && p.old_date_text !== p.date_text ? `${p.old_date_text} is now ${p.date_text}` : `${p.date_text} signing session`}`;
      body = `<p>Hi ${esc(name)},</p><p>The details for a session you're on (${esc(p.slot)}) have changed. Here's the current plan:</p>${sessionBlock(p)}<p>If it no longer works, sign in and click Drop, or email or text me.</p>${sig}`;
      text = `Hi ${name},\n\nThe details for a session you're on (${p.slot}) have changed. Here's the current plan:\n\n${sessionText(p)}\n\nIf it no longer works, sign in and click Drop, or email or text me.\n\nThanks,\nMike`;
      break;

    case "reminder_days":
      subject = `Reminder: ${p.date_text} signing session`;
      body = `<p>Hi ${esc(name)},</p><p>Heads up — you're the <strong>${esc(p.slot)}</strong> for the signing session a week from Saturday:</p>${sessionBlock(p)}${roster(p)}
<p style="font-size:13px;color:#3f4b43">If you can't make it, sign in and click Drop as soon as you know (drops close 48 hours before).</p>${sig}`;
      text = `Hi ${name},\n\nHeads up — you're the ${p.slot} for the signing session a week from Saturday:\n\n${sessionText(p)}\n\n${rosterText(p)}\n\nIf you can't make it, sign in and click Drop as soon as you know (drops close 48 hours before).\n\nThanks,\nMike`;
      break;

    case "reminder_hours":
      subject = `This Saturday: ${p.date_text} signing session`;
      body = `<p>Hi ${esc(name)},</p><p>See you Saturday — you're the <strong>${esc(p.slot)}</strong>:</p>${sessionBlock(p)}${roster(p)}
<p style="font-size:13px;color:#3f4b43">Online drops are closed now. If something comes up, email or text me right away.</p>${sig}`;
      text = `Hi ${name},\n\nSee you Saturday — you're the ${p.slot}:\n\n${sessionText(p)}\n\n${rosterText(p)}\n\nOnline drops are closed now. If something comes up, email or text me right away.\n\nThanks,\nMike`;
      break;

    case "staffing_gap":
      subject = `${p.open_slots} open spot${p.open_slots === 1 ? "" : "s"} for ${p.date_text}`;
      body = `<p>The ${esc(p.date_text)} session is 11 days out and not fully staffed.</p>${sessionBlock(p)}${roster(p)}${button(site, "Open Signing Sessions")}`;
      text = `The ${p.date_text} session is 11 days out and not fully staffed.\n\n${sessionText(p)}\n\n${rosterText(p)}\n${site}`;
      break;

    case "broadcast":
      subject = p.subject ?? "A note from Mike";
      body = `<p>Hi ${esc(name)},</p>${String(p.body ?? "").split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`).join("")}${sig}`;
      text = `Hi ${name},\n\n${p.body ?? ""}\n\nThanks,\nMike`;
      break;

    case "test":
      subject = "Test email from Signing Sessions";
      body = `<p>If you can read this, email is working.</p><p style="font-size:13px;color:#3f4b43">Sent ${esc(new Date().toUTCString())}.</p>`;
      text = `If you can read this, email is working.\nSent ${new Date().toUTCString()}.`;
      break;

    default:
      throw new Error(`unknown mail kind: ${kind}`);
  }
  return { to: to.to, toName: to.toName ?? p.person_name ?? null, subject, html: wrap(subject, body, site), text };
}
