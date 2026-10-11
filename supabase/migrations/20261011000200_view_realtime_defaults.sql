-- Session view with the computed start instant and the "can still drop" flag, realtime for the roster,
-- and the admin-editable defaults for new sessions.

create view public.sessions_v with (security_invoker = true) as
  select s.*, public.session_start_at(s) as start_at, public.can_drop(s.id) as can_drop
  from public.sessions s;
grant select on public.sessions_v to authenticated;

alter publication supabase_realtime add table public.assignments, public.sessions;

insert into public.settings (key, value) values
  ('default_start_time', '08:30'),
  ('default_end_time', '16:00'),
  ('default_location', '7350 E. Progress Place Suite 100, Greenwood Village, CO 80111')
on conflict (key) do nothing;

-- non-admins may read the defaults (nothing sensitive); everything else in settings stays admin-only
create policy settings_read_defaults on public.settings for select to authenticated
  using (key like 'default\_%' escape '\');
