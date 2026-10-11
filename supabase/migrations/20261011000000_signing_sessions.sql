-- Signing Sessions — contractor sign-up for Saturday signing sessions.
-- Everything the feature needs lives in this one migration so it can be lifted into the firm site later.
-- Time zone for every "48 hours before" / "11 days before" rule: America/Denver.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

-- ---------------------------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------------------------
create type public.person_role as enum ('notary', 'witness');
create type public.person_status as enum ('invited', 'active', 'inactive');
create type public.slot_kind as enum ('notary', 'witness_1', 'witness_2');

-- ---------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------
create table public.people (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role public.person_role not null default 'witness',
  is_admin boolean not null default false,
  status public.person_status not null default 'invited',
  invited_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date not null unique,
  start_time time not null default '08:30',
  end_time time not null default '16:00',
  location text not null default '7350 E. Progress Place Suite 100, Greenwood Village, CO 80111',
  notes text not null default '',
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  slot public.slot_kind not null,
  person_id uuid not null references public.people (id) on delete cascade,
  assigned_by uuid references public.people (id),      -- null = the person took it themselves
  created_at timestamptz not null default now(),
  unique (session_id, slot),                           -- first come, first served
  unique (session_id, person_id)                       -- one spot per person per session
);

create table public.settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into public.settings (key, value) values
  ('admin_notify_email', 'michael@pippengerlaw.com'),
  ('drop_cutoff_hours', '48'),
  ('reminder_days_before', '11'),
  ('reminder_hours_before', '48'),
  ('site_url', 'https://pipsprojects.com/signing-sessions/'),
  ('sender_name', 'Mike Pippenger'),
  ('fallback_from', 'Mike Pippenger <signing@pipsprojects.com>'),
  ('fallback_reply_to', 'michael@pippengerlaw.com');

