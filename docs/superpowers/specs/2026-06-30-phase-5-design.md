# Phase 5 — Activity Log, CSV Export, Realtime, Sheets Importer — Design

**Date:** 2026-06-30
**Status:** Approved (brainstorm) — ready for implementation plan
**Builds on:** Phases 1–4 + WGE-1/2. Final planned phase of the v2 rebuild.

---

## 1. Goal & Scope

Five mostly-independent, additive features:
1. **Activity & movement logs** — (a) an admin view of the existing `activity_log` (audited server-side *mutations*), PLUS (b) a new **client-side user-movement tracker** capturing every meaningful action (page views, opening a lead, switching tabs, leaving/returning to the browser tab) into a high-volume `user_activity` table, with a combined admin viewer.
2. **CSV export** — export the (filtered) leads table to CSV.
3. **Realtime** — live-refresh the leads, pre-leads, and WGE-queue views via Supabase Realtime.
4. **Google Sheets importer** — bulk-import leads from the company's existing Google Sheet, reusing the old service account, with an **editable, persisted column mapping**.

All ship in one phase (one spec, one plan), each as its own set of tasks.

> **Note on the movement tracker:** this is internal employee-activity auditing of the company's own staff and their own data — explicitly requested. Capture breadth = **comprehensive** (page views + clicks on interactive elements + browser-tab focus changes); retention = **auto-prune after 90 days**.

## 2. Activity & Movement Logs

Two data sources, one combined admin viewer at `/admin/logs` (gated by **`admin.logs.view`**; redirect otherwise). The page is a server component that, **after the permission guard passes**, loads both datasets via the **service-role admin client** — so the page guard (`admin.logs.view`) is the single source of truth and there's no mismatch with the per-table `is_admin()` RLS (which would otherwise block an `admin.logs.view` holder who isn't in the admin dept).

### 2a. Audit log (existing `activity_log` — mutations)
- Reads the newest ~200 `activity_log` rows, joined to `profiles` (pinned FK `activity_log_user_id_fkey`) for the actor `display_name`. Columns: time, actor, action, entity_type, entity_id, compact `new_value`/`old_value`.

