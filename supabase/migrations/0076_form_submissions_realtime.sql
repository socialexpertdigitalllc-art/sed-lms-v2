-- 0076_form_submissions_realtime.sql — live Forms inbox.
--
-- The Forms inbox refetched only on a full page load: a submission arriving
-- while the tab was open bumped the sidebar badge (nav-counts poll) but the
-- table stayed stale. postgres_changes events are RLS-filtered per
-- subscriber, and 0075 deliberately gave form_submissions NO policies
-- (service-role only) — so with no select policy every event was filtered
-- out, and the table wasn't in the publication anyway.
--
-- Same pattern 0026 used for template_generations: a read policy for
-- authenticated staff plus publication membership. The dashboard is
-- internal-only and forms.view is granted department-wide; the inbox itself
-- still loads rows through the service-role API behind the scope check —
-- the event is only a poke to refetch.

create policy "read form submissions (realtime)" on public.form_submissions
  for select to authenticated using (true);

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'form_submissions'
  ) then
    alter publication supabase_realtime add table public.form_submissions;
  end if;
end $$;
