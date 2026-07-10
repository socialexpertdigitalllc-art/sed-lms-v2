# SED LMS v2 — UX Polish Batch

**Date:** 2026-07-10
**Branch(es):** one per phase, off `main` (@ `9bf7dee`)
**Status:** Design approved — building in 4 phases, each merged & live-verified before the next.

A batch of UX polishes from the user, built in sequence. Shared theme: make the app feel product-grade — no emojis, a modern collapsible sidebar, and navigation/table state that behaves the way people expect (nothing resets under you).

## Locked decisions (from brainstorming)
- **No emojis anywhere** — replace every emoji/symbol-glyph used as UI with a `lucide-react` icon (already a dependency). Standing rule → [[no-emojis-use-icons]].
- **Sidebar pin** persists **per account** (extensible `profiles.ui_preferences` JSONB, not a one-off boolean).
- **Month filter** reaches **Dashboard + Leads list**, admin-scoped.
- **Bulk actions**: status change, (re)assign agent, archive (soft delete), export-selected — all four.
- **Rollout:** all five requests, in order, as 4 build phases (persistent-state + back-nav are one phase).

## Phase 1 — Icons + Sidebar 2.0

### 1a. Emoji / glyph → lucide sweep
Replace, keeping the same placement/size and using existing color tokens:
- `🎉` empty-state in `components/layout/BellBase.tsx:137` → a `CheckCircle2`/`Inbox` icon above the text.
- `⚡` generate button `components/ai-tools/Generator.tsx` → `Zap`; `↻` rebuild → `RotateCw`; `←/→` step nav → `ArrowLeft`/`ArrowRight`; `↓ Download ZIP` → `Download`; `✓ N pages` → `CheckCircle2`.
- `⚠` form-error glyph (`components/forms/Field.tsx`, `formShell.tsx`, `detail/FieldRow.tsx`, `payments/PaymentLinkModal.tsx`, `leads/NewLeadForm.tsx`, `preleads/AddPreLeadForm.tsx`) → `AlertTriangle` (w-3.5).
- `✕ Remove` / `✕` (`forms/DynamicList.tsx`, `tickets/TicketModal.tsx`, `layout/WorldClocks.tsx`) → `X`.
- `✓` success inline (`payments/PaymentLinksBoard.tsx` "Copied ✓", `leads/LeadDetail.tsx` "Queued ✓") → leading `Check` icon.
- `↓ Export CSV` (`leads/LeadsTable.tsx:327`) → `Download`; table sort `↑↓` indicators (LeadsTable, PreLeadsTable, GenerationsTable) → `ArrowUp`/`ArrowDown`/`ChevronsUpDown` (neutral).
- `←` back links (`admin/users/[id]`, `admin/departments/[id]`, `ai-tools/generations/[id]`) → handled by the Phase-2 `BackLink` (icon + history-aware); for now swap the `←` char to `ArrowLeft`.
- Leave functional keyboard hints (`⌘K`, `↑↓`, `↵` in `CommandPalette.tsx`) — those are keycap labels, not decorative emoji. And leave the `→` used inside prose/log strings (`"name → status"`), which are data, not UI chrome.
- **Guard:** an ESLint note / grep step in verification to catch stray emoji regressions.

### 1b. Collapsible icon-rail sidebar
Files: `components/layout/Sidebar.tsx`, `components/layout/AppShell.tsx`, new `components/layout/SidebarNav.tsx` (client), migration + `app/(app)/layout.tsx` (read prefs), new `app/api/me/preferences/route.ts`.
- **Per-item icons:** every `NavItem` gets a lucide icon. Mapping (final in plan): Dashboard `LayoutDashboard`, Leads `Building2`, Follow-ups `PhoneCall`, Tickets `Ticket`, By Agent `BarChart3`, Feedback `MessageSquareText`, Payments `CreditCard`, Notifications `Bell`; Pre-Leads `LayoutList`/`ListChecks`; AI `Sparkles`/`Globe`/`Bot`/`LineChart`/`Cog`; Admin `Users`/`Building`/`ShieldCheck`/`ScrollText`/`Upload`/`Blocks`/`BellCog`. Active state keeps the accent-soft treatment; drop the dot bullet.
- **Sticky:** sidebar becomes `sticky top-0 h-screen self-start overflow-y-auto`; `main` scrolls independently. AppShell root stays `flex`.
- **Collapse/expand:** two widths — rail `w-16` (icons only, centered, tooltip on hover shows label) and expanded `w-60` (icon + label, section headers visible). Effective-expanded = `pinned || hovering`.
- **Hover behavior:** `mouseenter` → expand immediately + clear any timer; `mouseleave` → start a **5s** timer that collapses back to the rail. Only when **not pinned**.
- **Pin:** a pin toggle button top-right of the sidebar header (lucide `Pin`/`PinOff`). Pinned → always expanded, no auto-collapse. Persisted to `profiles.ui_preferences.sidebarPinned` via `PATCH /api/me/preferences` (optimistic; fail-soft). Initial value read server-side in the layout and passed down so first paint matches.
- **Mobile (`< md`):** rail hidden; a hamburger (lucide `Menu`) in the Topbar opens the sidebar as an overlay/slide-over; backdrop closes it.
- **Migration `0023_ui_preferences.sql`:** `alter table profiles add column ui_preferences jsonb not null default '{}'::jsonb;` (extensible for future density/theme/default-sort). `PATCH /api/me/preferences` merges a partial object into the caller's own row (user client, RLS: users can update own profile — confirm existing policy; else service-role guarded by auth uid match). Mirror column in `seed.sql`.

