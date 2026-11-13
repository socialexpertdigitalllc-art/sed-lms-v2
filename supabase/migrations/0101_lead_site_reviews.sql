-- 0101_lead_site_reviews.sql — a published website waits for the developer.
-- ADDITIVE ONLY (shared prod DB): one table, one policy, one trigger, one rule.
-- No drops: re-running it is harmless.
--
-- Before: Site Builder (and Site Studio, the template engine) wrote a fresh
-- deploy straight into leads.website_link, so every agent saw it at once —
-- and sales sent clients sites the developer was still working on.
--
-- Now a publish lands HERE, one row per lead (lib/leads/siteReview.ts). Only
-- developers can read it (tickets.resolve / studio.manage — the Tech and
-- Admin departments by default), so the link cannot leak through the
-- browser's live copy of the leads. The developer reviews and fixes the site,
-- then presses Finalize: the link moves to leads.website_link for everyone,
-- the agent and closer are notified, and this row is deleted.

create table if not exists public.lead_site_reviews (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  url text not null,
  -- which publisher put it here: site_builder | site_studio | template_engine
  source text not null default 'site_builder',
  -- the builder run / studio run / generation that produced it, when known
  run_id text,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz not null default now()
);

alter table public.lead_site_reviews enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'lead_site_reviews' and policyname = 'developers read site reviews'
  ) then
    create policy "developers read site reviews" on public.lead_site_reviews for select to authenticated
      using (public.has_permission('tickets.resolve') or public.has_permission('studio.manage'));
  end if;
end $$;

-- Live: an open lead page (and anything listening) hears about it (0099).
create or replace trigger trg_lead_site_reviews_live_tick
  after insert or update or delete on public.lead_site_reviews
  for each row execute function public.broadcast_row_tick();

-- Who hears "a website is waiting for your review": the developers.
insert into public.notification_rules (event_key, enabled, target_departments, target_users, target_roles, delay_minutes) values
  ('website_in_review', true, '{tech,admin}', '{}', '{}', 0)
on conflict (event_key) do nothing;
