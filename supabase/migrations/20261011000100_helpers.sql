-- Helpers used by the admin edge function.

-- Look up an auth user by email (the admin API has no direct "get by email").
create or replace function public.user_id_by_email(p_email text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
revoke all on function public.user_id_by_email(text) from public, anon, authenticated;

-- People who hold a future notary spot — used to warn when a notary is switched to witness.
create or replace function public.future_notary_spots(p_person uuid)
returns table (session_date date) language sql stable security definer set search_path = public as $$
  select s.session_date from public.assignments a join public.sessions s on s.id = a.session_id
   where a.person_id = p_person and a.slot = 'notary' and s.status = 'scheduled' and public.session_start_at(s) > now()
   order by 1;
$$;
