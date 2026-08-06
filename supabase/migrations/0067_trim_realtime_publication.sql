-- Trim the realtime publication to tables that actually have subscribers.
--
-- No client subscribes to these three tables (verified against every
-- postgres_changes / useRealtimeRefresh call site: leads, pre_leads,
-- lead_tickets, feedback, wge_queue, notifications, template_generations are
-- the consumed set). Publishing the unsubscribed ones made the realtime
-- decoder process every change on the write-heavy follow-ups and tag-link
-- tables for zero consumers — wasted WAL decoding on an instance that is
-- depleting its disk-IO budget.
alter publication supabase_realtime drop table
  public.lead_follow_ups,
  public.lead_tag_links,
  public.ticket_items;
