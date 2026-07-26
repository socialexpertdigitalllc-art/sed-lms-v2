# SOP 02 — Generating a website

## 1. Launch the run

- [ ] Go to **Site Studio → Runs → New run**.
- [ ] Pick a lead. Only leads with status **Not Ready** (and not deleted) are listed.
- [ ] Pick a **certified** template — uncertified templates never appear here (see SOP 01).
- [ ] Pages: if the lead's own "specify pages" list is non-empty, you can check which of those to generate; the home page is always included regardless. Leave everything unchecked and every page in the template gets generated.
- [ ] Fan-out: check **Service pages** and/or **Area pages** to generate one stamped page per service / per service area the lead has listed, instead of one generic hub page.
- [ ] "Skip content review" (`auto`) sends the run straight past Gate 1 into rendering — content still stays fully editable at Gate 2. Leave this unchecked for a normal review flow.
- [ ] **Start run.** A lead can only have one active run at a time — starting a second while one is still in progress (`queued`/`preparing`/`reviewing`/`approved`/`rendering`) is refused with a 409; finish or cancel the first one.

## 2. Why a run can stop immediately, before any AI spend

The very first machine step (`prepare`) checks whether the lead can actually supply everything the template's identity tokens need — a phone number, an email, a map embed link, etc. — **before** a single AI call is made. If something's missing, the run goes straight to `failed` with a message naming exactly what's missing (e.g. *"This template needs an email address and a map link, which this lead doesn't have. Add them to the lead and start a new run."*).

- [ ] This is not a bug and not something to retry — the fix is to add the missing field(s) to the lead record and **start a brand-new run**. A failed run cannot be resumed.
- [ ] A lead with no email at all is fine as long as it's explicitly marked "no email" on the lead — a template that needs one will still refuse, but an absent, unmarked email is treated as "not captured yet," which is a different (still-refusing) case from "this business genuinely has none."

## 3. While it's writing

The cockpit drives itself: each page gets one AI write call, and image candidates get sourced for every image slot, all in parallel. You don't need to click anything — watch the page cards go from **Pending** → **Written** (or **Failed**).

- [ ] A failed page card shows **Retry**. Up to 2 write attempts total per page.
- [ ] If a page exhausts both attempts and is still not written, **the whole run fails**, naming the stuck page(s) and the last error. This is deliberate — retrying forever would leave the run wedged at "preparing" permanently. Fix whatever's wrong (usually a transient model/API failure) and start a new run.

## 4. Gate 1 — content + image review

Once every page is written and images are sourced, the run parks at **Awaiting review** (status `reviewing`). **This is the gate working as designed, not a stuck run** — the background advancer that finishes abandoned steps for you deliberately cannot cross this status; only a human clicking **Approve & render** releases it.

Review each page card:

- [ ] **Read every page's copy once.** Check it reads as the **client's** trade and business, in the client's own words where the lead supplied them — never invented claims ("licensed and insured since 1995" when the lead never said so), and never anything left over from the template's own demo business.
- [ ] **Titles and text slots** are click-to-edit right on the card. An edited field is marked "edited" and is now **operator-owned** — a later re-roll of that field (whole-page or per-slot) will not touch it unless you explicitly confirm overwriting it.
- [ ] **Images** — click a slot to open the picker:
  - **Candidates** tab: what was auto-sourced for this slot (library first, Pexels as top-up only when the library falls short — never anything AI-judged, just cheap dimension filtering).
  - **Library** tab: search the shared stock library plus this lead's own client photos.
  - **Client photos** tab: only this lead's own uploaded/linked photos — a client's photos are **fenced to their own lead and never offered to any other client**; stock images are shared across all leads.
  - **Upload** tab: upload a new image directly, which lands as shared stock and is picked immediately.
  - Whichever you pick, **the image is rehosted into our own storage bucket** before it's written into the slot — a chosen photo is never hot-linked to Pexels or a client's external URL, so it can't later break (URL rot, an expired link) once the site is live.
  - Alt text for the image is edited right in the same dialog.
- [ ] **Re-roll** — per-slot (the refresh icon next to a text field) or per-page (button at the bottom of the card). **Operator-edited fields are protected by default**: a slot re-roll refuses outright if that slot is operator-owned unless you explicitly confirm overwriting it; a page re-roll silently skips operator-owned fields unless you confirm "overwrite them too." Re-roll is only available at Gate 1.
- [ ] Pause/Resume/Cancel are available at any non-terminal point via the buttons at the top of the cockpit, if you need to step away or abandon a run.
- [ ] When everything looks right, click **Approve & render** at the bottom of the screen. This is a one-shot action — approving twice, or approving a run someone/something already advanced, is refused with a 409 rather than silently no-opping.

## 5. Gate 2 — editable preview

After render + finalize complete, the run reaches **Ready**. This opens the navigable, click-to-edit preview:

- [ ] Click through pages using the tabs at the top; click any text or image directly in the preview to edit it in place (same click-to-edit behavior as Gate 1, now including repeat rows — e.g. one card in a services grid — individually).
- [ ] **Revert to AI** is offered for any operator-edited field, restoring the AI-written value that was there before your edit.
- [ ] Theme colors are adjustable from the panel above the preview.
- [ ] **Download site** gives you the finished zip at any time from this screen.

## 6. Deploy

- [ ] Deploy is triggered by `POST /api/site-studio/runs/{id}/deploy` once a run is `ready`. **As of this writing there is no working button for this in the cockpit** — the Deploy button shown on the Gate 2 preview is present but permanently disabled (a leftover control from before the deploy backend shipped; see SOP 03 for the exact spot). Until that's wired up, deploying requires a developer to call the endpoint directly (e.g. with a REST client), passing your session's auth. Ask engineering if you need a site deployed.
- [ ] **One live site per lead.** If the lead's current `website_link` already points at one of our subdomains, a deploy redeploys **onto that exact same subdomain, in place** — it does not create a second site. A lead with no existing subdomain gets a fresh one derived from the run's own generated slug.
- [ ] A deploy refuses (409) if the target subdomain is already live for a **different** lead — this protects against two similarly-named businesses colliding on the same subdomain. If that happens, take the other deployment down first (next bullet) before retrying.
- [ ] **Takedown** — from **Site Studio → Deployments**, filter to **Live**, click the trash icon next to a row, confirm. This deletes the subdomain on the host and marks the record `taken_down` immediately; it is not reversible from the board (you'd need to deploy again from a ready run to bring the site back).
- [ ] The **Deployments** board lists every live/former site, Site Studio-generated and legacy v2 alike (the origin badge tells them apart) — this is the one place to look up a client's current URL, status, and history.

Source of truth for this SOP: `lib/site-studio/run/*`, `lib/site-studio/deploy/*`, `components/site-studio/{RunLaunch,RunCockpit,RunPageCard,ImagePicker,RunPreview,DeploymentsBoard}.tsx`, `app/api/site-studio/runs/[id]/*`.
