-- 0081_website_cms.sql — Website CMS: the dashboard becomes the content
-- source for socialexpertdigitalllc.com (services/prices, offers, coupons,
-- testimonials, portfolio, stats) plus the publish → revalidate hook.
-- ADDITIVE ONLY. Shared prod DB (ikuvbxjkoojtgekapbul): new tables and
-- permission rows only. No drops, no type changes. The controller applies
-- this via the Supabase MCP after review, BEFORE the code deploy (the
-- public content routes read these tables).
--
-- RLS is enabled with NO policies on every table: all reads/writes go
-- through the service-role client. The public content API (/api/public/*)
-- is read-only, gated by website_settings.api_key, and serves only rows
-- flagged active/approved. website_settings holds the publish-hook secret
-- and the publishable read key, so it must NOT live in app_settings
-- (which any authenticated user can read).

create table if not exists public.website_services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  short_name text not null default '',
  tagline text not null default '',
  description text not null default '',
  icon text not null default '',
  features jsonb not null default '[]',
  tiers jsonb not null default '[]',
  quote_based boolean not null default false,
  starting_at text,
  market_comparison jsonb not null default '{}',
  faqs jsonb not null default '[]',
  pain_heading text not null default '',
  pains jsonb not null default '[]',
  included jsonb not null default '[]',
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.website_offers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  banner_text text not null default '',
  service_slug text,
  active boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.website_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null default '',
  discount_type text not null default 'percent' check (discount_type in ('percent','fixed')),
  amount numeric not null default 0 check (amount >= 0),
  -- null/empty = valid for every service
  service_slugs text[] not null default '{}',
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.website_testimonials (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  business text not null default '',
  quote text not null,
  rating int not null default 5 check (rating between 1 and 5),
  approved boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.website_portfolio (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  industry text not null default '',
  state text not null default '',
  live_url text not null default '',
  screenshot text,
  featured boolean not null default false,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.website_settings (
  singleton boolean primary key default true check (singleton),
  -- Live stats shown on the site; edited by hand until they're computed.
  stats jsonb not null default '{"sitesLaunched":100,"activeClients":80,"statesServed":12,"yearsActive":2}',
  -- Publish hook: POST {secret, tags} to <revalidate_url> on every save.
  revalidate_url text not null default 'https://socialexpertdigitalllc.com/api/revalidate',
  revalidate_secret text not null default '',
  -- Publishable key the website sends as x-sed-key on /api/public/* reads.
  -- Empty = reads are open (bootstrap mode before the key is set).
  api_key text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.website_services enable row level security;
alter table public.website_offers enable row level security;
alter table public.website_coupons enable row level security;
alter table public.website_testimonials enable row level security;
alter table public.website_portfolio enable row level security;
alter table public.website_settings enable row level security;

insert into public.website_settings (singleton) values (true)
on conflict (singleton) do nothing;

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('website.view',   'View Website CMS',   'See the agency website''s content, offers, coupons and settings.', 'website', false),
  ('website.manage', 'Manage Website CMS', 'Edit site content, offers, coupons, testimonials, portfolio and publish to the live website.', 'website', true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, 'website.view' from public.departments d where d.slug in ('sales','closing','admin')
on conflict do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, 'website.manage' from public.departments d where d.slug in ('admin')
on conflict do nothing;
