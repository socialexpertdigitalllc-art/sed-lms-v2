-- A closer must SEE their team's leads.
--
-- The hierarchy (migration 0069) let a closer ACT on their agents' leads, but
-- reading is gated by RLS, and the leads policy only ever allowed
-- `leads.view_all OR agent_id = auth.uid()`. A closer without the blanket
-- view_all permission therefore saw only their own leads — their whole team's
-- work was invisible at the DATABASE level, so no amount of app-side scoping
-- could show it (observed on prod: a closer with 6 agents and 222 team leads
-- saw 181 — his own — and an empty team view).
--
-- Visibility now follows the org chart. Note what is NOT relaxed: the
-- category gate still applies, so a closer sees their team's leads only in
-- the statuses they are allowed to see at all.
--
-- `lead_follow_ups`, `lead_tickets` and `ticket_items` cascade off this policy
-- (their own policies are EXISTS-on-leads), so they follow automatically.

create or replace function public.is_closer_of(agent uuid)
returns boolean
language sql
security definer
stable
set search_path = public as $$
  select agent is not null and exists (
    select 1 from public.closer_assignments ca
    where ca.agent_id = agent and ca.closer_id = auth.uid()
  );
$$;

comment on function public.is_closer_of(uuid) is
  'True when the current user is the closer this agent reports to. SECURITY DEFINER so the policy can read closer_assignments regardless of the caller.';

drop policy if exists "read leads scoped" on public.leads;
create policy "read leads scoped" on public.leads for select to authenticated
using (
  (
    has_permission('leads.view_all')
    or agent_id = auth.uid()
    or public.is_closer_of(agent_id)
  )
  and has_permission('leads.cat_view.' || lower(replace(status, ' ', '_')))
);
