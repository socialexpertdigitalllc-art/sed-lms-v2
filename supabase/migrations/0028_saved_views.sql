-- 0028_saved_views.sql — per-user named table views (a saved filter/sort/columns URL query per path)
create table if not exists public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  path text not null,
  query text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists saved_views_user_idx on public.saved_views (user_id, path, created_at);

alter table public.saved_views enable row level security;
create policy "own saved views" on public.saved_views for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
