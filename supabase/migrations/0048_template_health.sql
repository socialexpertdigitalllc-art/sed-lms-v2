-- 0048_template_health.sql — the upload-time template health report
--
-- THE INCIDENTS THIS EXISTS FOR. Three bugs shipped because logic written
-- against the ORIGINAL template silently did nothing on a newly uploaded one:
-- a demo token ("King") that matched ordinary copy and made the leak gate
-- unpassable; a themeCss override bound to --brand on a template that only
-- declares --primary, so the client's colours never appeared; and a header with
-- no <img> slot plus a nav linking to pages the lead never ordered. Each was
-- invisible until generation time, i.e. after AI credits had been spent and
-- often after a human had reviewed the result.
--
-- lib/template-engine/health.ts runs those checks deterministically at upload
-- and the report lands here, so the templates admin can show a pass/warn/fail
-- pill and the generation launcher can warn before credits are spent.
--
-- Additive only, both columns nullable with no default. Templates uploaded
-- before this feature read back null, which the UI renders as "not checked" —
-- deliberately distinct from "checked and passed" — and the re-check route
-- (POST /api/template-engine/templates/[id]/health) fills them in on demand.
--
-- jsonb rather than a table of check rows: the report is written whole, read
-- whole, and never queried by individual check. A child table would buy joins
-- nobody needs and a second thing to keep in step with the check list.
alter table public.website_templates
  add column if not exists health jsonb,
  add column if not exists health_checked_at timestamptz;

-- No index. The column is only ever read alongside the template row it belongs
-- to (the admin list selects *, the launcher selects a handful of columns), and
-- the table holds a handful of rows.
