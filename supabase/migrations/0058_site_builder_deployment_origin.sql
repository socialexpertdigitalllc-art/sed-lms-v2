-- 0058_site_builder_deployment_origin.sql — let studio_deployments record
-- Site Builder deploys under their own, honest origin label.
--
-- FILE ONLY. Do NOT apply — the operator's DB is production; they apply this
-- after review (matches 0057's own note).
--
-- Site Builder redeploys reuse the same DirectAdmin primitives and write to
-- this SAME table (spec: "keeps the existing deployments board working for
-- old and new sites alike") but, unlike a Site Studio run, have no
-- `studio_runs` row behind them — `run_id` stays NULL for these rows, the
-- same convention 0055 already uses for `origin='v2_import'` rows. Tagging
-- them 'studio' instead would be actively wrong (implies the Site Studio run
-- machine produced it); 'v2_import' is worse. A third label is the honest
-- option, matching 0055's own stated purpose: "a post-mortem can always tell
-- where a site came from."

alter table public.studio_deployments drop constraint studio_deployments_origin_check;
alter table public.studio_deployments add constraint studio_deployments_origin_check
  check (origin in ('studio','v2_import','builder'));
