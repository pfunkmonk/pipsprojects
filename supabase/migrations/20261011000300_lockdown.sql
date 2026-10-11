-- Security advisor follow-up: internal SECURITY DEFINER functions must not be callable over the REST RPC surface.
-- Only is_admin() and can_drop() stay executable by signed-in users (RLS policies and the sessions_v view call them).

revoke execute on function public.enqueue_mail(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.enqueue_reminders() from public, anon, authenticated;
revoke execute on function public.call_mail_worker() from public, anon, authenticated;
revoke execute on function public.session_payload(uuid) from public, anon, authenticated;
revoke execute on function public.setting(text) from public, anon, authenticated;
revoke execute on function public.future_notary_spots(uuid) from public, anon, authenticated;
revoke execute on function public.assignments_validate() from public, anon, authenticated;
revoke execute on function public.assignments_after_insert() from public, anon, authenticated;
revoke execute on function public.assignments_after_delete() from public, anon, authenticated;
revoke execute on function public.sessions_after_update() from public, anon, authenticated;
revoke execute on function public.auth_user_signed_in() from public, anon, authenticated;
revoke execute on function public.is_admin() from anon;
revoke execute on function public.can_drop(uuid) from anon;

-- pin search_path on the remaining helpers
alter function public.session_start_at(public.sessions) set search_path = public;
alter function public.slot_label(public.slot_kind) set search_path = public;
alter function public.touch_updated_at() set search_path = public;