### 2b. User-movement tracker (new `user_activity` — every action)
- **Table `user_activity`** (migration `0009`): `id uuid pk`, `user_id uuid → profiles on delete cascade`, `type text` (`page_view` | `click` | `focus`), `path text` (route), `label text` (e.g. "Open lead", "WGE: Queue tab", button/link text), `meta jsonb` (e.g. `{ href, leadId, hidden }`), `created_at timestamptz default now()`. Indexes: `(user_id, created_at desc)`, `(created_at)`. RLS enabled with **no client-facing policy** — both the viewer (read) and the track endpoint (insert) go through the service-role client, so clients can never read others' activity or write arbitrary rows.
- **Client tracker** `providers/ActivityTracker.tsx`, mounted once in `app/(app)/layout.tsx` (authenticated area only). Captures:
  - **page_view** — on `usePathname()` change (route navigation).
  - **click** — a delegated `document` click listener; resolves the nearest interactive ancestor (`a`, `button`, `[role=button]`, `[data-track]`); records `label` (the element's `data-track` || trimmed text || `aria-label`, capped ~80 chars) and `meta` (`href`; `leadId` from a `data-lead-id` attr when present). Non-interactive clicks are ignored (keeps volume sane while still capturing "opened lead", "switched tab", "clicked Generate", etc.).
  - **focus** — `visibilitychange` → `label` = `"left"` / `"returned"` (browser-tab switching away from / back to the dashboard).
  - **Batching:** events queue in memory and flush on a ~5s timer, at 20 queued events, and on `pagehide`/`visibilitychange→hidden` via `navigator.sendBeacon` (fallback `fetch`, `keepalive`). One `POST /api/activity/track` carries a batch.
  - Lightweight instrumentation: a few key elements get `data-track` / `data-lead-id` attributes (lead rows, tab buttons) so their labels are clean; everything else falls back to text.
- **Endpoint** `POST /api/activity/track`: authenticated; Zod-validates a batch (≤ 50 events, each `{type, path, label?, meta?}`); inserts rows via the service-role client stamping `user_id` from the session. Returns `204`. **Opportunistic retention:** a module-level throttle calls `prune_user_activity()` at most ~once/hour.
- **Retention** `prune_user_activity()` SQL fn (migration `0009`): `delete from user_activity where created_at < now() - interval '90 days'`.
- **Viewer** `components/admin/LogsViewer.tsx` (client, TanStack): two tabs — **Audit** (`activity_log`) and **User Activity** (`user_activity`) — each with global search + actor filter + type/action filter + date. The User-Activity tab is the high-volume "raw movement" stream.
- **Nav:** add `{ href: "/admin/logs", label: "Activity Log", perm: "admin.logs.view" }` to the `ADMIN` nav array in `Sidebar.tsx`.

## 3. CSV Export

- **Lib:** `lib/leads/csv.ts` — `toCsv(rows: Record<string,unknown>[], columns: {key,label}[]): string` (RFC-4180 quoting: wrap in quotes when the value contains `,`/`"`/newline, double internal quotes). Pure, unit-tested.
- **UI:** an **Export CSV** button in the `LeadsTable` toolbar, shown only with the existing **`leads.export`** permission. It serializes the **currently filtered** rows (`table.getFilteredRowModel().rows`) — a curated column set (date, business, email, phone, status, agent, site type, price, rating, follow-up) — and triggers a client download (`Blob` + object URL, filename `leads_YYYY-MM-DD.csv` with the date passed from the server page to avoid `Date` nondeterminism in tests; here a plain `new Date()` in the click handler is fine).
- No server round-trip (data is already loaded client-side).

## 4. Realtime (leads + pre-leads + queue)

- **Migration `0009`** adds the three tables to the realtime publication:
  `alter publication supabase_realtime add table public.leads, public.pre_leads, public.wge_queue;`
- **Hook:** `hooks/useRealtimeRefresh.ts` — `useRealtimeRefresh(table: string)` subscribes via the browser Supabase client to `postgres_changes` (event `*`, schema `public`, the given table) on a unique channel; on any event it calls `router.refresh()` **debounced ~400ms** (collapses bursts). Cleans up the channel on unmount. RLS still scopes which change events a client receives.
- **Wiring:** call the hook inside the existing client components that render these lists — `LeadsTable` (`leads`), the pre-leads table component (`pre_leads`), and the WGE-control queue tab (`wge_queue`). `router.refresh()` re-runs the server component, so fresh data flows back through props with no client refetch logic.

## 5. Google Sheets Importer

### Credentials & dependency
- Reuse the old `service-account-key.json` (client_email `gemini-service-account@n8n-agent-482915…`). Store its JSON as **`GOOGLE_SERVICE_ACCOUNT_JSON`** (single-line JSON) in gitignored `.env.local`; add the key name to `.env.example`.
- New dependency: **`googleapis`** (Sheets v4), server-side only.
- Server helper `lib/import/sheets.ts`: `readSheet(sheetId, tab): Promise<string[][]>` — builds a `google.auth.JWT` from `GOOGLE_SERVICE_ACCOUNT_JSON` with scope `https://www.googleapis.com/auth/spreadsheets.readonly`, calls `sheets.spreadsheets.values.get`, returns raw rows (row 0 = headers).

### Persisted, editable mapping — `import_config` singleton (migration `0009`)
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `singleton` | boolean unique default true | one row |
| `sheet_id` | text | default `1KBWPYJHyXiradB9csWMYEnlFPXVHGDTyc1pmv3uB8sk` |
| `sheet_tab` | text | default `New (April 2026)` |
| `mapping` | jsonb | column-letter → lead field key (see default below) |
| `updated_at`/`updated_by` | | |
- RLS: select for `admin.import`; writes via service role behind the API guard. Lazily seeded with defaults by the loader (same pattern as `wge_config`).
- **Default mapping** (ported from the old `COLUMNS`, translated to v2 `leads` columns):
  `A→created_at, B→status, C→website_link, D→agent, E→site_type, F→business_name, G→business_phone, H→business_email, I→platform, J→business_profile_link, K→services, L→has_service_areas, M→client_experience, N→num_webpages, O→specify_pages, P→color_scheme, Q→service_areas, R→image_links, S→logo_link, T→follow_up_time, U→price_quoted, V→direct_line_saved, W→reference_link, X→comments, Y→rating, Z→fresh_or_followup, AA→yearly_price, AB→map_embed_link`.
- `agent` is a **special target**: the cell value (agent display name) is resolved to a `profiles.id` by case-insensitive `display_name` match (unmatched → null/unassigned). `(ignore)` is a valid target to skip a column.

### Mapping & coercion — `lib/import/map.ts` (pure, tested)
- `mapRow(row: string[], mapping: Record<string,string>): Partial<LeadInsert>` — for each `columnLetter→field`, read the cell at that column index (letter→index helper) and coerce by field type:
  - arrays (`services`, `service_areas`, `specify_pages`, `image_links`) — split on commas/newlines, trimmed, empties dropped;
  - numbers (`client_experience`, `num_webpages`, `price_quoted`, `rating`) — parsed, invalid → null;
  - booleans (`has_service_areas`, `direct_line_saved`) — `Yes/true/1` → true, `No/false/0` → false, else null;
  - dates (`created_at`, `follow_up_time`) — parsed to ISO, invalid → null;
  - `status` — validated against `LEAD_STATUSES`, else `"Not Ready"`;
  - text — trimmed; empty → null. `business_name` empty → row is **invalid** (skipped, counted).
- `agent` is returned as a raw name on a side field for the route to resolve (not a `leads` column directly).

### Flow & API (all gated by new `admin.import`)
- `GET /api/admin/import/config` → `{ config }`.
- `PUT /api/admin/import/config` → validate (Zod) + upsert singleton.
- `POST /api/admin/import/preview` `{ sheetId, tab, mapping }` → reads the sheet, maps rows, resolves agents, computes dedupe → returns `{ headers, sample: first 20 mapped rows, total, valid, invalid, newCount, dupCount }`.
- `POST /api/admin/import/run` `{ sheetId, tab, mapping }` → inserts the **new, valid** rows into `leads` via service role (`created_by` = importing admin, `agent_id` resolved), logs `activity_log` (`leads.imported`, count) → `{ imported, skipped }`.
- **Dedupe:** a row is a duplicate if a non-deleted lead already exists with the same `business_name` (case-insensitive) **and** `business_phone`. Re-runs only import genuinely new rows.
- **UI** `app/(app)/admin/import/page.tsx` + `components/admin/SheetImporter.tsx` (client): sheet ID + tab inputs; an editable **mapping table** (one row per spreadsheet column letter A…AB with a `<select>` of target lead fields incl. `(ignore)` + `agent`); **Save mapping**, **Preview** (shows counts + a sample table), **Import** (shows result). Nav: `{ href: "/admin/import", label: "Import", perm: "admin.import" }` under Admin.

## 6. Migrations / Permissions / Env / Deps

- **Migration `0009`:** create `user_activity` (+ indexes, RLS, `prune_user_activity()` fn); create `import_config`; add permission `admin.import` (category `admin`, `is_sensitive`) + grant to depts `admin`/`tech`; `alter publication supabase_realtime add table public.leads, public.pre_leads, public.wge_queue`. Also add `admin.import` to `lib/permissions/constants.ts` + `seed.sql`. (`admin.logs.view` already exists and covers the new viewer.)
- **Env:** `GOOGLE_SERVICE_ACCOUNT_JSON` in `.env.local` (gitignored) + key name in `.env.example`.
- **Dep:** `googleapis`.

## 7. Error Handling

- Sheets read failure (bad ID/tab, sheet not shared with the service account, auth error) → preview/run return a clear message; the UI shows it. (The sheet must be shared with the service-account email — note this in the UI helper text.)
- `GOOGLE_SERVICE_ACCOUNT_JSON` unset → import endpoints return a clear "Sheets import not configured" 500.
- Invalid rows (no business name) are skipped and counted, never block the import.
- Realtime subscription failure is non-fatal (manual refresh still works); the hook swallows channel errors.
- CSV export with zero rows → still downloads a header-only file.

## 8. Testing

- **Unit:** `toCsv` (quoting, commas, newlines, embedded quotes, empty set); `mapRow` (each coercion type, invalid rows, `(ignore)`, array splitting); `columnLetterToIndex` (A→0, Z→25, AA→26, AB→27); dedupe predicate; the tracker's interactive-ancestor/label resolver (pure helper — link/button/`data-track`/text fallback/non-interactive→null); the track-batch Zod schema (size cap, type enum). Existing 77 tests stay green.
- **Live (Chrome):** logs viewer renders both tabs + filters; **movement tracker** — navigate between pages, open a lead, switch a WGE tab, switch browser tabs → confirm `user_activity` rows appear (page_view / click with correct labels / focus left+returned) and show in the User-Activity tab; CSV downloads with filtered rows; realtime — edit a lead/queue row and see another tab update without manual refresh; importer — Preview against the real sheet shows correct counts, edit the mapping + save, Import a few new rows and confirm they appear in Leads (then clean up test imports + test movement rows).

## 9. Out of Scope (YAGNI)

- Continuous/scheduled Sheets sync (import is on-demand, re-runnable).
- Two-way sync back to Sheets.
- Importing pre-leads / analytics tabs (leads only; the mapping/UI generalize later if needed).
- OAuth per-user Google auth (service account only).
- Realtime on admin/config tables (only the operational lists).
