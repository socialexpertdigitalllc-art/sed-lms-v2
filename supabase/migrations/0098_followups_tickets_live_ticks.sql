-- 0098_followups_tickets_live_ticks.sql — live ticks for follow-ups and tickets.
-- ADDITIVE ONLY (shared prod DB): two triggers on the function from 0097.
--
-- The Dashboard now keeps the follow-ups in the browser too (only new ones are
-- read — lib/leads/liveSync.ts with a created_at cursor) and re-reads the small
-- tickets list when it changes (hooks/useTickRefetch.ts). Both learn of a
-- change from the same "lms:leads" broadcast; the payload's `table` says which.

drop trigger if exists trg_lead_follow_ups_live_tick on public.lead_follow_ups;
create trigger trg_lead_follow_ups_live_tick
  after insert or update or delete on public.lead_follow_ups
  for each statement execute function public.broadcast_leads_tick();

drop trigger if exists trg_lead_tickets_live_tick on public.lead_tickets;
create trigger trg_lead_tickets_live_tick
  after insert or update or delete on public.lead_tickets
  for each statement execute function public.broadcast_leads_tick();