## Phase 2 — Persistent table state + return-where-you-came-from

### 2a. URL-backed table state (fixes: filter resets on Back)
New `hooks/useTableUrlState.ts` (client): reads initial table state from `useSearchParams` and writes changes back with `router.replace(pathname + "?" + qs, { scroll: false })`. Keys are short (`q` search, `status`, `agent`, `type`, `region`, `sort`, `page`). Applied to `components/leads/LeadsTable.tsx` first (status tab, agent, site_type, region multi-select, sort key, global search, pagination), then `components/preleads/PreLeadsTable.tsx`, `components/tickets/TicketQueue.tsx`, `components/ai-tools/GenerationsTable.tsx`. Because state now lives in the URL, browser Back from a detail page restores the exact filtered view, and views are shareable/bookmarkable.
- Region multi-select serializes as comma-joined (`region=California,Texas`).
- Guard against feedback loops: only push to URL on user-initiated change; initialize once from URL on mount.

### 2b. History-aware back (fixes: Back lands on the wrong page)
New `components/common/BackLink.tsx` (client): renders an `ArrowLeft` + label; on click calls `router.back()` when there is in-app history, else falls back to a provided `href`. Replace the hardcoded `← Foo` links in `app/(app)/admin/users/[id]/page.tsx`, `app/(app)/admin/departments/[id]/page.tsx`, `app/(app)/ai-tools/generations/[id]/page.tsx`, and any lead/detail "back to list" affordances. Audit for other spots where a button navigates forward and its "back" assumes a fixed origin. Net effect: Back returns to the page (and filtered state) you actually came from.

## Phase 3 — Admin month filter (Dashboard + Leads)
Files: new `lib/analytics/dateScope.ts` (pure: `monthOptions(rows)`, `inMonth(iso, month)`, `MONTH_ALL`), new `components/common/MonthFilter.tsx` (client), integrate into `components/dashboard/DashboardBoard.tsx` and `components/leads/LeadsTable.tsx`.
- Control: a compact month dropdown, default **"All time"**, listing months that exist in the data (from `created_at`), newest first, labelled `July 2026`.
- **Dashboard:** month scope composes with the existing region scope — filter `leads`/`followUps`/`tickets` (by their lead's/own `created_at`) to the chosen month before recompute. Selection lives in URL (`month=2026-07`).
- **Leads:** adds a `created_at`-month filter to the table, wired through the same URL-state as Phase 2.
- **Gating:** the month control is shown only to admins/managers — visibility gated on `analytics.view_all_agents` (the existing "see everything" permission). Non-privileged users never see it; server data unaffected.
- Pure fns are TDD-tested; note-worthy edge: time-relative KPIs (e.g. "new this week") remain relative to today, not the scoped month — acceptable and documented.

## Phase 4 — Admin bulk actions (Leads)
Files: `components/leads/LeadsTable.tsx` (row selection + bulk bar), new `components/leads/BulkActionBar.tsx`, new `app/api/leads/bulk/route.ts`, extend `lib/leads/csv.ts` usage for export-selected.
- **Selection:** react-table row-selection — a header checkbox (select-all-on-page / all-filtered) + per-row checkboxes (new left column). A sticky **BulkActionBar** appears when ≥1 row selected: shows count + action buttons + Clear.
- **Actions (each gated by the caller's permission; only permitted ones render):**
  - **Change status** → status picker → `POST /api/leads/bulk {action:"status", ids, value}` (needs `leads.status_change`).
  - **(Re)assign agent** → agent picker → `{action:"assign", ids, agent_id}` (needs `leads.assign`).
  - **Archive** → confirm → `{action:"archive", ids}` sets `deleted_at` (needs `leads.delete`; reversible).
  - **Export selected** → client-side CSV of the checked rows (reuse `toCsv`/`leadCsvRow`); no API.
- **API** `POST /api/leads/bulk`: auth 401 → per-action permission 403 → validate ids (Zod) → apply via admin client → one `activity_log` summary row per action (`lead.bulk_status`/`bulk_assign`/`bulk_archive`) → return `{updated:N}`. Realtime refresh picks up changes.
- Overall bulk affordance gated so it only appears for privileged users (any of the three write perms).

## Testing (per phase)
- **Unit (Vitest):** Phase-1 none new (mechanical) beyond a preferences-merge test; Phase-2 `useTableUrlState` serialize/parse round-trip (state→qs→state); Phase-3 `dateScope` (`monthOptions` distinct+sorted, `inMonth` boundaries, `MONTH_ALL` passthrough); Phase-4 bulk request Zod schema + a `selectedRowsToCsv` helper.
- **Live (Chrome MCP):** P1 — no emojis remain (grep + visual), sidebar collapses to rail, hover-expands, auto-collapses after 5s, pin persists across reload/relogin, mobile overlay. P2 — filter Leads, open a lead, Back → filters intact; a hardcoded-back page returns to origin. P3 — pick a month → dashboard + leads scope to it; hidden for non-admins. P4 — select rows → bulk-change status/assign/archive/export; permission-gated actions hidden appropriately.

## Deferred (recommended, not in this batch unless asked)
Saved/named filter views, a global toast system (incl. live notification toasts), whole-row-click + hover row actions, sticky table headers, density toggle & column show/hide, relative timestamps, more `ui_preferences` (theme/density/default sort), keyboard row nav (`/`, `j/k`, `Enter`).
