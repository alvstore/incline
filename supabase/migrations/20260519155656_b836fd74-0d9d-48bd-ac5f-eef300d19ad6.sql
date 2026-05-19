create or replace function public.retry_ig_comment_run(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_branch uuid;
begin
  select branch_id into v_branch from public.ig_comment_runs where id = p_id;
  if v_branch is null then raise exception 'run not found'; end if;
  if not public.has_capability(auth.uid(), 'manage_automations') then
    raise exception 'forbidden';
  end if;
  if v_branch <> public.get_user_branch(auth.uid())
     and not public.has_any_role(auth.uid(), array['owner'::app_role, 'admin'::app_role]) then
    raise exception 'forbidden (branch)';
  end if;
  update public.ig_comment_runs
    set status = 'pending'::text,
        scheduled_at = now(),
        error_message = null
    where id = p_id and status in ('failed','skipped');
end;
$$;

grant execute on function public.retry_ig_comment_run(uuid) to authenticated;