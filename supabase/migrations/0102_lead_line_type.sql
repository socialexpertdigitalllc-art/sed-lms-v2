-- 0102_lead_line_type.sql — the HitList's Direct Line / Not Direct Line tag.
-- ADDITIVE ONLY (shared prod DB): one nullable column and its check.
--
-- Set with one click on the HitList (lib/hitlist/line.ts, PUT
-- /api/hitlist/[leadId]/line) by anyone who can see the HitList. Separate from
-- the New Lead form's "Direct Line saved?" (direct_line_saved): this one
-- starts empty and only the HitList sets it. NULL = not set yet.

alter table public.leads add column if not exists line_type text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_line_type_check') then
    alter table public.leads add constraint leads_line_type_check
      check (line_type is null or line_type in ('direct', 'not_direct'));
  end if;
end $$;
