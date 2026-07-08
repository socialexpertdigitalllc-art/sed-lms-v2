# SED LMS v2 — Polish 3: Sign-In Logs, Duplicate Guard & Lead-Form Enhancements

**Date:** 2026-07-09
**Branch:** `polish-3` (off `main`, which was fast-forwarded to include polish-1/2, leads-followups, followups-notify)
**Status:** Design approved — ready for planning

## Context

A batch of seven independent enhancements to the lead-management workflow, spanning the lead & pre-lead submission forms, the admin logs area, and admin settings. All build on the existing v2 patterns (singleton-config settings, `has_permission()` RBAC, `ChipGroup`/`DynamicList` form primitives, service-role admin reads for admin pages).

**Step 0 (done):** The unmerged stack (polish-1 → polish-2 → leads-followups → followups-notify) was fast-forwarded into `main`, and `polish-3` was branched off it. `origin/main` push is deferred pending user confirmation.

## New database objects

### Migration `0015_signin_logs.sql`
- **`user_sessions`** — one row per sign-in.
  - `id uuid pk`, `user_id uuid → profiles(id) on delete cascade`
  - `signed_in_at timestamptz not null default now()`
  - `signed_out_at timestamptz` (null = open/unresolved)
  - `last_seen_at timestamptz not null default now()` (bumped by the activity heartbeat)
  - `end_reason text` check in (`'logout'`, `'idle_timeout'`) — null while open
  - `ip text`, `user_agent text`
  - `created_at timestamptz default now()`
  - Indexes: `(user_id, signed_in_at desc)`, `(signed_out_at)` (partial `where signed_out_at is null`).
  - RLS enabled, **no client policy** — reads/writes via service role only (mirrors `user_activity`).
- **`app_settings`** — singleton company config (mirrors `wge_config`/`import_config`).
  - `singleton boolean not null default true unique`
  - `work_start_time time not null default '09:00'`
  - `work_timezone text not null default 'Asia/Karachi'` *(confirm default with user; used to bucket sessions into local days & compute lateness)*
  - `idle_timeout_minutes int not null default 15`
  - `updated_at`, `updated_by uuid → profiles(id)`
  - RLS: select to all authenticated; writes via service role.
- **`close_stale_sessions()`** — `security definer` function: for every open session whose `last_seen_at < now() - (idle_timeout_minutes || ' minutes')`, set `signed_out_at = last_seen_at`, `end_reason = 'idle_timeout'`. Reads the timeout from `app_settings`.

### Migration `0016_lead_form_addons.sql`
- **`leads` new columns:**
  - `design_reference_links text[] default '{}'` — feature 3
  - `add_ons jsonb default '[]'` — feature 4 (snapshot array of `{id,label,price}`)
  - `no_email boolean not null default false` — feature 5
  - `logo_via_sms boolean not null default false` — feature 6
  - `color_same_as_logo boolean not null default false` — feature 6
  - `closed_by uuid → profiles(id) on delete set null` — feature 7
- **`website_addons`** — admin-managed add-on catalog.
  - `id uuid pk default gen_random_uuid()`, `label text not null`, `price numeric(10,2)` (nullable), `is_active boolean not null default true`, `sort int not null default 0`, `created_by uuid → profiles(id) on delete set null`, `created_at`, `updated_at`.
  - RLS: select to all authenticated (agents need the active list); writes via service role (guarded by route perm).

### New permissions (define in migration + `seed.sql`, grant to depts)
- **`admin.settings.manage`** (category `admin`, sensitive) — edit `app_settings` (work hours) + the `website_addons` catalog. Granted to `admin`, `management`.
- **`leads.duplicate.override`** (category `leads`, sensitive) — bypass the duplicate hard-block. Granted to `admin`, `management`.

> Note: `lib/permissions/constants.ts` is stale (not runtime-authoritative); the DB `permissions` table is the source of truth. We still add the keys there to keep the `PermissionKey` union current.

---

## Feature 1 — Sign-In Logs

**Goal:** Give admins attendance, active-hours, live-online, and punctuality visibility to support staffing decisions.

**Capture (writes to `user_sessions`):**
- `login()` in `app/login/actions.ts`: on successful `signInWithPassword`, insert a session via the admin client, stamping `ip` (from `x-forwarded-for` / `x-real-ip` via `next/headers`) and `user_agent`. Never throws into the login flow (best-effort, wrapped).
- `logout()`: close the user's most-recent open session (`signed_out_at = now()`, `end_reason = 'logout'`).
- Heartbeat: `POST /api/activity/track` (already called every 5s/20-events by `providers/ActivityTracker.tsx`) also bumps `last_seen_at = now()` on the caller's open session (one cheap indexed update).
- Reconcile: `instrumentation.ts` adds an interval (reusing the existing poller pattern, secret-gated internal call or direct RPC) that runs `close_stale_sessions()` so abandoned sessions get an accurate `idle_timeout` out-time.

