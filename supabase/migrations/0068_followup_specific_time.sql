-- "Specific time" follow-ups.
--
-- An agent distinguishes "call them back sometime Tuesday" from "the client
-- ASKED for 3:15pm Tuesday". The second kind must be visible at a glance and
-- filterable, because missing it costs the appointment.
--
-- Two columns, deliberately:
--   * lead_follow_ups.is_specific_time — the audit trail: what was true when
--     this follow-up was logged.
--   * leads.follow_up_is_specific — what the Follow-ups PAGE filters on. That
--     page lists LEADS by leads.follow_up_time (not follow-up rows), so the
--     flag has to travel with the same column the schedule lives on and is
--     rewritten by every follow-up that reschedules the lead.

alter table public.lead_follow_ups
  add column if not exists is_specific_time boolean not null default false;

alter table public.leads
  add column if not exists follow_up_is_specific boolean not null default false;

comment on column public.lead_follow_ups.is_specific_time is
  'The client asked for this exact time (not an approximate window).';
comment on column public.leads.follow_up_is_specific is
  'Mirrors the latest follow-up''s is_specific_time for the current follow_up_time.';

-- Filtering "show me only specific-time follow-ups" scans the same rows the
-- page already selects (eligible statuses with a due time), so keep it cheap.
create index if not exists leads_follow_up_specific_idx
  on public.leads (follow_up_is_specific, follow_up_time)
  where deleted_at is null and follow_up_is_specific;
