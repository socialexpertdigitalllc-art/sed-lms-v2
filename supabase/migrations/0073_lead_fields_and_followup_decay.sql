-- Three new lead fields the submission form now collects, plus the clock the
-- "Specific time" badge decays on.
--
-- LEAD FIELDS
--   * owner_name             — the owner's own name, when the agent got it.
--   * developer_instructions — anything promised to the client that the build
--                              has to honour. Long free text, optional.
--   * social_profiles        — [{platform, url, label?}], as many as the
--                              business has. `label` names the network only
--                              when platform is "Other", so the canonical five
--                              round-trip back into the form's select.
--
-- SPECIFIC-TIME DECAY
-- 0068 added leads.follow_up_is_specific so the Follow-ups page could filter
-- on "the client asked for this exact time". That claim does not stay true
-- forever: once a day passes with nobody logging a follow-up, the exact time
-- the client named is stale and the lead belongs back in the ordinary queue.
-- Expiry is derived at read time (lib/leads/followups.ts isSpecificActive), so
-- it needs no cron and no background sweep — but it needs to know WHEN the
-- schedule was recorded, which leads.updated_at cannot say (any edit bumps it).

alter table public.leads
  add column if not exists owner_name text,
  add column if not exists developer_instructions text,
  add column if not exists social_profiles jsonb,
  add column if not exists follow_up_set_at timestamptz;

comment on column public.leads.owner_name is
  'The business owner''s own name. Optional.';
comment on column public.leads.developer_instructions is
  'Free-text instructions from the agent that the build must honour.';
comment on column public.leads.social_profiles is
  'Array of {platform, url, label?} — the business''s social profiles.';
comment on column public.leads.follow_up_set_at is
  'When the current follow_up_time was recorded. The Specific badge expires 24h after this; null never expires.';

-- Backfill from the follow-up that actually set each lead's current schedule,
-- so existing Specific leads decay from a real timestamp instead of hanging on
-- forever as un-aged nulls. Leads with no follow-up history stay null.
update public.leads l
set follow_up_set_at = fu.created_at
from (
  select distinct on (lead_id) lead_id, created_at
  from public.lead_follow_ups
  order by lead_id, created_at desc
) fu
where fu.lead_id = l.id
  and l.follow_up_set_at is null;