-- Every email the system sends goes through this queue; the mail-worker edge function delivers it.
create table public.mail_outbox (
  id bigint generated always as identity primary key,
  kind text not null,
  to_email text not null,
  to_name text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempts int not null default 0,
  provider text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index mail_outbox_queued_idx on public.mail_outbox (created_at) where status = 'queued';

create table public.reminder_log (
  session_id uuid not null references public.sessions (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (session_id, person_id, kind)
);

-- The connected Outlook mailbox (service role only — no RLS policies on purpose).
create table public.mail_accounts (
  id int primary key default 1 check (id = 1),
  provider text not null default 'microsoft',
  mailbox text,
  display_name text,
  refresh_token text,
  access_token text,
  expires_at timestamptz,
  connected_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.people where id = auth.uid() and is_admin and status = 'active');
$$;

create or replace function public.session_start_at(s public.sessions)
returns timestamptz language sql immutable as $$
  select (s.session_date::timestamp + s.start_time) at time zone 'America/Denver';
$$;

create or replace function public.setting(p_key text)
returns text language sql stable security definer set search_path = public as $$
  select value from public.settings where key = p_key;
$$;

-- Can this person drop their spot right now? (outside the cutoff, session still ahead)
create or replace function public.can_drop(p_session uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.session_start_at(s) - make_interval(hours => coalesce(public.setting('drop_cutoff_hours'), '48')::int) > now()
  from public.sessions s where s.id = p_session;
$$;

-- Everything an email template needs about a session, formatted for people.
create or replace function public.session_payload(p_session uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'session_id', s.id,
    'session_date', s.session_date,
    'date_text', to_char(s.session_date, 'FMDay, FMMonth FMDD, YYYY'),
    'time_text', to_char(s.start_time, 'FMHH12:MI AM') || ' – ' || to_char(s.end_time, 'FMHH12:MI AM'),
    'location', s.location,
    'notes', s.notes,
    'status', s.status,
    'notary', (select p.full_name from public.assignments a join public.people p on p.id = a.person_id where a.session_id = s.id and a.slot = 'notary'),
    'witness_1', (select p.full_name from public.assignments a join public.people p on p.id = a.person_id where a.session_id = s.id and a.slot = 'witness_1'),
    'witness_2', (select p.full_name from public.assignments a join public.people p on p.id = a.person_id where a.session_id = s.id and a.slot = 'witness_2'),
    'open_slots', 3 - (select count(*) from public.assignments a where a.session_id = s.id),
    'site_url', public.setting('site_url')
  )
  from public.sessions s where s.id = p_session;
$$;

create or replace function public.slot_label(p_slot public.slot_kind)
returns text language sql immutable as $$
  select case p_slot when 'notary' then 'Notary' when 'witness_1' then 'Witness 1' else 'Witness 2' end;
$$;

create or replace function public.enqueue_mail(p_kind text, p_to text, p_to_name text, p_payload jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.mail_outbox (kind, to_email, to_name, payload) values (p_kind, p_to, p_to_name, coalesce(p_payload, '{}'::jsonb));
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger people_touch before update on public.people for each row execute function public.touch_updated_at();
create trigger sessions_touch before update on public.sessions for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------------------------------------------
-- Rules (triggers) — enforced for everyone, admin included, whichever path the write came through.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.assignments_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.sessions; p public.people;
begin
  select * into s from public.sessions where id = new.session_id;
  if s.id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if s.status <> 'scheduled' then raise exception 'SESSION_CANCELLED'; end if;
  if public.session_start_at(s) <= now() then raise exception 'SESSION_PAST'; end if;

  select * into p from public.people where id = new.person_id;
  if p.id is null then raise exception 'PERSON_NOT_FOUND'; end if;
  if p.status = 'inactive' then raise exception 'PERSON_INACTIVE'; end if;
  if new.slot = 'notary' and p.role <> 'notary' then raise exception 'NOTARY_ONLY'; end if;

  -- a contractor may only put themselves in; an admin may put anyone in
  if not public.is_admin() then
    if new.person_id <> auth.uid() then raise exception 'NOT_YOURS'; end if;
    new.assigned_by = null;
  else
    new.assigned_by = case when new.person_id = auth.uid() then null else auth.uid() end;
  end if;
  return new;
end $$;

create trigger assignments_validate before insert on public.assignments
  for each row execute function public.assignments_validate();

-- Emails that follow a spot being taken or released.
create or replace function public.assignments_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.people; pay jsonb;
begin
  select * into p from public.people where id = new.person_id;
  pay = public.session_payload(new.session_id) || jsonb_build_object('person_name', p.full_name, 'slot', public.slot_label(new.slot));
  if new.assigned_by is null then
    perform public.enqueue_mail('take_confirmation', p.email, p.full_name, pay);
  else
    perform public.enqueue_mail('admin_assigned', p.email, p.full_name, pay);
  end if;
  insert into public.audit_log (actor, action, detail) values (auth.uid(), 'assignment.insert', to_jsonb(new));
  return new;
end $$;

create trigger assignments_after_insert after insert on public.assignments
  for each row execute function public.assignments_after_insert();

create or replace function public.assignments_after_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.people; pay jsonb; admin_email text;
begin
  select * into p from public.people where id = old.person_id;
  pay = public.session_payload(old.session_id) || jsonb_build_object('person_name', p.full_name, 'slot', public.slot_label(old.slot));
  if auth.uid() = old.person_id then
    -- the contractor dropped their own spot: tell Mike
    admin_email = public.setting('admin_notify_email');
    if admin_email is not null then perform public.enqueue_mail('drop_notice', admin_email, null, pay); end if;
  elsif auth.uid() is not null then
    -- an admin removed them: tell the person
    perform public.enqueue_mail('admin_removed', p.email, p.full_name, pay);
  end if;
  insert into public.audit_log (actor, action, detail) values (auth.uid(), 'assignment.delete', to_jsonb(old));
  return old;
end $$;

create trigger assignments_after_delete after delete on public.assignments
  for each row execute function public.assignments_after_delete();

-- Cancelling a session tells everyone who had a spot.
create or replace function public.sessions_after_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; pay jsonb;
begin
  if old.status = 'scheduled' and new.status = 'cancelled' then
    for r in select a.slot, p.email, p.full_name from public.assignments a join public.people p on p.id = a.person_id where a.session_id = new.id loop
      pay = public.session_payload(new.id) || jsonb_build_object('person_name', r.full_name, 'slot', public.slot_label(r.slot));
      perform public.enqueue_mail('session_cancelled', r.email, r.full_name, pay);
    end loop;
  elsif new.status = 'scheduled' and (old.session_date, old.start_time, old.end_time, old.location) is distinct from (new.session_date, new.start_time, new.end_time, new.location) then
    for r in select a.slot, p.email, p.full_name from public.assignments a join public.people p on p.id = a.person_id where a.session_id = new.id loop
      pay = public.session_payload(new.id) || jsonb_build_object('person_name', r.full_name, 'slot', public.slot_label(r.slot),
              'old_date_text', to_char(old.session_date, 'FMDay, FMMonth FMDD, YYYY'));
      perform public.enqueue_mail('session_changed', r.email, r.full_name, pay);
    end loop;
  end if;
  insert into public.audit_log (actor, action, detail) values (auth.uid(), 'session.update', jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)));
  return new;
end $$;

create trigger sessions_after_update after update on public.sessions
  for each row execute function public.sessions_after_update();

-- First sign-in flips an invited person to active.
create or replace function public.auth_user_signed_in()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.last_sign_in_at is distinct from old.last_sign_in_at then
    update public.people set status = 'active', activated_at = coalesce(activated_at, now())
     where id = new.id and status = 'invited';
  end if;
  return new;
end $$;

create trigger auth_user_signed_in after update of last_sign_in_at on auth.users
  for each row execute function public.auth_user_signed_in();

-- ---------------------------------------------------------------------------------------------------------------
-- Reminders — run every 15 minutes by pg_cron; the mail-worker delivers whatever lands in the outbox.
--   * the Tuesday 11 days before the Saturday, from 8 AM Denver time
--   * 48 hours before the session starts
--   * an "open spots" note to Mike at the 11-day mark if the session isn't fully staffed
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.enqueue_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare r record; pay jsonb; n int := 0;
  days_before int := coalesce(public.setting('reminder_days_before'), '11')::int;
  hours_before int := coalesce(public.setting('reminder_hours_before'), '48')::int;
  local_now timestamp := now() at time zone 'America/Denver';
  admin_email text := public.setting('admin_notify_email');
begin
  for r in
    select a.session_id, a.person_id, a.slot, p.email, p.full_name, s.session_date,
           public.session_start_at(s) as start_at
      from public.assignments a
      join public.sessions s on s.id = a.session_id
      join public.people p on p.id = a.person_id
     where s.status = 'scheduled' and public.session_start_at(s) > now()
  loop
    pay = public.session_payload(r.session_id) || jsonb_build_object('person_name', r.full_name, 'slot', public.slot_label(r.slot));
    if local_now::date >= r.session_date - days_before and extract(hour from local_now) >= 8
       and not exists (select 1 from public.reminder_log l where l.session_id = r.session_id and l.person_id = r.person_id and l.kind = 'days') then
      perform public.enqueue_mail('reminder_days', r.email, r.full_name, pay || jsonb_build_object('days_before', days_before));
      insert into public.reminder_log (session_id, person_id, kind) values (r.session_id, r.person_id, 'days');
      n = n + 1;
    end if;
    if r.start_at - make_interval(hours => hours_before) <= now()
       and not exists (select 1 from public.reminder_log l where l.session_id = r.session_id and l.person_id = r.person_id and l.kind = 'hours') then
      perform public.enqueue_mail('reminder_hours', r.email, r.full_name, pay || jsonb_build_object('hours_before', hours_before));
      insert into public.reminder_log (session_id, person_id, kind) values (r.session_id, r.person_id, 'hours');
      n = n + 1;
    end if;
  end loop;

  -- staffing-gap note to the admin at the 11-day mark (logged against the session with a zero person id)
  if admin_email is not null then
    for r in
      select s.id, s.session_date from public.sessions s
       where s.status = 'scheduled' and public.session_start_at(s) > now()
         and local_now::date >= s.session_date - days_before and extract(hour from local_now) >= 8
         and (select count(*) from public.assignments a where a.session_id = s.id) < 3
         and not exists (select 1 from public.audit_log l where l.action = 'reminder.gap' and (l.detail->>'session_id')::uuid = s.id)
    loop
      perform public.enqueue_mail('staffing_gap', admin_email, null, public.session_payload(r.id));
      insert into public.audit_log (actor, action, detail) values (null, 'reminder.gap', jsonb_build_object('session_id', r.id));
      n = n + 1;
    end loop;
  end if;
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------------------------
alter table public.people enable row level security;
alter table public.sessions enable row level security;
alter table public.assignments enable row level security;
alter table public.settings enable row level security;
alter table public.mail_outbox enable row level security;
alter table public.reminder_log enable row level security;
alter table public.mail_accounts enable row level security;
alter table public.audit_log enable row level security;

-- people: you see your own row; admins see everyone. Names/roles for the roster come through the view below.
create policy people_self_read on public.people for select to authenticated using (id = auth.uid() or public.is_admin());
create policy people_admin_write on public.people for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- the roster view: everyone can see everyone's name and role (never emails)
create view public.roster_people with (security_invoker = false) as
  select id, full_name, role, status from public.people;
grant select on public.roster_people to authenticated;

create policy sessions_read on public.sessions for select to authenticated using (true);
create policy sessions_admin_all on public.sessions for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy assignments_read on public.assignments for select to authenticated using (true);
create policy assignments_take on public.assignments for insert to authenticated
  with check (person_id = auth.uid() or public.is_admin());
create policy assignments_drop on public.assignments for delete to authenticated
  using (public.is_admin() or (person_id = auth.uid() and public.can_drop(session_id)));

create policy settings_admin on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy outbox_admin_read on public.mail_outbox for select to authenticated using (public.is_admin());
create policy reminder_admin_read on public.reminder_log for select to authenticated using (public.is_admin());
create policy audit_admin_read on public.audit_log for select to authenticated using (public.is_admin());
-- mail_accounts: no policies — service role only.

-- ---------------------------------------------------------------------------------------------------------------
-- Cron: deliver the outbox every minute, check reminders every 15 minutes.
-- The worker URL + secret live in Vault so they never sit in a cron command.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.call_mail_worker()
returns void language plpgsql security definer set search_path = public as $$
declare url text; secret text;
begin
  select decrypted_secret into url from vault.decrypted_secrets where name = 'mail_worker_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'cron_secret';
  if url is null or secret is null then return; end if;
  if not exists (select 1 from public.mail_outbox where status = 'queued') then return; end if;
  perform net.http_post(url := url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
end $$;

select cron.schedule('signing-mail-worker', '* * * * *', $$select public.call_mail_worker()$$);
select cron.schedule('signing-reminders', '*/15 * * * *', $$select public.enqueue_reminders()$$);
