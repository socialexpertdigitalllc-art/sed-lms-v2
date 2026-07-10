# SED LMS v2 — Template Engine System

**Date:** 2026-07-10 · **Branch:** `template-engine` (off main @ 9ff89f7) · **Status:** approved ("everything is good, build it" + tweaks)

A second website-generation system beside WGE (WGE untouched): admin-uploaded HTML/CSS/JS template zips are copied per lead and customized by an LLM via **structured edit operations** (never full-file rewrites — DeepSeek 8k output cap), with a Pexels image subsystem, realtime step tracking + ETA, live preview, approve → zip download + **DirectAdmin auto-deploy** to `{business-slug}.dmviral.com`, auto-saving the URL to `leads.website_link`, and full timing analytics.

## Locked decisions
- Edit mechanism: per-page LLM call returns JSON find→replace ops; system applies deterministically + verifies; misses retried once then reported.
- **No template images survive**: template image files are not copied; every img slot is reassigned from the run's image pool; residual-reference check flags leftovers.
- Images: hero = Pexels (first service); one Pexels image per service; **area pages = lead `image_links[]` if provided, else an embedded keyless Google Maps iframe** (`https://www.google.com/maps?q={area}&output=embed`); other pages draw from pool (Pexels + image_links). Pexels picks downloaded into `images/` (self-contained zip). Query plan via 1 small LLM call; deterministic scoring (Pexels rank decay + alt-keyword overlap + resolution/aspect gates + action bonus + no-repeat variety); `pexels_image_cache` (query→results, ~30d) for the 200/hr limit. Env `PEXELS_API_KEY`. Pexels failure degrades (step "partial", run continues).
- Detail pages duplicated per `lead.services[]` / `lead.service_areas[]` **only if** service_detail/area_detail selected.
- Entry: `/ai-tools/template-engine` (lead picker) + lead-detail action. Manual only.
- Flow: queued → running → **ready_for_review** (live preview from storage via authed route + iframe; zip downloadable) → **Approve & Deploy** → DA subdomain + upload + extract + verify → `deployed`; then auto `leads.website_link = https://{sub}.dmviral.com` (http fallback) + activity_log.
- Deploy = DirectAdmin legacy API (Basic auth user+login key): `CMD_API_SUBDOMAINS action=add domain=dmviral.com`, zip upload via `CMD_FILE_MANAGER action=upload` (multipart), `action=extract`, delete zip; collision → suffix `-{websiteId}`. Env-gated: `DA_HOST`, `DA_USERNAME`, `DA_LOGIN_KEY`, `DA_DOMAIN` (unset → deploy button explains "not configured"). Subdomain docroot `~/domains/{DA_DOMAIN}/public_html/{sub}`.
- Realtime tracking: `template_generations.steps` jsonb timeline (key,label,status,started_at,ms,detail) + `current_step`, updated per transition; UI subscribes via supabase realtime (BellBase pattern). ETA = rolling avg per-page ms for template+engine (fallback global avg → 25s/page) × remaining, re-projected per step.
- Queue: `template_gen_queue` mirroring wge_queue with its own claim RPC + **separate advisory lock key** (template runs never block WGE).
- Prompt control: `template_engine_settings` singleton (system_prompt, edit prompt template w/ placeholders, image query prompt, max_tokens, temperature) editable on the Templates admin surface.
- Analytics: per-run totals + per-step/page ms, tokens, cost, pages, images, ops applied/missed → Analytics tab on the Template Engine page (KPIs, per-template/per-engine avgs, runs table). ai_generations untouched.

## Schema (migration 0026, + storage buckets `website-templates`, `template-sites`, both private)
- `website_templates`: id, name, slug unique, storage_prefix, manifest jsonb {pages:[{file,title,kind}], css[], js[], components, assets[], imageFiles[], totalBytes}, page_count, status active|archived, created_by, timestamps. Page kinds: home|about|services_hub|areas_hub|gallery|contact|service_detail|area_detail|other (filename-inferred, editable).
- `template_generations`: id, lead_id→leads, template_id→website_templates, tool, model, requested_pages jsonb, status queued|running|ready_for_review|deployed|failed, current_step, steps jsonb, estimate_ms, total_ms, ai_ms, tokens_used, cost_usd numeric, pages_built, images_used, ops_applied, ops_missed, site_slug, zip_path, deployed_url, error, created_by, timestamps. In supabase_realtime publication.
- `template_gen_queue`: id, generation_id→template_generations, status pending|processing|done|failed, error, enqueued_by, timestamps. RPCs `tge_claim_next()` / `tge_reclaim_stale()` (advisory key 8274).
- `pexels_image_cache`: query_norm text pk, results jsonb, fetched_at.
- `template_engine_settings`: singleton bool pk true, system_prompt, edit_prompt, image_query_prompt, max_tokens int, temperature numeric.
- Perms (category `templates`): `templates.manage` (sensitive), `templates.generate`, `templates.deploy` (sensitive), `analytics.view_templates`. RLS: selects gated by has_permission (generate-or-manage for generations; manage for settings), writes service-role.

## Key modules
- `lib/template-engine/zip.ts` — fflate-based unzip/inspect (new dep `fflate`); reuse existing store-only writer for output zip (server-side variant returning Uint8Array).
- `manifest.ts` (TDD) — classify pages by filename, build manifest, validate (≥1 html, css/js present ok-optional, size caps 25MB zip / 60MB extracted).
- `editOps.ts` (TDD) — parse LLM JSON `{ops:[{file?,find,replace}]}`; normalize-whitespace exact-then-fuzzy apply; report applied/missed; `residualImageRefs(html[]|css)` check.
- `pexels.ts` (TDD scoring) — search w/ cache, `scorePhoto(photo, slot)`, `pickImages(plan)`; download to bytes.
- `slug.ts` — business slug + 6-char base36 websiteId.
- `runner.ts` — orchestration (steps above), per-step timing writes, callProvider reuse from `lib/ai-tools/run`.
- `directadmin.ts` — daCall (Basic auth, URL-encoded legacy responses `error=1&text=…`), createSubdomain, uploadZip (multipart), extract, delete, exists; `deploySite(gen)`; `daConfigured()`.
- API: `app/api/template-engine/` — `templates` (GET/POST upload zip / PATCH id / archive), `generate` (POST), `process` (queue drain, x-wge-secret reuse), `generations` (GET list), `generations/[id]` (GET), `.../download`, `.../deploy` (POST, templates.deploy), `preview/[id]/[...path]` (authed storage streaming w/ content types), `settings` (GET/PUT manage).
- UI: sidebar AI Tools + "Template Engine" (`templates.generate`) + "Templates" (`templates.manage`). `/ai-tools/templates` = library (upload dropzone, manifest kind editor, archive) + settings card. `/ai-tools/template-engine` = generate form (lead/template/pages/engine), **live tracker** (realtime steps + ETA), runs table w/ preview/download/deploy/analytics tab. Lead detail: "Generate from template" link. Toasts on completion/deploy.

## Out of scope v1
Auto-queue, per-subdomain LetsEncrypt issuance, CSS color theming, business photo uploads at generation time, editing generated sites in-app, Canadian codes... (unchanged from brainstorm).

## User-provided config pending
`PEXELS_API_KEY` (have), `DA_HOST`, `DA_USERNAME`, `DA_LOGIN_KEY`, `DA_DOMAIN=dmviral.com` + wildcard/NS DNS for dmviral.com. Deploy ships env-gated and untested-live until creds are provided.
