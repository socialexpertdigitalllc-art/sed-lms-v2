-- 0100_lead_no_platform_color_instructions.sql — two choices on the New Lead form.
-- ADDITIVE ONLY (shared prod DB): two boolean columns with safe defaults.
--
--  no_platform             the agent ticked "No Platform": the business has no
--                          Google / Yelp / other listing, so platform and the
--                          profile link are empty on purpose.
--  color_see_instructions  the agent ticked "See Instructions" on Color Scheme:
--                          the client gave colour ideas rather than colours, and
--                          they are in Instructions for Developer.
--
-- Both are tolerated as absent by the app (lib/leads/lateColumns.ts) until
-- this is applied.

alter table public.leads add column if not exists no_platform boolean not null default false;
alter table public.leads add column if not exists color_see_instructions boolean not null default false;

comment on column public.leads.no_platform is
  'New Lead form: "No Platform" ticked — no listing, so platform and business_profile_link are empty on purpose.';
comment on column public.leads.color_see_instructions is
  'New Lead form: "See Instructions" ticked on Color Scheme — colour ideas are in developer_instructions instead of colours.';
