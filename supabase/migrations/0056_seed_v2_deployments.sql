-- 0056_seed_v2_deployments.sql — Site Studio Phase 4b: deployments continuity.
--
-- Carries v2's live deployed sites into studio_deployments (spec §11.3) so the
-- Site Studio deployments board manages old and new sites through one surface,
-- and takedown/redeploy of a pre-v3 client site keeps working after the old
-- engine's code is deleted.
--
-- ADDITIVE AND IDEMPOTENT. It inserts records only. It never touches a
-- docroot: deployed client sites are static files and are not at risk here.
-- `on conflict (subdomain) do nothing` means a re-run is a no-op, and a
-- subdomain already claimed by a v3 run is left alone.
--
-- origin='v2_import' marks these rows, and run_id is null because they have no
-- studio run behind them — both are exactly what the board's origin badge and
-- the deploy service's guards already expect.
--
-- The subdomain is derived from deployed_url's leftmost label. Rows whose URL
-- doesn't parse to a single-label host under one domain are SKIPPED rather than
-- guessed at (a wrong subdomain here would let a future deploy overwrite an
-- unrelated live site), and are reported by the verification query in Task 7.
-- (Verified against lib/template-engine/directadmin.ts and the v2 deploy route:
-- deployed_url is always exactly `https://<sub>.<DA_DOMAIN>` with no path or
-- query string, and the docroot is always `/domains/<sub>.<DA_DOMAIN>/public_html`
-- — so the leftmost-label / path-strip derivations below match v2's own
-- deploy logic exactly, not just a guess at its shape.)
--
-- DO NOT APPLY as part of this commit — Task 7 applies this after the
-- acceptance gate (Task 5) signs off, against the shared production DB.
--
-- IMPORTANT — one_live_per_lead risk: studio_deployments has a partial unique
-- index, `studio_deployments_one_live_per_lead`, enforcing at most one
-- status='live' row per lead_id. If two template_generations rows for the SAME
-- lead are both status='deployed' with non-null deployed_url (and thus two
-- DIFFERENT subdomains), the second insert below violates that index and this
-- migration fails outright. Task 7 Step 1 pre-flights for exactly this case
-- before applying:
--   select lead_id, count(*) from public.template_generations
--    where status = 'deployed' and deployed_url is not null
--    group by lead_id having count(*) > 1;
-- If that query returns any rows, the fix is to seed only the most recent
-- generation per lead — wrap the SELECT below in
-- `distinct on (g.lead_id) ... order by g.lead_id, g.updated_at desc` — rather
-- than weakening the index, which is the real one-live-site-per-lead invariant.

insert into public.studio_deployments
  (lead_id, run_id, subdomain, docroot, url, status, origin, deployed_at, created_at, updated_at)
select
  g.lead_id,
  null,
  -- leftmost label of the host: https://acme.example.com -> acme
  split_part(regexp_replace(g.deployed_url, '^https?://', ''), '.', 1) as subdomain,
  '/domains/' || regexp_replace(regexp_replace(g.deployed_url, '^https?://', ''), '/.*$', '') || '/public_html' as docroot,
  g.deployed_url,
  'live',
  'v2_import',
  coalesce(g.updated_at, g.created_at, now()),
  now(),
  now()
from public.template_generations g
where g.status = 'deployed'
  and g.deployed_url is not null
  -- host must have at least three labels (sub.domain.tld) for the leftmost to
  -- be a real subdomain; anything else is a client's own domain or malformed
  and array_length(
        string_to_array(regexp_replace(regexp_replace(g.deployed_url, '^https?://', ''), '/.*$', ''), '.'),
        1
      ) >= 3
  and split_part(regexp_replace(g.deployed_url, '^https?://', ''), '.', 1) <> ''
on conflict (subdomain) do nothing;
