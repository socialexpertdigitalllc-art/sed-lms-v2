# Long Term Status, Per-Category Permissions & Form Parity — Design

**Date:** 2026-07-07
**Status:** Approved approach (Approach A — category permissions as regular RBAC keys)

Four workstreams in this polishing round:

- **A.** Add the missing "Long Term" lead status.
- **B.** Per-category permissions: which lead categories a user can **view** and which they can **set** — separately controllable per user by admins.
- **C.** Verify per-user submit permissions for leads and pre-leads.
- **D.** Rebuild the New Lead and New Pre-Lead forms to match the old LMS forms' structure and dynamics, restyled to the v2 "Data Console" design language.

---

## A. "Long Term" lead status

The old app and the real Google Sheet use the exact label **`Long Term`** (space, no hyphen). v2's `LEAD_STATUSES` is missing it; the Sheets importer currently coerces "Long Term" rows to "Not Ready" (a real import bug).

Changes:

1. `lib/leads/types.ts` — add `"Long Term"` to `LEAD_STATUSES`; add `"Long Term": "bg-longterm-bg text-longterm-fg"` to `STATUS_PILL`. (The `--color-longterm-*` tokens already exist in `globals.css`: blue `#1D4ED8` on `#E8F0FE`.)
2. `lib/leads/analytics.ts` — add `Long Term` to the KPI counts object and the pipeline `order` array; extend the `LeadKpis` interface (`longTerm: number`).
3. `components/dashboard/StatusStrip.tsx` + `KpiHero.tsx` — add the Long Term entry (blue).
4. `components/dashboard/Charts.tsx` — add `"Long Term": "#1D4ED8"` to `STATUS_COLORS` (the legend derives from it).
5. Everything else follows automatically from `LEAD_STATUSES`: Zod `status` enum, status dropdowns (NewLeadForm, LeadDetail, StatusChangeModal), LeadsTable tabs + counts, importer validation (`lib/import/map.ts`).
6. No DB migration needed for the status itself — `leads.status` is plain text with no check constraint.

Out of scope: WGE auto-enqueue logic keys on "Ready" only and is unaffected.

---

## B. Per-category view/set permissions

### Model

10 new permission rows (category `leads`, not sensitive), slugged from the status (`lower`, spaces→`_`):

| Key | Meaning |
|---|---|
| `leads.cat_view.ready` … `leads.cat_view.long_term` | Can **see** leads in that category |
| `leads.cat_set.ready` … `leads.cat_set.long_term` | Can **set** a lead's status to that category |

View and set are **independent** (explicit user decision): a user may be allowed to set a lead to "Closed" without being able to view Closed leads, and vice versa.

They are ordinary permissions: department defaults via Admin → Permissions grid, per-user grant/revoke via Admin → Users → overrides. **No new admin UI.**

A shared helper `statusSlug(status: string): string` and constants (e.g. `CAT_VIEW_PREFIX`/`CAT_SET_PREFIX` + `catViewKey(status)`/`catSetKey(status)`) live in `lib/leads/types.ts` (or a small `lib/leads/categories.ts`) and are the single source of truth used by UI, API, and the migration.

### Migration (0011)

1. Insert the 10 permission rows.
2. Seed for zero disruption:
   - every department that has `leads.view` → all 5 `cat_view` keys;
   - every department that has `leads.status_change` → all 5 `cat_set` keys.
3. Replace the leads RLS select policy:

```sql
create policy "read leads scoped" on public.leads for select to authenticated
  using (
    (public.has_permission('leads.view_all') or agent_id = auth.uid())
    and public.has_permission('leads.cat_view.' || lower(replace(status, ' ', '_')))
  );
```

`has_permission()` (migration 0004) already mirrors the 3-layer resolver including user overrides and expiry.

### View enforcement

Because the rule lives in RLS, hidden categories disappear everywhere the user-scoped client reads: leads table rows, dashboard KPIs/charts (they aggregate RLS-filtered rows), by-agent view, CSV export (client-side from visible rows), ⌘K lookup, realtime events (realtime respects RLS).

UI additionally hides chrome for invisible categories so users don't stare at permanent zeros:

- LeadsTable: render a status tab only if the user has its `cat_view` key (the "All" tab always shows).
- StatusStrip / KpiHero / donut legend: render only visible categories.
- Components get the permission set they already receive via `usePermissions` / server-side `getUserPermissions`.

Service-role paths (admin logs, WGE headless generation, importer) bypass RLS by design and are untouched.

### Set enforcement

- Status dropdowns (NewLeadForm, LeadDetail, StatusChangeModal) render only statuses with `cat_set`.
- `POST /api/leads` — after schema validation, reject (403) if `body.status` lacks `cat_set`.
- `PATCH /api/leads/[id]` — if the update includes `status`, reject (403) unless the user has `cat_set` for the **new** status (in addition to the existing `leads.status_change` / `leads.edit` checks).
- A user with no `cat_set` keys effectively cannot set/change any status; the UI shows an empty dropdown state ("No categories available to you").

### Edge cases

- **Status not in the 5 known categories** (legacy/dirty data): `cat_view` key won't exist → `has_permission` returns false → row hidden from everyone except service role. Acceptable: the importer normalizes statuses, and admins use service-role-backed admin views.
- **Lead detail page** of a hidden lead: RLS already returns nothing → existing 404/not-found path.
- **Own leads**: category visibility applies even to a user's own leads (the `and` in the policy) — an agent without `cat_view.closed` does not see their own closed leads. This is the intended "everywhere" semantics.

---

## C. Submit permissions (verify, fix gaps)

`leads.create` and `pre_leads.create` already exist and are per-user controllable. Verify all three layers for each, fix any gap found:

