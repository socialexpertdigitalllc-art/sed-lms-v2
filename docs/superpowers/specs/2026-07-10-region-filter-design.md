# SED LMS v2 — Region Filter (area-code → state)

**Date:** 2026-07-10
**Branch:** `region-filter` (off `main` @ `69f644a`)
**Status:** Design approved — ready for planning

A self-maintaining **Region** facet derived from leads' phone area codes: on the Leads list it's a multi-select filter; on the Dashboard it scopes all KPIs/charts. Regions appear/disappear automatically as leads' area codes change. **No schema, no permissions** — region is derived from the existing `leads.business_phone`; the filter is available wherever the leads/dashboard already are.

## Decisions (locked in brainstorming)
- Lives on **both** the Leads list page and the Dashboard.
- A region is a **US state** (groups all a state's area codes: California = 415/310/831/916).
- The "main/best area code" = **most frequent among that region's leads** (data-driven).
- **Multi-select** (combine regions).
- Approach: **client-derived**, no `region` column / DB reference table (mapping is fixed reference data; deriving live is what auto-maintains the options).

## 1. Geo core — `lib/geo/`
- **`areaCodes.ts`**: `AREA_CODE_STATE: Record<string, { state: string; stateCode: string }>` — comprehensive US NANPA geographic area codes → state (full name + 2-letter). Non-geographic (toll-free 800/888/…, premium 900, personal) and unmapped/Canadian codes are simply absent → bucketed "Unknown" by callers.
  - `areaCodeOf(phone: string | null): string | null` — strip to digits; drop a leading `1` on 11-digit; return the first 3 if ≥10 digits remain, else null.
  - `stateOfPhone(phone): { state, stateCode } | null` — map `areaCodeOf` through `AREA_CODE_STATE`.
- **`regions.ts`** (pure, TDD):
  - `UNKNOWN_REGION = "Unknown"`.
  - `leadRegion(lead: { business_phone: string | null }): string` → state name or `"Unknown"`.
  - `RegionFacet = { region: string; stateCode: string | null; leadCount: number; mainAreaCode: string | null; areaCodes: string[] }`.
  - `buildRegionFacets(leads): RegionFacet[]` — group leads by `leadRegion`; per region: `leadCount`, `areaCodes` (distinct codes present, sorted), `mainAreaCode` (the code appearing on the most leads; ties → lowest code). Sort real regions by `leadCount` desc then name; **"Unknown" always last**. Regions with 0 leads never appear (auto add/remove).
  - `filterLeadsByRegions<T extends { business_phone: string | null }>(leads: T[], selected: Set<string>): T[]` — `selected.size === 0` → all; else keep leads whose `leadRegion ∈ selected`.

## 2. Leads list filter (`/leads`)
- **`components/leads/RegionFilter.tsx`** (client): a "Region" dropdown button (shows a count badge when active) opening a popover checklist of `buildRegionFacets(rows)` — each item `‹checkbox› California · 415 · (4)` — plus "Clear". Controlled via `selected: string[]` + `onChange`. Closes on outside-click (mirror an existing popover pattern; else a simple `useEffect` outside-click).
- **`components/leads/LeadsTable.tsx`** wiring: add a hidden accessor column `id: "region"`, `accessorFn: (l) => leadRegion(l)`, with `filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue("region"))`. Render `<RegionFilter facets={buildRegionFacets(rows)} selected={regionSel} onChange={setRegionSel} />` in the filter row (after Type), and `useEffect(() => table.getColumn("region")?.setFilterValue(regionSel), [regionSel])`. `rows` = the leads already passed to the table (compute facets from them so options match the current data). Instant, client-side, matching the sibling filters.

## 3. Dashboard scoping (`/dashboard`)
Refactor: `app/(app)/dashboard/page.tsx` becomes a thin server shell — auth, `perms`/`flags`/`visible`, load `leads` (as today), `agents`, follow-ups **`select("fu_status, lead_id")`**, tickets **`select("status, due_date, created_at, resolved_at, lead_id")`**; compute `facets = buildRegionFacets(leads)`. Keep the existing `!anyDashboardVisible` server empty-state. Otherwise render `<DashboardBoard leads followUps tickets agentNameById flags visible facets />`.
- **`components/dashboard/DashboardBoard.tsx`** (client): holds `selected: string[]` state; builds `regionByLeadId = Map(lead.id → leadRegion(lead))`; derives `fLeads = filterLeadsByRegions(leads, sel)`, `fFollowUps = sel.size ? followUps.filter(f => sel.has(regionByLeadId.get(f.lead_id) ?? "Unknown")) : followUps`, `fTickets` likewise. Recomputes `computeKpis`, `computeExtendedKpis`, `by*`, `leadsOverTime`, `freshVsFollowup`, `revenueByStatus`, `ticketStatusSplit` from the filtered arrays, and renders the **exact existing markup** (moved verbatim from the page: header subtitle, KpiHero, StatGrid, StatusStrip, all ChartCards) gated by the same `flags`/`visible` props. Renders `<RegionScopeBar/>` above the header.
- **`components/dashboard/RegionScopeBar.tsx`** (client): "All regions" chip + one chip per facet (`California · 415 · 4`); click toggles membership (accent when active); a Clear when any selected. When a filtered array is empty the widgets naturally show zeros (acceptable; no special empty copy).
- All metric functions are pure/client-safe (no server imports) — confirmed. Permission gating stays via the server-computed `flags`/`visible` props. Toggling is instant (no round-trip).

## 4. Testing
- **Unit (Vitest)** `tests/regions.test.ts`: `areaCodeOf` ("(415) 555-0101"→"415", "1 415 …"→"415", ""→null, "12345"→null); `stateOfPhone` (415→California/CA, 214→Texas, unmapped→null); `buildRegionFacets` (groups CA's 415/310/916 into one region w/ leadCount 3, mainAreaCode = the most frequent, areaCodes sorted; Unknown bucket for a null-phone lead; Unknown sorted last; sort by count desc); `filterLeadsByRegions` (empty set → all; {California} → only CA-phone leads).
- **Live (Chrome MCP):** Leads — open Region filter, options match seeded data, select California + Texas → table shows only those leads, badge shows 2, Clear resets. Dashboard — chips render with counts; pick California → Total Leads + charts recompute to CA-only; "All regions" restores.

## Out of scope / deferred
Metro/city granularity; Canadian/territory codes; a visible Region column on the table; saved region views; server-side region filtering for very large datasets (client-derived is fine at current scale); URL-persisted selection.
