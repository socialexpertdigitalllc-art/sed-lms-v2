-- 0026_template_engine.sql — Template Engine: templates, generations, queue, cache, settings, perms

create table if not exists public.website_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  storage_prefix text not null,
  manifest jsonb not null default '{}'::jsonb,
  page_count int not null default 0,
  status text not null default 'active' check (status in ('active','archived')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.template_generations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  template_id uuid not null references public.website_templates(id) on delete restrict,
  tool text not null,
  model text not null,
  requested_pages jsonb not null default '[]'::jsonb,
  status text not null default 'queued' check (status in ('queued','running','ready_for_review','deployed','failed')),
  current_step text,
  steps jsonb not null default '[]'::jsonb,
  estimate_ms bigint,
  total_ms bigint,
  ai_ms bigint,
  tokens_used int not null default 0,
  cost_usd numeric(10,4) not null default 0,
  pages_built int not null default 0,
  images_used int not null default 0,
  ops_applied int not null default 0,
  ops_missed int not null default 0,
  site_slug text,
  zip_path text,
  deployed_url text,
  error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists template_generations_lead_idx on public.template_generations (lead_id, created_at desc);
create index if not exists template_generations_created_idx on public.template_generations (created_at desc);

create table if not exists public.template_gen_queue (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.template_generations(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','done','failed')),
  error text,
  enqueued_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists template_gen_queue_status_idx on public.template_gen_queue (status, created_at);

create table if not exists public.pexels_image_cache (
  query_norm text primary key,
  results jsonb not null,
  fetched_at timestamptz not null default now()
);

create table if not exists public.template_engine_settings (
  singleton boolean primary key default true check (singleton),
  system_prompt text not null default '',
  edit_prompt text not null default '',
  image_query_prompt text not null default '',
  max_tokens int not null default 6000,
  temperature numeric(3,2) not null default 0.4,
  updated_at timestamptz not null default now()
);

-- serial queue claim (own advisory key so template runs never block WGE)
create or replace function public.tge_claim_next()
returns table(id uuid, generation_id uuid, enqueued_by uuid)
language plpgsql
as $$
begin
  if not pg_try_advisory_xact_lock(8274) then return; end if;
  if exists (select 1 from public.template_gen_queue q where q.status = 'processing') then return; end if;
  return query
    update public.template_gen_queue q
       set status = 'processing', started_at = now()
     where q.id = (
       select q2.id from public.template_gen_queue q2
        where q2.status = 'pending'
        order by q2.created_at
        limit 1
        for update skip locked)
    returning q.id, q.generation_id, q.enqueued_by;
end $$;

create or replace function public.tge_reclaim_stale()
returns void language plpgsql as $$
begin
  update public.template_generations g set status = 'queued'
   where g.id in (select q.generation_id from public.template_gen_queue q
                   where q.status = 'processing' and q.started_at < now() - interval '20 minutes')
     and g.status = 'running';
  update public.template_gen_queue q set status = 'pending', started_at = null
   where q.status = 'processing' and q.started_at < now() - interval '20 minutes';
end $$;

-- RLS
alter table public.website_templates enable row level security;
alter table public.template_generations enable row level security;
alter table public.template_gen_queue enable row level security;
alter table public.pexels_image_cache enable row level security;
alter table public.template_engine_settings enable row level security;

create policy "read templates" on public.website_templates for select to authenticated
  using (public.has_permission('templates.generate') or public.has_permission('templates.manage'));
create policy "read template generations" on public.template_generations for select to authenticated
  using (public.has_permission('templates.generate') or public.has_permission('templates.manage'));
create policy "read template settings" on public.template_engine_settings for select to authenticated
  using (public.has_permission('templates.manage'));
-- queue/cache: service-role only (no policies)

-- realtime for the live tracker
alter table public.template_generations replica identity full;
alter publication supabase_realtime add table public.template_generations;

-- storage buckets (private)
insert into storage.buckets (id, name, public) values
  ('website-templates','website-templates', false),
  ('template-sites','template-sites', false)
on conflict (id) do nothing;

-- permissions
insert into public.permissions (key, name, description, category, is_sensitive) values
  ('templates.manage','Manage Website Templates',null,'templates',true),
  ('templates.generate','Generate From Templates',null,'templates',false),
  ('templates.deploy','Deploy Generated Websites',null,'templates',true),
  ('analytics.view_templates','View Template Engine Analytics',null,'templates',false)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, k.key from public.departments d
  cross join (values ('templates.manage'),('templates.generate'),('templates.deploy'),('analytics.view_templates')) as k(key)
  where d.slug in ('admin')
on conflict do nothing;
