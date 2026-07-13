# SED LMS v2 — Polish 5: custom lead tags + sidebar counts + dashboard agent filter + nav responsiveness

**Date:** 2026-07-14 · **Branch:** `polish-5` (off main @ f8ca751) · Groups A → C → BD (sequential; all touch shared loaders/sidebar). Migrations applied by controller via MCP. Next migration = **0032**.

---

## Group A — Custom lead tags (permission-gated feature)

### A1 Migration `0032_lead_tags.sql`
- `lead_tags` catalog: `id uuid pk default gen_random_uuid()`, `name text not null`, `color text not null default 'slate'`, `created_by uuid references profiles(id) on delete set null`, `created_at timestamptz default now()`, `unique(name)`.
- `lead_tag_links` M2M (mirror `department_members`): `id`, `lead_id uuid not null references leads(id) on delete cascade`, `tag_id uuid not null references lead_tags(id) on delete cascade`, `added_by uuid references profiles(id) on delete set null`, `added_at timestamptz default now()`, `unique(lead_id, tag_id)`; indexes on `lead_id` and `tag_id`.
- RLS (both tables `enable row level security`): SELECT `using (has_permission('leads.tags.view') or has_permission('leads.tags.manage'))`; ALL (write) `using/with check (has_permission('leads.tags.manage'))`.
- Permissions (0029 pattern): `('leads.tags.view','View & Filter Tags','See lead tags and filter leads by tag','leads',false)`, `('leads.tags.manage','Manage Lead Tags','Create/edit/delete tags and apply them to leads','leads',false)`. Grants: `sales`→view; `management`+`admin`→view+manage. (Admin can extend manage to sales via the grid — the point of permission-gating.)
- `alter publication supabase_realtime add table public.lead_tag_links;`
- Add both keys to `lib/permissions/constants.ts` PERMISSIONS (category `leads`).

### A2 API
- `app/api/tags/route.ts`: GET (list catalog, gate `leads.tags.view`), POST `{name, color}` (gate `leads.tags.manage`; trim name, 422 if empty/dupe).
- `app/api/tags/[id]/route.ts`: PATCH `{name?, color?}` + DELETE (gate `leads.tags.manage`; delete cascades links).
- `app/api/leads/[id]/tags/route.ts`: PUT `{tagIds: string[]}` — replace the lead's tag set (gate `leads.tags.manage`; validate lead visible via the RLS user client first; then admin-client delete+insert links). Return 200.
- All use `getUserPermissions`; consistent 403/422 like existing routes.

### A3 Types + list loader
- `lib/leads/types.ts`: add `tag_ids?: string[]` to `Lead` (optional; populated client-side). Add `export type LeadTag = { id: string; name: string; color: string };`.
- `app/(app)/leads/page.tsx`: change the leads select to `.select("*, lead_tag_links(tag_id)")`; after fetch, map each row `tag_ids = (row.lead_tag_links ?? []).map(l => l.tag_id)` and strip the nested field. Also load the catalog `const { data: tags } = await supabase.from("lead_tags").select("id,name,color").order("name")` (RLS returns [] without perm). Pass `tags={tags ?? []}` and `canViewTags={perms.has("leads.tags.view") || perms.has("leads.tags.manage")}` and `canManageTags={perms.has("leads.tags.manage")}` to `<LeadsTable>`. (Load perms in this loader — it currently may not; add `getUserPermissions`.)

### A4 LeadsTable filter + column
`components/leads/LeadsTable.tsx` (mirror the Region pattern exactly):
- Props: add `tags: LeadTag[]`, `canViewTags: boolean`, `canManageTags: boolean`.
- `LEADS_DEFAULTS`: add `tags: ""`.
- `tagSel = useMemo(() => (urlState.tags ? urlState.tags.split(",") : []), [urlState.tags])`.
- `columnFilters`: `if (tagSel.length) f.push({ id: "tags", value: tagSel })`.
- Hidden `tags` column: `{ id:"tags", accessorFn:(row)=>row.tag_ids ?? [], filterFn:(row,id,value:string[])=>!value?.length || (row.getValue<string[]>(id) ?? []).some(t=>value.includes(t)), enableSorting:false, enableHiding:false }`; force hidden via `columnVisibility` (like `region:false`).
- `filtersActive` + `clearFilters`: include `tags` (reset to "").
- Toolbar: render `{canViewTags && <TagFilter tags={tags} selected={tagSel} canManage={canManageTags} onChange={(next)=>setUrlState({ tags: next.join(","), page:"0" })} />}` next to RegionFilter.
- Optional visible chips: add a small Tags cell into the Business column (under the name) showing the lead's tag chips (look up `tags` by `row.original.tag_ids`), `hidden` on the narrowest breakpoints. Keep it subtle.

