-- 0082_website_leads.sql — inbound leads from socialexpertdigitalllc.com land
-- in the Website CMS as the agency's own internal website leads, instead of
-- the client-facing Form Relay inbox.
-- ADDITIVE ONLY. Shared prod DB: one new table, one notification rule.
-- RLS enabled with NO policies: written by /api/public/leads (service role,
-- key + rate gated) and read/updated behind website.view / website.manage.

create table if not exists public.website_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text not null default '',
  message text not null default '',
  service_slug text,
  tier_name text,
  coupon text,
  -- The coupon verdict at submit time, so a since-expired code still reads right.
  coupon_valid boolean,
  source_page text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  ip text,
  user_agent text,
  is_spam boolean not null default false,
  spam_reason text check (spam_reason is null or spam_reason in ('honeypot','too_fast','rate_ip','manual')),
  status text not null default 'new' check (status in ('new','contacted','qualified','won','lost')),
  notes text not null default '',
  assigned_to uuid references public.profiles(id) on delete set null,
  contacted_at timestamptz,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists website_leads_created_idx on public.website_leads (created_at desc);
-- Nav badge / "new" filter: count of new, non-spam leads.
create index if not exists website_leads_new_idx on public.website_leads (created_at)
  where status = 'new' and is_spam = false;

alter table public.website_leads enable row level security;

insert into public.notification_rules (event_key, enabled, target_departments, target_users, target_roles, delay_minutes) values
  ('website_lead_received', true, '{admin}', '{}', '{}', 0)
on conflict (event_key) do nothing;