**Analytics (pure, tested in `lib/signin/analytics.ts`):**
- Bucket sessions into **local days** using `work_timezone`.
- **Attendance:** per user per day → first `signed_in_at`, last `signed_out_at`.
- **Total active hours/day:** Σ `(signed_out_at ?? last_seen_at) − signed_in_at` per user per day.
- **Currently online:** open sessions with `last_seen_at` within `idle_timeout_minutes`. **Session count:** sessions per user per day.
- **Punctuality:** first sign-in vs `work_start_time` → on-time / late (minutes). Days in range with zero sessions for an active user → absence.

**UI:**
- New **"Sign-In Logs"** tab in `components/admin/LogsViewer.tsx` (extend `type Tab` to include `"signin"`; add pill + `<thead>/<tbody>` branch + filter). `app/(app)/admin/logs/page.tsx` fetches sessions + `app_settings` via the admin client and passes them down.
- Sections: **Online-now** strip; **per-user-per-day summary table** (date, user, first-in, last-out, total hours, #sessions, on-time/late badge); **absences** for the range. Filters: user select + date range.
- Gated by the existing **`admin.logs.view`** (no new perm; same page).
- Work-hours settings editor (start time, timezone, idle minutes) — compact card on the tab or an admin settings page, gated `admin.settings.manage`, via `GET/PUT /api/admin/settings`.

**Files:** `app/login/actions.ts`, `app/api/activity/track/route.ts`, `instrumentation.ts`, `lib/signin/analytics.ts` (new), `lib/settings/appSettings.ts` (new reader helper, mirrors `getWgeConfig`), `app/api/admin/settings/route.ts` (new), `components/admin/LogsViewer.tsx`, `app/(app)/admin/logs/page.tsx`, `components/admin/AppSettingsCard.tsx` (new).

---

## Feature 2 — Duplicate cancellation (real-time)

**Goal:** Prevent re-entering a business already in the same pipeline; tell the user which field collided and (if someone else's) whose it is.

**Scope:** Same-table only — new-lead form checks `leads`; add-pre-lead form checks `pre_leads`. Only `deleted_at is null` rows.

**Matching (pure, tested in `lib/leads/duplicate.ts`):** normalize then exact-match —
- phone → digits only (`replace(/\D/g,'')`)
- email → `lower(trim())` (skipped when empty / `no_email`)
- business name → `lower(trim())`

**Endpoints:** `POST /api/leads/check-duplicate` and `POST /api/pre-leads/check-duplicate`. Auth required. Use the **admin client** (cross-user visibility). Body: `{ business_name?, phone?, email? }`. Response per field: `{ field, matched: bool, ownerDisplayName, isOwn }` — never returns the full record, only owner display name + which field.

**Client UX:** debounced (~500ms) checks on business_name / phone / email edits; inline per-field message:
- own → *"You already have a lead with this phone number."*
- other → *"This email belongs to a lead owned by **Jane Doe**."*

**Enforcement:**
- Agents (no `leads.duplicate.override`): submit hard-blocked while any duplicate stands.
- Admins/managers (`leads.duplicate.override`): warning shown, **"Submit anyway"** confirm enables submit.
- **Server POST re-checks** authoritatively; returns **409** with the collisions unless the caller has the override perm and passed `override: true`. This is the source of truth (client check is UX only).

**Files:** `lib/leads/duplicate.ts` (new, pure normalize+match), `app/api/leads/check-duplicate/route.ts` + `app/api/pre-leads/check-duplicate/route.ts` (new), `app/api/leads/route.ts` + `app/api/pre-leads/route.ts` (add server re-check + `override` handling), `components/leads/NewLeadForm.tsx` + `components/preleads/AddPreLeadForm.tsx` (debounced check hook + field errors + submit gate), `lib/leads/newLeadForm.ts` + `lib/preleads/newPreLeadForm.ts` (state for dup results/override), `hooks/useDuplicateCheck.ts` (new shared debounced hook).

---

## Feature 3 — Design reference sites (lead form)

Up to **3 optional** design-reference URLs, distinct from the Redesign `reference_link`.
- Storage: `leads.design_reference_links text[]`.
- UI: `DynamicList` (max 3) in the Website Details section, label "Design Reference Sites (optional)", helper "Sites the client shared as design inspiration."
- Zod (`lib/leads/schema.ts`): `design_reference_links: z.array(z.string().url()).max(3).nullable().optional()`.
- Detail view + CSV: render as links / joined list.
- Lead-only.

---

## Feature 4 — Add-ons + admin manager

**Catalog:** `website_addons` table (label + optional price + is_active + sort).

**Admin manager:** page `app/(app)/admin/add-ons/page.tsx` (gated `admin.settings.manage`) + `components/admin/AddonsManager.tsx` — add row (label + price), edit, toggle active, remove; mirrors the `PermissionToggleGrid` immediate-persist pattern. API: `GET /api/admin/add-ons`, `POST` (create), `PATCH /api/admin/add-ons/[id]`, `DELETE /api/admin/add-ons/[id]` — each admin-guarded + `activity_log` entry. Nav entry in `Sidebar.tsx` under the admin group.

**Lead form:** a picker (checkbox/chip list showing "Label — $price") built from active add-ons loaded by `app/(app)/leads/new/page.tsx`. Selection tracked by add-on id; `buildLeadPayload` snapshots selected active add-ons into `add_ons jsonb` = `[{id,label,price}]`.
- Zod: `add_ons: z.array(z.object({ id: z.string(), label: z.string(), price: z.number().nullable() })).nullable().optional()`.
- Detail view + CSV: itemize label + price.
- Lead-only, optional.

---

## Feature 5 — "No Email" checkbox (lead form)

- Checkbox beside Email. Checked → email input **disabled + cleared**, and the client-side required rule is lifted.
- Storage: `leads.no_email boolean`; when checked, `business_email = null`, `no_email = true`.
- Zod: `no_email: z.boolean().optional()`.
- Client validation (`validateNewLead`): email required **unless** `no_email`.
- Interacts with feature 2: email dup-check skipped when `no_email`.
- Detail view: show "No email".

---

## Feature 6 — Dependent color-scheme & logo controls (lead form)

**Logo control:**
- Toggle: **"Provide URL"** vs **"Sent via SMS"** (checkbox). SMS mode disables + clears the `logo_link` input.
- Storage: `leads.logo_via_sms boolean`; when true, `logo_link = null`.
- "Logo provided" := `logo_link` is a valid URL **or** `logo_via_sms` is true.

**Color-scheme control:**
- Toggle: **"Enter manually"** vs **"Same as Logo"**.
- "Same as Logo" is **only selectable when a logo is provided**; otherwise disabled with hint "Add a logo first." Selecting it disables + clears the `color_scheme` text field and sets `color_same_as_logo = true`.
- If the logo is later removed, the control reverts to manual (and `color_same_as_logo` clears).
- Storage: `leads.color_same_as_logo boolean`; when true, `color_scheme = null`.

**Validation:** `color_scheme` required only when `color_same_as_logo` is false. Two new booleans added to schema/state/payload.
**Detail view:** color shows "Same as logo" / logo shows "Sent via SMS" when the respective flag is set.

---

## Feature 7 — "Lead Closed by" (lead form)

- New `leads.closed_by uuid → profiles(id)`.
- Required select: **"Self"** (default) or any **Sales-department** user (by `display_name`).
- `app/(app)/leads/new/page.tsx` loads sales members: resolve `departments.slug='sales'` → id, then `department_members.select("user_id, profiles!department_members_user_id_fkey(id, display_name)")` (FK pin required — two FKs to profiles).
- Payload: "Self" → `closed_by = current user id`; otherwise the selected id. Server validates the id is a real profile (and ideally a sales member).
- Detail view: show closer's `display_name`.

---

## Testing

- **Unit (Vitest):** `lib/leads/duplicate.ts` (normalize + match + which-field), `lib/signin/analytics.ts` (day bucketing across tz, first/last, hours, lateness, absence, open-session handling), the new validation rules (email/`no_email`, color/logo dependency), add-on snapshot builder.
- **Route-level:** dup-check endpoints (own vs other vs none), POST 409 without override / 200 with override.
- **Live (Chrome MCP)** — per the project's "build-green doesn't catch runtime bugs" rule: submit a duplicate as agent (blocked) vs admin (override); No-Email flow; color/logo dependency enable/disable; add-ons admin CRUD → appears on form → snapshots on lead; closed-by picker; sign-in → session row → logout/idle close → logs tab shows attendance/hours/online/late.

## Out of scope / deferred
- Pre-lead versions of add-ons / color / logo / closed-by / design-reference (features 3–7 are lead-only per requirements).
- Email/SMS/push delivery for sign-in insights (in-app admin view only).
- Per-department / per-user work schedules (single company-wide start time for now).
- Fuzzy/near-duplicate matching (exact normalized only).

## Open items to confirm during implementation
- `work_timezone` default (spec assumes `Asia/Karachi` — adjust to the company's actual TZ).
- Idle-timeout default (spec: 15 min).
