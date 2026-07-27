# SOP 02 — Generating a website

## 1. Launch the run

- [ ] Go to **Site Studio → Runs → New run**.
- [ ] Pick a lead. Only leads with status **Not Ready** (and not deleted) are listed.
- [ ] Pick a **certified** template — uncertified templates never appear here (see SOP 01).
- [ ] Pages: if the lead's own "specify pages" list is non-empty, you can check which of those to generate; the home page is always included regardless. Leave everything unchecked and every page in the template gets generated.
- [ ] Fan-out: check **Service pages** and/or **Area pages** to generate one stamped page per service / per service area the lead has listed, instead of one generic hub page.
- [ ] "Skip content review" (`auto`) sends the run straight past Gate 1 into rendering — content still stays fully editable at Gate 2. Leave this unchecked for a normal review flow.
- [ ] **Start run.** A lead can only have one active run at a time — starting a second while one is still in progress (`queued`/`preparing`/`reviewing`/`approved`/`rendering`) is refused with a 409; finish or cancel the first one.

## 2. When a template asks for a fact the lead record doesn't have

The very first machine step (`prepare`) checks whether the lead can actually supply everything the template's identity tokens need — a phone number, an email, a map embed link, and (since templates aren't limited to a fixed vocabulary) sometimes something more specific like a neighborhood, an owner's name, or a social handle a lead record simply has no column for. Prepare never fails the run over this: every fact the lead can't supply is seeded in blank and the run proceeds normally into writing.

- [ ] At Gate 1, if the template needed anything the lead couldn't supply, a **Site facts** panel appears above the page cards — one labelled input per missing fact, showing how many places it's used and on which pages. Fill in what you know.
- [ ] **Leaving a field blank is a legitimate choice.** The site simply renders with that spot blank (an empty href, an empty map embed, no text where the fact would have gone) — it is not an error, and it does not block approval. The approve footer mentions how many facts are still unfilled, purely as information.
- [ ] The panel never shows the template's own demo value for a fact — that's the template author's own business detail, not the operator's, and it would be too easy to accept it as-is and ship a leak onto a client's live site.
- [ ] You can also fill (or change) a site fact later, from the same **Site facts** panel, at Gate 2 (the `ready` preview) — it isn't a one-time, Gate-1-only action.
- [ ] A lead with no email at all is fine as long as it's explicitly marked "no email" on the lead — that's still treated as "genuinely has none," distinct from a fact the template needs that simply isn't a lead field at all.

## 3. While it's writing

The cockpit drives itself: each page gets one AI write call, and image candidates get sourced for every image slot, all in parallel. You don't need to click anything — watch the page cards go from **Pending** → **Written** (or **Failed**).

- [ ] A failed page card shows **Retry**. Up to 2 write attempts total per page.
- [ ] If a page exhausts both attempts and is still not written, **the whole run fails**, naming the stuck page(s) and the last error. This is deliberate — retrying forever would leave the run wedged at "preparing" permanently. Fix whatever's wrong (usually a transient model/API failure) and start a new run.

## 4. Gate 1 — content + image review

Once every page is written and images are sourced, the run parks at **Awaiting review** (status `reviewing`). **This is the gate working as designed, not a stuck run** — the background advancer that finishes abandoned steps for you deliberately cannot cross this status; only a human clicking **Approve & render** releases it.

If this run's template needed a fact the lead couldn't supply, the **Site facts** panel appears above the page cards first — see §2. Filling it in (or explicitly leaving a field blank) is independent of reviewing the page cards below; do either in whichever order makes sense to you.

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
- [ ] **Re-roll** — per-slot (the refresh icon next to a text field) or per-page (button at the bottom of the card). **Operator-edited fields are protected by default**: a slot re-roll refuses outright if that slot is operator-owned unless you explicitly confirm overwriting it; a page re-roll silently skips operator-owned fields unless you confirm "overwrite them too." Re-roll is also available later at Gate 2, not just here.
- [ ] Pause/Resume/Cancel are available at any non-terminal point via the buttons at the top of the cockpit, if you need to step away or abandon a run.
- [ ] When everything looks right, click **Approve & render** at the bottom of the screen. This is a one-shot action — approving twice, or approving a run someone/something already advanced, is refused with a 409 rather than silently no-opping.

## 5. Gate 2 — editable preview

After render + finalize complete, the run reaches **Ready**. This opens the navigable, click-to-edit preview — and, unlike Gate 1, every edit here also refreshes the build that Download/Deploy will actually serve:

- [ ] Click through pages using the tabs at the top; click any text or image directly in the preview to edit it in place (same click-to-edit behavior as Gate 1, now including repeat rows — e.g. one card in a services grid — individually).
- [ ] **Revert to AI** is offered for any operator-edited field, restoring the AI-written value that was there before your edit.
- [ ] **Re-roll** works here too, the same as at Gate 1.
- [ ] Theme colors are adjustable from the panel above the preview.
- [ ] **Download site** gives you the finished zip at any time from this screen.
- [ ] Every edit at this stage (text, image, theme, revert, re-roll) automatically re-finalizes the deployable/downloadable zip so it always matches what you see in the preview — you never need to do anything extra to make an edit "stick" for deploy. In the rare case a re-finalize itself can't complete (e.g. a picked image failed to resolve), your edit is still saved, but a toast tells you the build is stale until that's fixed — don't deploy until it clears.

## 6. Deploy

- [ ] Click **Deploy** on the Gate 2 preview (only enabled once the run is `ready`). You'll be asked to confirm first — **this publishes a real client site to a live subdomain**, so make sure the preview looks right before confirming.
- [ ] The button disables itself for the duration of the request so a double-click can't fire two overlapping deploys; on success it shows the live URL as a clickable link.
- [ ] A failure is shown verbatim as reported by the server — a 409 (e.g. the cross-lead subdomain guard below) reads differently from a 502 (an upstream DirectAdmin failure), and which one you got tells you what to do next.
- [ ] If the deploy succeeds but shows a warning about clearing the old docroot, the live site may currently hold a **mix of the old and new build** — redeploy once the underlying issue (usually a permissions/host hiccup) is resolved.
- [ ] **One live site per lead.** If the lead's current `website_link` already points at one of our subdomains, a deploy redeploys **onto that exact same subdomain, in place** — it does not create a second site. A lead with no existing subdomain gets a fresh one derived from the run's own generated slug.
- [ ] A deploy refuses (409) if the target subdomain is already live for a **different** lead — this protects against two similarly-named businesses colliding on the same subdomain. If that happens, take the other deployment down first (next bullet) before retrying.
- [ ] **Takedown** — from **Site Studio → Deployments**, filter to **Live**, click the trash icon next to a row, confirm. This deletes the subdomain on the host and marks the record `taken_down` immediately; it is not reversible from the board (you'd need to deploy again from a ready run to bring the site back).
- [ ] The **Deployments** board lists every live/former site, Site Studio-generated and legacy v2 alike (the origin badge tells them apart) — this is the one place to look up a client's current URL, status, and history.

Source of truth for this SOP: `lib/site-studio/run/*`, `lib/site-studio/deploy/*`, `components/site-studio/{RunLaunch,RunCockpit,RunPageCard,SiteFactsPanel,ImagePicker,RunPreview,DeploymentsBoard}.tsx`, `app/api/site-studio/runs/[id]/*`.
