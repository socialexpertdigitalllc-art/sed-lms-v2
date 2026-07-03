-- SQL mirror of the app permission resolver: does the current user have `perm`?
create or replace function public.has_permission(perm text) returns boolean
language sql security definer stable set search_path = public as $$
  select (
    exists (
      select 1 from department_members dm
      join department_permissions dp on dp.department_id = dm.department_id
      where dm.user_id = auth.uid() and dp.permission_key = perm
    ) and not exists (
      select 1 from user_permission_overrides o
      where o.user_id = auth.uid() and o.permission_key = perm and o.is_granted = false
        and (o.expires_at is null or o.expires_at > now())
    )
  ) or exists (
    select 1 from user_permission_overrides o
    where o.user_id = auth.uid() and o.permission_key = perm and o.is_granted = true
      and (o.expires_at is null or o.expires_at > now())
  );
$$;

-- a user sees a lead only if they can view all leads, or it's assigned to them
drop policy if exists "read leads" on public.leads;
create policy "read leads scoped" on public.leads for select to authenticated
  using (public.has_permission('leads.view_all') or agent_id = auth.uid());
