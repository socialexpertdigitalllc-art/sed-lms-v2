-- 0094: hoist the per-row permission lookups out of the leads read policy.
--
-- WHY: "read leads scoped" (0070) called has_permission() for EVERY row —
-- two or three sub-selects against department_members / department_permissions
-- / user_permission_overrides per lead. Measured on prod (1,025 leads):
--   agent  (11 visible)   310 ms, 11,361 buffer hits
--   admin  (all visible) ~500 ms
-- and pg_stat_statements showed the plain "leads where deleted_at is null"
-- read as the #1 consumer of database time (~9,000 s over the stats window,
-- mean 556 ms, 16k calls), with the follow-ups badge count close behind.
-- After this migration the same reads take 8 ms / 13 ms.
--
-- HOW: a set-returning function yields the caller's effective permission
-- keys ONCE per statement (hashed SubPlan), and the policy tests membership
-- in that set. The visible-row set is identical: for every user on prod the
-- old and new predicates agreed on all 1,025 rows (0 mismatches).
--
-- Semantics kept exactly:
--   has_permission(k) ⇔ k ∈ { dept keys without an active revoke } ∪ { active grants }
--   is_closer_of(agent) ⇔ agent in (closer's assignments)   (null agent → false)
--
-- Rollback: re-run the policy block of 0070_closer_lead_visibility.sql.

create or replace function public.my_permission_keys()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select dp.permission_key
  from public.department_members dm
  join public.department_permissions dp on dp.department_id = dm.department_id
  where dm.user_id = auth.uid()
    and not exists (
      select 1 from public.user_permission_overrides o
      where o.user_id = auth.uid()
        and o.permission_key = dp.permission_key
        and o.is_granted = false
        and (o.expires_at is null or o.expires_at > now()))
  union
  select o.permission_key
  from public.user_permission_overrides o
  where o.user_id = auth.uid()
    and o.is_granted = true
    and (o.expires_at is null or o.expires_at > now());
$$;

comment on function public.my_permission_keys() is
  'Effective permission keys of the calling user — same rule as has_permission(), computed once per statement for RLS.';

drop policy if exists "read leads scoped" on public.leads;
create policy "read leads scoped" on public.leads for select to authenticated
using (
  (
    'leads.view_all' in (select public.my_permission_keys())
    or agent_id = (select auth.uid())
    or agent_id in (
      select ca.agent_id from public.closer_assignments ca
      where ca.closer_id = (select auth.uid()))
  )
  and ('leads.cat_view.' || lower(replace(status, ' ', '_'))) in (select public.my_permission_keys())
);
