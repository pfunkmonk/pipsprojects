# Signing Sessions — how it's built and how to move it

Contractor sign-up board for Saturday signing sessions. Live at `https://pipsprojects.com/signing-sessions/`.

## Pieces

| Piece | Where | Notes |
| --- | --- | --- |
| Page | `public/signing-sessions/` (`index.html`, `app.js`, `styles.css`) | Plain HTML/JS, supabase-js from esm.sh. Firm palette from the portal. Bump `?v=` on both assets when you change them. |
| Database | Supabase project `jadvujhtaecrlerjpbth` ("signing-sessions") | Schema in `supabase/migrations/`. Every rule is a trigger or RLS policy, so it holds for every write path. |
| Edge functions | `supabase/functions/` | `admin` (invites, roles, broadcast, Outlook), `auth-email` (Supabase send-email hook), `mail-worker` (delivers the outbox; pg_cron calls it every minute), `ms-auth` (Outlook OAuth callback). Deploy: `npx supabase@latest functions deploy --project-ref jadvujhtaecrlerjpbth` from the repo root. |
| Email | one mailer (`_shared/mailer.ts`) | Outlook (Graph, delegated) when connected in Settings; otherwise Resend from `signing@pipsprojects.com` with replies to michael@pippengerlaw.com. All templates in `_shared/templates.ts`. |

## Rules (all enforced in the database)
- 1 notary + 2 witnesses per session; notary can take either kind of spot, witness only a witness spot.
- One spot per person per session; first come, first served (unique constraints).
- Drop allowed until 48 h before start (`settings.drop_cutoff_hours`, America/Denver). Inside that, the page says to email/text Mike.
- Emails: take → confirmation to the person; self-drop → notice to `settings.admin_notify_email`; admin assign/remove → the person; cancel/change session → everyone on it; reminders the Tuesday 11 days before and 48 h before; staffing-gap note to admin at 11 days.
- Sign-in: magic link + 6-digit code, invite only (`disable_signup`). Links last 24 h.

## Secrets / config (edge function secrets on the Supabase project)
`RESEND_API_KEY`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID` (the firm portal's Azure app), `CRON_SECRET`, `SEND_EMAIL_HOOK_SECRET`, `SITE_URL`. Vault holds `cron_secret` + `mail_worker_url` for pg_cron.

## Outlook (send as admin@pippengerlaw.com)
One-time: in Azure → the portal's app registration → Authentication → add Web redirect URI
`https://jadvujhtaecrlerjpbth.supabase.co/functions/v1/ms-auth/callback`. Then Settings → Connect Outlook, sign in as the mailbox you want mail to come from. Until then, Resend is used automatically.

## Moving it into the firm site later
Everything except the page is already standalone. The firm portal's `signing_sessions` table joins on `session_date`; this app's slots `notary` / `witness_1` / `witness_2` map to the portal's `notary_staff_id` / `client_wrangler_staff_id` / `document_wrangler_staff_id`. Re-skin `index.html`/`app.js` inside the portal, point it at the same Supabase project (or migrate the schema with the migrations folder), and update `settings.site_url` + the auth redirect allow-list.