### A5 `components/leads/TagFilter.tsx` (new, model on RegionFilter)
- `"use client"` dropdown. Props `{ tags: LeadTag[]; selected: string[]; canManage: boolean; onChange: (next:string[])=>void }`.
- Trigger button `Tag` icon + `selected.length ? \`Tags · ${selected.length}\` : "Tags"`; outside-click close; checkbox list of tags (colored dot per tag via a `TAG_COLORS` map), Clear.
- If `canManage`: a divider + inline "create tag" row (name input + color dots + Add → POST `/api/tags` → refetch via `router.refresh()`), and a trash per tag (DELETE `/api/tags/[id]` → refresh). Keep it compact.
- `TAG_COLORS`: a shared map `lib/leads/tagColors.ts` — 8 named colors → `{ dot: string; chip: string }` Tailwind classes (e.g. slate/red/amber/green/teal/blue/purple/pink using existing theme-ish utilities). Used by TagFilter + chips + LeadDetail.

### A6 LeadDetail tag editor
- `app/(app)/leads/[id]/page.tsx`: load the lead's tags (`lead_tag_links(tag_id)` embed or a `.select` join) + the catalog + `canManageTags`; pass to `<LeadDetail>`.
- `components/leads/LeadDetail.tsx`: add a "Tags" `SectionCard` (chip multi-select) in the left stack — shows current tags as removable chips + an "add tag" dropdown from the catalog; on change PUT `/api/leads/${id}/tags` with the new id set then `router.refresh()`. Read-only chips when `!canManageTags`. NO emojis.
- Tests: `tests/tags.test.ts` — pure helpers only (e.g. a `toggleTag(ids, id)` add/remove used by the editor, and tag-filter matching `leadMatchesTags(leadTagIds, selected)`).

---

## Group C — Admin dashboard: filter analytics by one sales user

- `app/(app)/dashboard/page.tsx`: load Sales-dept members (the `slug='sales'` → `department_members` + `profiles!…_user_id_fkey` join, copy from `leads/page.tsx:19-33`) → `salesUsers: {id, display_name}[]`. Pass `salesUsers={salesUsers}` to `<DashboardBoard>`. (`canScopeMonth` already = `analytics.view_all_agents`; reuse it to gate the agent control.)
- `components/dashboard/DashboardBoard.tsx`: add prop `salesUsers: {id: string; display_name: string}[]`. Add state `const [agentId, setAgentId] = useState("")`. Fold into `fLeads`: `...filter((l) => !agentId || l.agent_id === agentId)` (alongside region+month). Render a `<Select>` in the filter row **gated on `canScopeMonth`** (only view-all-agents users): `<option value="">All agents</option>` + salesUsers. Include `agentId` in the Clear-filters `filtersActive`/reset (currently month+region) and reset `setAgentId("")` there. When `agentId` set, the "X of Y" subtitles/KPIs already recompute from `fLeads`.

---

## Group BD — Sidebar realtime counts + instant nav feedback + loader perf

### BD1 Counts API `app/api/nav-counts/route.ts`
GET → `{ counts: Record<string, number> }`. Compute ONLY the keys the caller's perms allow (skip others; the sidebar only shows badges it receives). Use the RLS **user client** for user-scoped entities (leads, pre_leads) so counts match what they see; admin client + explicit perm gate for admin entities. Keys + definitions:
- `leads` — visible non-deleted leads (`leads` count, RLS-scoped), if `leads.view`.
- `followups` — overdue: active leads with `follow_up_time < now()` and status not in ('Closed','Dropped'), if `leads.view`. (Use a count query with those filters.)
- `tickets` — unresolved in ticket scope: `status != 'Resolved'`, filtered by `allowedTicketScope`, if `tickets.view`.
- `feedback` — `status = 'Open'`, if `feedback.manage` (else omit).
- `payments` — `payment_links` where `is_active`, if `payments.view`.
- `preleads` — visible pre_leads (RLS), if `pre_leads.view`.
- `users` — `profiles` where `is_active`, if `admin.users.view`.
- `departments` — `departments` where `is_active`, if `admin.departments.manage`.
- `addons` — `website_addons` where `is_active`, if `admin.settings.manage`.
Use Supabase `count: "exact", head: true` selects; run them with `Promise.all`.

