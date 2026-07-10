# SED LMS v2 — UX polish round 3

**Date:** 2026-07-10 · **Branch:** `ux-polish-3` (off main @ 5ac857c) · **Status:** approved. Decisions: **defer dark mode**; responsive tables = **auto-hide low-priority columns**.

Six targeted fixes + the 4 remaining deferred UX items (minus dark mode), then a self-directed polish pass.

## Phase A — table & layout fixes (react-table tables: LeadsTable, PreLeadsTable, GenerationsTable unless noted)
1. **Open detail only from the name.** Remove the `<tr>` `onClick`/`cursor-pointer` whole-row navigation. Wrap the **business name** (Leads/Generations) / **business name** (PreLeads) in a `<Link>` to the detail (`/leads/{id}`, `/pre-leads/{id}`, `/ai-tools/generations/{id}`) with hover-underline. KEEP `group` on the `<tr>` so the hover-revealed action buttons still work; KEEP the existing "Detail/View" action button.
2. **Rows-per-page.** Add `size` to each table's URL-state defaults (default "15"); `pagination.pageSize = Math.max(1, Number(size)||15)`. Render a **"Rows per page"** `<Select>` (options 15/25/50/100) in the table footer (near the page indicator) → `setUrlState({ size: v, page: "0" })`. Show the footer even when only one page (so the control is always reachable).
3. **Responsive columns (no horizontal scroll).** Give lower-priority columns a `meta: { responsiveClass: string }` and apply that class to BOTH the `<th>` and `<td>` (the render already maps headers/cells — append `cell.column.columnDef.meta?.responsiveClass`). LeadsTable priorities: Rating `hidden 2xl:table-cell`, Follow-up `hidden xl:table-cell`, Phone `hidden lg:table-cell`, Type `hidden lg:table-cell`, Date `hidden md:table-cell`; always-visible: #, select, Status, Agent, Business, Price, actions. PreLeads/Generations: similarly drop their lowest-value columns first. Add `TableMeta`/`ColumnMeta` module augmentation for the `responsiveClass` type (a `types` file or inline `declare module "@tanstack/react-table"`). The `overflow-auto max-h-[70vh]` wrapper stays (vertical scroll for long lists + sticky headers) but columns now fit horizontally.
4. **Sidebar auto-close 5s → 1s.** `components/layout/Sidebar.tsx` line ~86: `setTimeout(..., 5000)` → `1000`.
5. **Detail field overflow.** `components/detail/FieldRow.tsx`: the display value box (`<div className="min-w-0 flex-1 text-sm text-text">`) → add `break-words overflow-hidden` so long URLs/text wrap inside their column instead of spilling out.

## Phase B — Sales can edit "Closed by"
- **Detail page** `components/leads/LeadDetail.tsx` line ~179: the "Closed by" `FieldRow` is currently read-only. Make it an editable **select** — `type="select"`, `options` = a "— (none) —" plus **Closing-department** members (label=display_name, value=id) — `canEdit={canEditClosedBy}`, `onSave={(v)=>patch({ closed_by: v || null })}`, `display={closedByName}`.
- **Server** `components/leads/LeadDetail`'s page loader (find where LeadDetail is rendered — `app/(app)/leads/[id]/page.tsx`): load Closing-dept members (slug `closing`, the `department_members`+`profiles!…_user_id_fkey` join) and compute `isSalesMember` (current user ∈ Sales dept, slug `sales`). Pass `closingUsers` + `canEditClosedBy = perms.has("leads.edit") || isSalesMember` to LeadDetail. (LeadDetail's existing `canEdit` for OTHER fields stays `leads.edit`-gated; only Closed-by gets the Sales-member allowance.)
- **API** `app/api/leads/[id]/route.ts`: a PATCH whose keys are exactly `{closed_by}` should be allowed for a Sales-department member even without `leads.edit`. Add: if the body is closed_by-only AND the user is a Sales member → allow (skip the `leads.edit` 403). Implement a small `isSalesMember(userId)` check (admin client: sales dept id → department_members row). Keep all other gating.

## Phase C — remaining UX items (NO dark mode)
- **Density toggle** (comfortable/compact): a control (near the table toolbar or a global setting) toggling row padding; persist to `profiles.ui_preferences.density`. Read on the client (a `useUiPref` hook reading an initial value passed from the layout + writing via `PATCH /api/me/preferences`).
- **Column show/hide**: a "Columns" dropdown on each react-table table listing hideable columns with checkboxes → drives react-table `columnVisibility` state; persist per-table to `ui_preferences.columns.{table}`.
- **Saved/named filter views**: migration `saved_views` (id, user_id, name, path, query, created_at); a "Save view" control capturing the current URL query + a views dropdown to apply; `GET/POST/DELETE /api/me/views`. Per-user.
- **Keyboard nav**: `/` focuses the table search, `j`/`k` move a highlighted row, `Enter` opens the highlighted row's detail, `Esc` clears. Scoped to the leads table (a `useTableKeyboardNav` hook); ignore when typing in an input.
- Density + column choices + last sort persist to `ui_preferences` (extends the JSON from [[ux-polish-batch]] migration 0023).

## Phase D — self-directed polish
After the above ships: a pass of small UX refinements I judge valuable (empty states, loading skeletons, focus states, consistent spacing, etc.) — presented before/as I do them.
