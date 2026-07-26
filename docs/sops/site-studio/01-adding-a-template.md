# SOP 01 — Adding a template

A template only becomes usable for generation once it is **certified**. This walks you from a raw zip to a certified package.

## 1. Before you upload — sourcing criteria

- [ ] **Static-friendly only.** Site Studio compiles plain HTML/CSS/JS. A template whose content is rendered *by* JavaScript (React/Vue islands, client-side data fetching, a CMS widget that injects the copy at runtime) cannot be tokenized — the compiler can only find and replace text that already exists in the HTML it unzips. If the demo page is blank without running its JS, reject it (see §5).
- [ ] **Recognisable page kinds.** The compiler classifies each HTML file by filename into one of: `home`, `about`, `services_hub`, `service`, `areas_hub`, `area`, `contact`, `gallery`, `reviews`, `generic` (see `lib/site-studio/schema.ts`'s `pageKindFromFilename`). A template built around unusual filenames still compiles — everything not recognised falls back to `generic` — but a name like `index.html`, `about.html`, `services.html`, `contact.html`, `gallery.html`, `reviews.html` gets picked up automatically and needs no manual relabeling.
- [ ] **Licensing.** Only upload a template your business has the right to redistribute to clients. This is not something the compiler checks — it's on you before you upload.
- [ ] **One zip, the whole site.** Every HTML page, every image, every CSS/JS asset the demo needs, in one archive. The original zip is kept immutable in storage — re-compiling always starts from this same file (see §4), so what you upload here is what you'll always be re-compiling from.

## 2. Upload

- [ ] Go to **Site Studio → Templates**, drop the zip in the upload box (or use the file picker), give it a name, and click **Upload & compile**. Upload runs first (max 25MB), then compile runs automatically.
- [ ] The card shows **Uploaded** while compiling, then either **Needs review** (compiled with zero blockers, or with only warnings) or stays **Uploaded** with a "blocking" badge if the compile failed outright.

## 3. Reading the diagnostics

Every diagnostic has a `level`: **blocker**, **warn**, or **info**. Open the template's **Review** drawer to see the full list, grouped by page.

**Blockers — must be fixed and re-uploaded/re-compiled before certifying is even possible:**

| Code | What it means |
|---|---|
| `no_pages` | The zip contains no `.html`/`.htm` files at all. |
| `page_id_collision` | Two files produce the same internal page id (usually two files whose names differ only by case or punctuation). Rename one. |
| `zip_invalid` | The archive itself is malformed, unsafe (path traversal, duplicate paths), or unreadable. |
| `package_write_failed` | Compile succeeded but storage failed to save the package — just re-compile. |
| `roundtrip_render_refused` | The verification pass (compiling the package and rendering it from its own sample content) refused because a slot's value is missing. This means the compiler's own tokenization broke something structurally. |
| `roundtrip_mismatch` | The compiled package, re-rendered from its own samples, does not byte-for-byte reproduce the original page. The review drawer's side-by-side preview (original vs. compiled) is exactly how you spot where they diverge — the diagnostic message also names the first character where they differ. |

If you see `roundtrip_mismatch` or `roundtrip_render_refused`, the template's markup has a structure the compiler's slot/repeat/nav detection doesn't handle cleanly. These are not always fixable by re-uploading the same zip — sometimes the template itself needs simplifying (flattening unusual nesting, removing exotic markup) before a new upload will compile clean.

**Warnings that are normal on a typical template — read them, but they don't block certifying:**

- `identity_name_heuristic` — fires every time a business name IS found (from the `<title>`), because the detection is a heuristic (split on `|`/`-`/`—`) rather than a certainty. Just verify in the side-by-side preview that the name it picked is actually the business name, not a tagline.
- `stranded_text` — text sitting outside any detected slot. A little of this is normal (decorative labels, badges); a lot of it on a page that's supposed to be editable is worth a second look — that copy will never be writable by the AI.
- `comments_stripped`, `theme_none`, `img_alt_missing`, `link_unresolved`, `repeat_dropped_orphan`, `nav_candidate_skipped` (all **info** level) — informational only, no action required unless the message points at something specific you care about.

**Warnings worth a closer look before certifying:**

| Code | What to check |
|---|---|
| `identity_phone_multiple` / `identity_email_multiple` | Template has more than one phone/email in its markup; only the most frequent was tokenized. Confirm the others aren't load-bearing (a second office number, a support address) — if they are, they'll render as the demo's raw values on every generated site until handled manually. |
| `identity_name_missing` | No business name was found in `<title>` — every generated site will need its name set some other way, or the template's `<title>` needs fixing. |
| `identity_year_range` | A copyright year range like "2019–2024" was found; only the end year got tokenized, the start year is left as raw demo text. |
| `js_renders_dom` | A `<script>` (inline or as a linked `.js`/`.css` asset) writes to the DOM (`innerHTML`, `document.write`, etc.). Review what it renders — if it's rendering actual page CONTENT (not just a menu toggle or a lightbox), reject the template (see §5). |
| `asset_identity_echo` | A `.js`/`.css` asset file contains one of the demo's own identity values (phone/email) as literal text — meaning that value is baked into a script/stylesheet, not just the HTML, and won't be replaced by tokenization. |
| `nav_ambiguous` / `nav_not_detected` | The compiler either found two different nav-shaped lists at the same location (header/footer) and only tokenized the first, or found no nav at all on some page. Check the side-by-side preview — if the real site nav isn't rendering, links on generated sites will be dead. |
| `repeat_congruence_failed` | A run of ≥3 similar-looking sibling elements (a card grid, a testimonial list) wasn't structurally identical enough to treat as a repeatable block, so it was left as flat, uneditable content instead. |
| `ai_semantics_rejected` / `ai_semantics_unparseable` / `ai_identity_unparseable` | Only appear if you ran the AI enrichment passes (see §4) and the model's proposal was rejected or unparseable — the enrichment simply didn't apply; nothing else is affected. |
| `title_missing` / `title_duplicate` | A page has no `<title>`, or has more than one (only the first is kept). |
| `encoding_suspect` / `script_comment_content` | The file likely isn't UTF-8, or a script/style body has HTML-comment-looking content buried inside it — both need a manual look at the source file. |

## 4. Optional: AI enrichment, then certify

- [ ] In the review drawer, you can run **Find residual identity** and **Label pages & slots** — both are optional AI passes that improve on the deterministic compile. Each is independently verified against the round-trip check: if a pass would break reproduction of the original, it is discarded automatically and you're told so (never silently applied).
- [ ] **Certify** the template once: status is `needs_review`, there's a compiled manifest, and **zero blockers remain**. The button is disabled otherwise, and the checklist above it tells you how many blockers are left.
- [ ] **Certifying is what makes a template usable for generation** — `RunLaunch`'s template picker only lists `certified` templates. Nothing else in the app unlocks generation.
- [ ] After certifying you can **Disable** it (withholds it from new runs without deleting it) or, from disabled, **Re-enable** it.

## 5. When to reject

Reject (don't certify) a template whose **content** — not just decorative flourish — needs JavaScript to render. The tell is in the side-by-side preview: if the compiled package's rendered output is missing real content compared to the original page load, the demo's content came from JS the compiler never executes. Menu toggles, smooth-scroll, a lightbox gallery's open/close behavior — none of that is content, and having JS for it is fine and expected. A rejected template can be re-opened later (status → `needs_review`) if it gets reworked.

## 6. Re-compiling

- [ ] Compile is **deterministic** and always runs against the immutable original zip you uploaded — clicking **Re-compile** on an already-compiled template re-derives the package from scratch. This is the standard way to self-heal a package that somehow got corrupted in storage (e.g. after a `package_write_failed`), with no re-upload needed.
- [ ] Re-compiling bumps the template's version and **clears any AI enrichment** already applied (identity/semantics passes must be re-run after a re-compile).
- [ ] A **certified** template must be **Disabled** first before it can be re-compiled — certifying is meant to be a stable, reviewed state; re-compiling a live-and-in-use package out from under it isn't allowed.

Source of truth for this SOP: `lib/site-studio/compiler/*`, `lib/site-studio/ui/status.ts`, `components/site-studio/ReviewDrawer.tsx`, `app/api/site-studio/templates/[id]/{compile,certify}/route.ts`.