| Layer | Leads | Pre-leads |
|---|---|---|
| Button/nav visibility | "+ New Lead" hidden without `leads.create` | "Add Pre-Lead" hidden without `pre_leads.create` |
| Page guard | `/leads/new` redirects | `/pre-leads/new` redirects (exists) |
| API | `POST /api/leads` 403 | `POST /api/pre-leads` 403 (exists) |

---

## D. Form parity with the old LMS

Directive: replicate the old forms' **structure, fields, and dynamics** as-is; restyle to the v2 Data Console language (light theme, `#EEF1F5` canvas, white cards, teal `#0D9488` accent, Inter/JetBrains Mono). Both forms keep React-Hook-Form + Zod and POST to the existing APIs — this is a UI-layer rebuild, no schema/API changes except where noted.

### D1. New Lead form (`components/leads/NewLeadForm.tsx`)

Reference: `D:\Old LMS Dashboard\sed-lms\public\upfront-form.html` (form `#mainForm`, lines ~728–1057 + its JS).

Five sections with dividers, exactly as the old form:

**① Client Identity**
- Site Type — radio pills (v2's 4 `SITE_TYPES`; old had Custom/Redesign only — keep v2's superset), required.
- Business Name (text, required), Phone (auto-masked `(252) 401-2775`, required), Email (required).
- Platform — radio pills Google / Yelp / Other, required; Profile Link input beneath; **Other → conditional "Other Platform" name input (required)**.

**② Location & Services**
- Map Embed Link (textarea, optional).
- Service Areas — Yes/No pills, required; **Yes → dynamic Areas list with "+ Add Area" (min 1)**.
- Services — dynamic list with "+ Add Service" (min 1).

**③ Website Details**
- Client's Experience (years, number, required) · No. of Webpages (number ≥1, required).
- Specify Webpages — checkbox chips (Home always checked & locked; About Us, Services, Service Areas, Gallery, Contact Us, Individual Service Pages, Individual Service Area Pages, Pricing, Other) with a live counter `n / N selected` where **N = No. of Webpages; selection count must equal N**; **Other chip → conditional text input**.
- Color Scheme (text, required) · Logo Link (url, optional).
- Image Links — dynamic list "+ Add Image Link" (optional).

**④ Pricing & Follow Up**
- Follow Up Time (datetime-local, required, must be in the future).
- Price Quoted — pills $250 / $500 / $750 / Other, required; **Other → `$`-prefixed custom number input**.
- Yearly Price — pills $100 / $50 / Other / None; **Other → custom input**.
- Direct Line saved? — Yes/No pills, required.
- **Site Type = Redesign → conditional Reference Site block (required URL)**.

**⑤ Final Assessment**
- Specific Comments on Client (textarea, required).
- Rating 1–10 — button group, required.
- Fresh or Follow Up? — pills, required.

v2 additions kept (not in the old form): Agent select and Status select (status options filtered by `cat_set`, per section B). Place them in a small leading "Assignment" block.

Data mapping: all fields already exist on `leads` (`has_service_areas`, `service_areas[]`, `services[]`, `specify_pages[]`, `color_scheme`, `price_quoted`, `yearly_price`, `direct_line_saved`, `fresh_or_followup`, `reference_link`, `image_links[]`, `rating`, `comments`, …). `platform` stores "Google"/"Yelp"/&lt;other name&gt;. Zod schema extended to encode the conditional requirements (platform-other name, redesign reference link, pages-count match, future follow-up, custom price when "Other").

### D2. New Pre-Lead form (`components/preleads/AddPreLeadForm.tsx`)

Reference: `D:\Old LMS Dashboard\sed-lms\public\prelead-dashboard.html` form `#leadForm` (lines ~1724–1827).

Three sections:

**① Service Details** — Service Offered (SEO / Website, required); Service Type (Redesign / Fresh) — **required when Service Offered = Website**, optional otherwise (old `updateServiceTypeRequirement()` behavior).

**② Business Information** — Business Name (required) · Phone (masked, required) · Email · Owner Name · Profile Link (url, required) · Areas.

**③ Project Scope & Follow-up** — Services (comma-separated) · Target Pricing ($) · Follow-up Date & Time (required) · Lead Category (v2 `LEAD_CATEGORIES`, required) · Internal Comments (textarea). Full-width "Submit Pre-Lead" primary button.

All fields already exist on `pre_leads`; API unchanged.

### D3. Shared form primitives

Build once, use in both forms (and reusable later): radio-pill group, checkbox-chip group with counter, dynamic add/remove list, conditional block (smooth expand), `$`-prefix input, rating group, phone mask hook. Live under `components/forms/`. Styled Data Console (teal selected states, soft borders, no glows).

---

## Testing

- **Unit:** `statusSlug`/key helpers; category filtering of tabs/dropdowns; extended Zod schemas (conditional requirements: platform Other, redesign reference, pages-count match, future follow-up, custom price); API `cat_set` validation logic.
- **Live (Chrome MCP):** with a test user — revoke `cat_view.closed` → Closed leads vanish from table/tabs/dashboard/CSV/⌘K; revoke `cat_set.dropped` → Dropped absent from dropdowns and PATCH returns 403; `leads.create`/`pre_leads.create` revoke hides buttons and API 403s; fill both new forms end-to-end incl. all conditional dynamics; import preview shows Long Term rows mapped correctly.
- Existing suite (95 tests) stays green; `next build` green.

## Rollout

1. Migration 0011 (permissions + seeds + RLS) — applied to the `sed-lms-v2` Supabase project.
2. Code changes land together on `main` (or a feature branch if preferred).
3. No action needed from existing users; admins can start revoking categories immediately.