### BD2 Sidebar badges (`components/layout/Sidebar.tsx`)
- New client child `components/layout/NavCountsProvider.tsx` (or inline in Sidebar since it's already client): fetch `/api/nav-counts` on mount; subscribe to `postgres_changes` on `leads, lead_tickets, feedback, pre_leads, payment_links, profiles, departments, website_addons` (one channel, JWT auth via `supabase.realtime.setAuth`, 400ms debounce → refetch) — copy BellBase's pattern. Expose a `Record<string,number>`.
- Map nav `href` → count key: `/leads`→leads, `/follow-ups`→followups, `/tickets`→tickets, `/feedback`→feedback, `/payments`→payments, `/pre-leads/all` (or the pre-leads hrefs)→preleads, `/admin/users`→users, `/admin/departments`→departments, `/admin/add-ons`→addons.
- In `renderItem`, when a count exists and `showLabels`, render a badge after the label: `<span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-surface-2 text-text-muted">{count}</span>` (tickets/feedback badges highlight when >0: `bg-dropped-bg text-dropped-fg`). Collapsed rail: a small dot on the icon when count>0. Badge hidden when count is 0 or undefined (except leads/preleads which can show 0? — show only when >0 to reduce noise; tickets/feedback always show when >0).

### BD3 Instant nav feedback (`useLinkStatus`)
- Wrap each nav `<Link>`'s inner content so a spinner shows while navigation is pending. `useLinkStatus` (from `next/link`, available in 16.2.9) MUST be called from a component rendered INSIDE the `<Link>`. Create `components/layout/NavItemContent.tsx` (`"use client"`): renders the icon + label + count, and `const { pending } = useLinkStatus();` → when `pending`, swap/append a `Loader2` spinner (lucide, `animate-spin`) beside the label (replace the count badge while pending). Render `<Link ...><NavItemContent .../></Link>` in `renderItem`. This gives the instant per-item spinner the moment a link is clicked — the fix for "user clicks again and again".

### BD4 Loader perf (find + fix the lag causes) — document in the PR/commit body
- **Parallelize independent serial awaits** with `Promise.all`:
  - `app/(app)/dashboard/page.tsx`: `leads`, `profiles`, `lead_follow_ups`, `lead_tickets` are independent → one `Promise.all` (keep `auth.getUser`→`getUserPermissions` chain; the Group C salesUsers load can join the parallel batch or follow).
  - `app/(app)/leads/page.tsx`: `leads`, `profiles`, `departments` independent → `Promise.all` (then `department_members` depends on `salesDept.id`; and the Group A `lead_tags` catalog can join the batch).
  - `app/(app)/by-agent/page.tsx`: `leads` + `profiles` → `Promise.all`.
  - `app/(app)/pre-leads/page.tsx`: `pre_leads` + `profiles` → `Promise.all`.
- **Dedupe branding**: wrap `getBranding`/`getAppSettings` in `lib/settings/appSettings.ts` with React `cache()` (it's called in both `app/layout.tsx` generateMetadata and `app/(app)/layout.tsx` per full render). Import `{ cache } from "react"`.
- Do NOT change `select("*")` to column lists (many fields consumed downstream; risky) — parallelization is the safe win. Note in the report that the remaining cost is pulling all 400+ leads per dashboard/leads nav, and that server-side pagination/aggregation is a larger future task.
- Keep `loading.tsx` skeletons (already present) — with the nav spinner they now give instant feedback.

---

## Gates & rollout
Per group: subagent runs `npx tsc --noEmit` + `npx vitest run` green (NO `npm run build` per group). Controller applies migration 0032 via MCP, runs the final `npm run build`, ff-merges `polish-5` → main, pushes. Live-verify deferred (login). Prod needs hPanel redeploy.
