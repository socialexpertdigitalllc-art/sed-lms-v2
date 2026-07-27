# Site Builder — the plan

**The concept, in one line:** the template goes to the AI as reference; the AI writes the site; the operator approves; it deploys.

```
lead details + template zip + chosen images
        -> one AI call per page, in parallel, returns FULL rewritten HTML
        -> plus any extra pages the lead asked for, imitating the template
        -> preview, regenerate any page, approve
        -> deploy to subdomain (existing code)
```

## Decisions (locked by the operator)
1. **Full HTML per page.** The AI gets one page's HTML + business details + chosen image URLs, and returns that page's complete rewritten HTML. It may change anything: copy, logo, colours, image sources, layout.
2. **The AI may create pages the template doesn't have**, when the lead's `specify_pages` asks for them, imitating the template's design.
3. **Fresh, minimal build.** New `lib/site-builder/` namespace. Nothing inherited from the Site Studio compile/token/render/cockpit machinery.

## Explicitly NOT in this system
No compiler. No tokens. No manifest. No health checks. No certification. No round-trip verification. No gate machine. No slot/repeat extraction. If a future task proposes any of these, it is out of scope.

## Kept, untouched
Leads. The DirectAdmin deploy layer. `studio_deployments` + the deployments board. The Pexels client, asset library and rehost services (`lib/site-studio/assets/*`) — these are plain, tested services and are reused as-is.

## Tasks

### 1. Migration: two small tables
`builder_templates` (id, name, storage_path, page_files text[], created_by, created_at) and
`builder_runs` (id, lead_id, template_id, status, options jsonb, images jsonb, output_path, deployed_url, error, created_by, timestamps).
Statuses: `queued | generating | review | approved | deployed | failed`. RLS on, no policies (service-role only), `builder_` prefix. Bucket `builder-sites` for output zips; template zips go in a `builder-templates` bucket.

### 2. Template storage
Upload a zip, list, delete. Store the zip; record which files are HTML pages and which are assets. **No analysis of the HTML beyond splitting pages from assets.**

### 3. The prompt + one-page generation
`lib/site-builder/generate.ts`: given one page's HTML, the business details, and the chosen image URLs, produce the rewritten page. Rules in the prompt: keep the design and structure; replace all demo business identity with the client's; use the supplied images; apply the client's colours; never invent licences/awards/years/prices; return only HTML. Injectable model call so tests never hit the network.

### 4. Run the whole site
Pages generate in parallel. Extra pages requested by the lead are generated from the closest template page as a design reference. Assets (css/js/img) copy through untouched. Assemble into a zip. Per-page failure is recorded and retryable on its own — never kills the run.

### 5. Screens
One flow: pick lead -> pick template -> pick images (library / Pexels / client photos / upload) -> Generate -> preview with page tabs -> "Regenerate this page" with an optional instruction -> Approve -> Deploy.

### 6. Deploy
Reuse the DirectAdmin primitives and write a `studio_deployments` row so the existing deployments board keeps working for old and new sites alike.

## Done when
A real lead + a real template produces a real site, deployed to a subdomain, with no manual template preparation of any kind.
