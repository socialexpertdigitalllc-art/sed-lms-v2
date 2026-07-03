-- Phase 5 realtime fix: RLS-gated postgres_changes need the FULL row to
-- evaluate row-level policies on UPDATE/DELETE (default replica identity only
-- ships the primary key, so the realtime RLS check can't see agent_id etc. and
-- silently drops the event).
alter table public.leads replica identity full;
alter table public.pre_leads replica identity full;
alter table public.wge_queue replica identity full;
