# SOP 03 — Troubleshooting

## A run parked at "Awaiting review" is not stuck

Status `reviewing` **is Gate 1, working as designed** — it is not a hang, and it will never clear on its own. The background advancer (the cron that finishes abandoned steps for runs nobody's actively driving) structurally cannot cross this status: `nextStep("reviewing")` is `null` by design, so there is no machine step left for it to run. The **only** way past it is a human clicking **Approve & render** in the cockpit (see SOP 02 §4). If a run has sat at `reviewing` for a long time, that just means nobody has reviewed it yet — go review it.

## A page failed to write

Each page gets up to **2** write attempts. A page card showing **Failed** has a **Retry** button — click it and the cockpit resumes driving. If a page **exhausts both attempts**, the whole run is failed (not just that page), and the run's error names the stuck page(s) and the last error each hit. This is deliberate: retrying forever would leave the run wedged at `preparing` permanently with no way out. There's no retry-a-failed-run action — start a new run against the same lead once whatever caused the failures (usually a transient model/API error) has passed.

## A run failed at `prepare`, before any content was written

The message names exactly which lead field is missing (business name, phone, email, map link, etc.) — see SOP 02 §2. The fix is always the same: add the missing field to the lead record and **start a new run**; a failed run cannot be resumed or repaired in place.

## Render refused with a list of missing slots

If `render` or `finalize` fails with `Render refused: missing <page>/<slot>, ...`, the run's content document doesn't have everything the compiled template needs to produce a complete site — most commonly because a picked image's asset failed to resolve (see the next entry), or because a page/slot the template declares was never populated. The run fails naming every missing `page_id/slot_id` pair; there is no partial-site output. Check the named pages back at Gate 1 if the run can be restarted, or open a new run.

A closely related failure is `Finalize refused: picked image(s) failed to resolve — missing asset(s): <ids>` — this means an image that was picked earlier can no longer be loaded from storage (a deleted `studio_assets` row, a storage read failure). Re-pick the image for the named slot(s) and retry.

## Pause / Resume / Cancel

- **Pause** stops the cockpit (and the advancer cron) from claiming the next step for this run — nothing else changes. **Resume** lets it continue exactly where it left off.
- **Cancel** is available on any non-terminal run and is final — a cancelled run cannot be resumed; start a new one.
- Both buttons disappear once a run reaches `ready`, `failed`, or `cancelled` — there's nothing left to pause or cancel at that point.

## A deploy failed, or there's no Deploy button at all

**Known gap, as of this writing:** the Deploy button shown on the Gate 2 preview (`components/site-studio/RunPreview.tsx`) is permanently disabled with the tooltip "Deploy lands in Task 9" — a leftover from before the deploy backend (`lib/site-studio/deploy/deployRun.ts`, `app/api/site-studio/runs/[id]/deploy/route.ts`) actually shipped. The backend itself is complete and tested; nothing in the UI currently calls it. Until an operator-facing control is wired up, deploying a `ready` run requires a developer to call `POST /api/site-studio/runs/{id}/deploy` directly. Ask engineering if a client's site needs to go live.

If a deploy attempt does fail (via that direct call), the error tells you exactly where it stopped:

- **"Deployment is not configured"** — the host isn't configured in this environment (`DA_HOST`/`DA_USERNAME`/`DA_LOGIN_KEY`/`DA_DOMAIN`); this is an environment problem, not a per-run one.
- **"Subdomain ... is already live for a different lead"** — a naming collision with another live site. Take the other one down from the Deployments board first (SOP 02 §6), then retry.
- **"A deploy is already running for this run"** — a second deploy attempt landed while the first was still in flight; wait for it to finish.
- **"Site zip not found in storage — the live site (if any) was not touched"** — the zip couldn't be fetched; nothing was changed on the live site. Safe to retry once the run has a valid zip.
- **"Deployment failed at upload: ..." / "at extract: ..."** — the upload to the host itself failed partway. The site may be left half-updated; retry the deploy once the underlying issue (usually transient) is resolved.
- Any message that says **"The site IS live"** — the site went live successfully, but some bookkeeping step after that failed (recording it, updating the lead's link, retiring a stale record, writing the activity log). The site is genuinely up; whoever sees this message should check `studio_deployments` manually and fix the bookkeeping rather than re-deploying blind.

## Editing at Gate 2 (the "ready" preview) may be refused

**Known gap, as of this writing:** the Gate 2 preview's click-to-edit, its per-field revert, and the theme color panel are fully built and wired on the frontend, but their backend routes (`PATCH /api/site-studio/runs/{id}/content`, `POST /api/site-studio/runs/{id}/revert`, `PATCH /api/site-studio/runs/{id}/theme`) each refuse with a 409 ("Cannot edit content/theme: this run is ready") whenever the run's status is `ready` — which is the **only** time Gate 2 is ever shown. This is because all three routes refuse edits on any "terminal" status, and `ready` is classified as terminal (correctly, for the machine's own step-chain — there's no more machine work to do once a run is `ready`) but that classification was never revisited for the edit routes when Gate 2 was added on top of it. If you hit a "this run is ready" error while trying to edit at Gate 2, this is why — it is not something to work around per-run; it needs a backend fix (loosening those three routes' refusal to allow edits specifically while `ready`, not just pre-`ready`). Flag it to engineering rather than assuming your edit didn't take for some lead-specific reason.

## Asset library upkeep

- Client photos are permanently fenced to their own lead (`kind:'client'`, `lead_id` set) — they are never offered as a candidate to any other lead's run, by a server-side check that fails closed on any error. Stock photos (`kind:'stock'`) are shared across every lead.
- Deleting a library asset that's still referenced by an active run's picks is refused (409) — finish or cancel the run(s) using it first.
- The `use_count` shown in the library is informational only (how often a photo's been picked) — nothing about generation depends on it being accurate.
- Subject text matters: it's what `searchLibrary` matches against for future runs' candidate sourcing. A stock upload with a vague or missing subject just won't surface itself as a candidate later — tag uploads with a real subject (e.g. "plumber van", not "photo1").

## A template needs re-compiling

See SOP 01 §6 — re-compile is deterministic against the original immutable zip and self-heals a corrupted package with no re-upload needed. A **certified** template must be disabled first.

## Post-deploy client change requests

Once a site is live and the client asks for a change:

1. Open the run's page from **Site Studio → Runs** — a `ready` run keeps its Gate 2 preview available indefinitely, it isn't a one-time view.
2. Edit the changed field(s) in the preview (subject to the known Gate 2 editing gap above — if edits are currently refused, this step is blocked until that's fixed).
3. Re-deploy. Because deploy resolves to the lead's existing subdomain whenever one exists, this **overwrites the live site in place at the same URL** — it does not create a second site or require any DNS change.

Source of truth for this SOP: `lib/site-studio/run/engine.ts`, `lib/site-studio/deploy/deployRun.ts`, and the error messages in `app/api/site-studio/runs/[id]/{step,control,content,theme,revert,images,reroll,deploy}/route.ts`.
