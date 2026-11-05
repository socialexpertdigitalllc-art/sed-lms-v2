-- 0097_leads_live_ticks.sql — the live leads store's "something changed" tick.
-- ADDITIVE ONLY (shared prod DB): two triggers, one function, one index.
--
-- The leads screens now keep a copy of the leads in the browser and read only
-- what changed (lib/leads/liveSync.ts, docs/sops/live-leads.md). They learn
-- that something changed from this tick: one Realtime broadcast per write
-- STATEMENT on leads or lead_tag_links, on the public topic 'lms:leads'.
--
-- The tick carries no lead data, only which table changed — each screen then
-- reads the changed rows itself, under its own row-level security. That is why
-- the topic can be public, and why one tick costs the same for 1 open tab or
-- 500 (postgres_changes ran the RLS check once per listening tab per change).
--
-- A failed broadcast must never fail the write: the exception is swallowed,
-- and the screens' own safety check (every minute, and on focus) catches up.

create or replace function public.broadcast_leads_tick()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('table', tg_table_name, 'op', tg_op),
      'changed',
      'lms:leads',
      false
    );
  exception when others then
    null;
  end;
  return null;
end;
$$;

revoke all on function public.broadcast_leads_tick() from public, anon, authenticated;

drop trigger if exists trg_leads_live_tick on public.leads;
create trigger trg_leads_live_tick
  after insert or update or delete on public.leads
  for each statement execute function public.broadcast_leads_tick();

drop trigger if exists trg_lead_tag_links_live_tick on public.lead_tag_links;
create trigger trg_lead_tag_links_live_tick
  after insert or update or delete on public.lead_tag_links
  for each statement execute function public.broadcast_leads_tick();

-- "Changed since my last sync" reads: updated_at > cursor, ordered by it.
create index if not exists leads_updated_at_idx on public.leads (updated_at);
