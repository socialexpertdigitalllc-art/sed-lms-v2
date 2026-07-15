-- 0033_user_scoped_tags.sql — tags become user-scoped, with admin sharing + view-all
--
-- Re-architects the GLOBAL tag catalog (0032) into a per-owner model:
--   * every tag has an owner (`lead_tags.owner_id`); a user sees only their own
--     tags by default.
--   * `leads.tags.view_all` (sensitive) — see every user's tags on leads.
--   * `leads.tags.share`    (sensitive) — let chosen departments/users see your
--     tags on leads, recorded in `lead_tag_shares`.
-- `can_see_user_tags(owner)` centralises visibility (own OR view_all OR an active
-- share) and is reused by every tag/link SELECT policy.

-- ── lead_tags: add owner, backfill from created_by, per-owner name uniqueness ──
alter table public.lead_tags
  add column owner_id uuid references public.profiles(id) on delete cascade;
update public.lead_tags set owner_id = created_by where owner_id is null;
alter table public.lead_tags alter column owner_id set not null;

-- The 0032 inline `unique(name)` (constraint `lead_tags_name_key`) becomes
-- per-owner so two users can each keep a tag with the same name.
alter table public.lead_tags drop constraint lead_tags_name_key;
alter table public.lead_tags add constraint lead_tags_owner_name_key unique (owner_id, name);

-- ── lead_tag_shares (NEW): who may see a given owner's tags ──
create table if not exists public.lead_tag_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('user','department')),
  target_id uuid not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(owner_id, target_type, target_id)
);
create index if not exists lead_tag_shares_owner_idx on public.lead_tag_shares (owner_id);

alter table public.lead_tag_shares enable row level security;

-- ── permissions (0029 pattern) — granted to admin only; extend via the grid ──
insert into public.permissions (key, name, description, category, is_sensitive) values
  ('leads.tags.view_all','View All Users'' Tags','See every user''s tags on leads, not just your own','leads',true),
  ('leads.tags.share','Share Tags','Let chosen departments/users see your tags on leads','leads',true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, k.key from public.departments d
  cross join (values ('leads.tags.view_all'),('leads.tags.share')) as k(key)
  where (d.slug, k.key) in (
    ('admin','leads.tags.view_all'),('admin','leads.tags.share')
  )
on conflict do nothing;

-- ── visibility helper (SECURITY DEFINER so it can read shares/memberships) ──
create or replace function public.can_see_user_tags(owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select owner = auth.uid()
    or public.has_permission('leads.tags.view_all')
    or exists (
      select 1 from public.lead_tag_shares s
      where s.owner_id = owner and (
        (s.target_type = 'user' and s.target_id = auth.uid())
        or (s.target_type = 'department' and exists (
          select 1 from public.department_members dm
          where dm.user_id = auth.uid() and dm.department_id = s.target_id))
      ));
$$;

-- ── replace the four global tag policies with owner-scoped ones ──
drop policy if exists "read lead tags" on public.lead_tags;
drop policy if exists "write lead tags" on public.lead_tags;
drop policy if exists "read lead tag links" on public.lead_tag_links;
drop policy if exists "write lead tag links" on public.lead_tag_links;

-- SELECT a tag: hold a tag permission AND be allowed to see the owner's tags.
create policy "read lead tags" on public.lead_tags for select to authenticated
  using (
    (public.has_permission('leads.tags.view') or public.has_permission('leads.tags.manage'))
    and public.can_see_user_tags(owner_id)
  );
-- Writes are owner-only (the API also enforces this; RLS is defence-in-depth).
create policy "write lead tags" on public.lead_tags for all to authenticated
  using (owner_id = auth.uid() and public.has_permission('leads.tags.manage'))
  with check (owner_id = auth.uid() and public.has_permission('leads.tags.manage'));

-- SELECT a link: tag permission AND the link's tag owner is visible to you.
create policy "read lead tag links" on public.lead_tag_links for select to authenticated
  using (
    (public.has_permission('leads.tags.view') or public.has_permission('leads.tags.manage'))
    and exists (
      select 1 from public.lead_tags t
      where t.id = tag_id and public.can_see_user_tags(t.owner_id)
    )
  );
-- Write a link only for a tag you own.
create policy "write lead tag links" on public.lead_tag_links for all to authenticated
  using (
    public.has_permission('leads.tags.manage')
    and exists (select 1 from public.lead_tags t where t.id = tag_id and t.owner_id = auth.uid())
  )
  with check (
    public.has_permission('leads.tags.manage')
    and exists (select 1 from public.lead_tags t where t.id = tag_id and t.owner_id = auth.uid())
  );

-- ── lead_tag_shares RLS ──
create policy "read lead tag shares" on public.lead_tag_shares for select to authenticated
  using (
    owner_id = auth.uid()
    or public.has_permission('leads.tags.view_all')
    or public.has_permission('leads.tags.share')
  );
create policy "write lead tag shares" on public.lead_tag_shares for all to authenticated
  using (owner_id = auth.uid() and public.has_permission('leads.tags.share'))
  with check (owner_id = auth.uid() and public.has_permission('leads.tags.share'));
