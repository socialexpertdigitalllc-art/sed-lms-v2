# Region Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-maintaining Region facet (US state, derived from leads' phone area codes) — a multi-select filter on `/leads` and client-side region scoping on `/dashboard`, with a data-driven "main area code" per region.

**Architecture:** A pure geo core (`lib/geo/`: static area-code→state map + facet/filter helpers, TDD) consumed by a client `RegionFilter` on the react-table Leads list and a `DashboardBoard`/`RegionScopeBar` client refactor of the dashboard. No schema, no permissions — region derives from existing `leads.business_phone`; options derive from current leads.

**Tech Stack:** Next.js 16 App Router + TS, @tanstack/react-table, Recharts, Vitest. No DB changes.

**Environment notes:**
- Windows; npm slow — `npx vitest run <file>` + `npx tsc --noEmit`; `npm run build` at the end.
- Pure metric fns (`computeKpis`, `computeExtendedKpis`, `byStatus/byAgent/bySiteType/ratingDistribution/leadsOverTime/freshVsFollowup` in `lib/leads/analytics.ts`, `revenueByStatus/ticketStatusSplit` in `lib/dashboard/metrics.ts`) are client-safe.
- **Templates:** filter `<select>`s + react-table setup in `components/leads/LeadsTable.tsx`; the full current dashboard in `app/(app)/dashboard/page.tsx` (its render body moves verbatim into the client board); an outside-click popover / chip toggles pattern in `components/payments/PaymentLinksBoard.tsx` (category pills) + `components/tickets/TicketQueue.tsx`.

---

## GROUP A — Geo core (TDD)

### Task 1: Area-code → state map + extraction

**Files:** Create `lib/geo/areaCodes.ts`, `tests/areaCodes.test.ts`.

- [ ] **Step 1: Failing tests** `tests/areaCodes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { areaCodeOf, stateOfPhone, AREA_CODE_STATE } from "@/lib/geo/areaCodes";

describe("areaCodeOf", () => {
  it("extracts from masked US phone", () => expect(areaCodeOf("(415) 555-0101")).toBe("415"));
  it("drops leading country code", () => expect(areaCodeOf("1 (415) 555-0101")).toBe("415"));
  it("plain 10 digits", () => expect(areaCodeOf("4155550101")).toBe("415"));
  it("null on short/empty/nullish", () => {
    expect(areaCodeOf("12345")).toBeNull();
    expect(areaCodeOf("")).toBeNull();
    expect(areaCodeOf(null)).toBeNull();
  });
});
describe("stateOfPhone", () => {
  it("maps known codes", () => {
    expect(stateOfPhone("(415) 555-0101")).toEqual({ state: "California", stateCode: "CA" });
    expect(stateOfPhone("(214) 555-0101")?.state).toBe("Texas");
    expect(stateOfPhone("(305) 555-0101")?.state).toBe("Florida");
  });
  it("null on unmapped/short", () => {
    expect(stateOfPhone("(000) 555-0101")).toBeNull();
    expect(stateOfPhone("123")).toBeNull();
  });
  it("covers the seeded lead codes", () => {
    for (const c of ["415","214","469","305","310","312","503","602","617","702","718","720","831","206","916"])
      expect(AREA_CODE_STATE[c]).toBeTruthy();
  });
});
```

Run `npx vitest run tests/areaCodes.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement `lib/geo/areaCodes.ts`** (transcribe the map EXACTLY):

```ts
const STATE_CODE: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO",
  Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY",
  Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH",
  "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
  Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA",
  Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};

const BY_STATE: Record<string, string[]> = {
  Alabama: ["205","251","256","334","659","938"],
  Alaska: ["907"],
  Arizona: ["480","520","602","623","928"],
  Arkansas: ["479","501","870"],
  California: ["209","213","279","310","323","341","350","408","415","424","442","510","530","559","562","619","626","628","650","657","661","669","707","714","747","760","805","818","820","831","840","858","909","916","925","949","951"],
  Colorado: ["303","719","720","970","983"],
  Connecticut: ["203","475","860","959"],
  Delaware: ["302"],
  "District of Columbia": ["202","771"],
  Florida: ["239","305","321","352","386","407","448","561","645","656","689","727","754","772","786","813","850","863","904","941","954"],
  Georgia: ["229","404","470","478","678","706","762","770","912","943"],
  Hawaii: ["808"],
  Idaho: ["208","986"],
  Illinois: ["217","224","309","312","331","447","464","618","630","708","730","773","779","815","847","872"],
  Indiana: ["219","260","317","463","574","765","812","930"],
  Iowa: ["319","515","563","641","712"],
  Kansas: ["316","620","785","913"],
  Kentucky: ["270","364","502","606","859"],
  Louisiana: ["225","318","337","504","985"],
  Maine: ["207"],
  Maryland: ["227","240","301","410","443","667"],
  Massachusetts: ["339","351","413","508","617","774","781","857","978"],
  Michigan: ["231","248","269","313","517","586","616","679","734","810","906","947","989"],
  Minnesota: ["218","320","507","612","651","763","924","952"],
  Mississippi: ["228","601","662","769"],
  Missouri: ["314","417","557","573","636","660","816","975"],
  Montana: ["406"],
  Nebraska: ["308","402","531"],
  Nevada: ["702","725","775"],
  "New Hampshire": ["603"],
  "New Jersey": ["201","551","609","640","732","848","856","862","908","973"],
  "New Mexico": ["505","575"],
  "New York": ["212","315","329","332","347","363","516","518","585","607","631","646","680","716","718","838","845","914","917","929","934"],
  "North Carolina": ["252","336","704","743","828","910","919","980","984"],
  "North Dakota": ["701"],
  Ohio: ["216","220","234","283","326","330","380","419","436","440","513","567","614","740","937"],
  Oklahoma: ["405","539","572","580","918"],
  Oregon: ["458","503","541","971"],
  Pennsylvania: ["215","223","267","272","412","445","484","570","582","610","717","724","814","835","878"],
  "Rhode Island": ["401"],
  "South Carolina": ["803","821","839","843","854","864"],
  "South Dakota": ["605"],
  Tennessee: ["423","615","629","731","865","901","931"],
  Texas: ["210","214","254","281","325","346","361","409","430","432","469","512","682","713","726","737","806","817","830","832","903","915","936","940","945","956","972","979"],
  Utah: ["385","435","801"],
  Vermont: ["802"],
  Virginia: ["276","434","540","571","686","703","757","804","826","948"],
  Washington: ["206","253","360","425","509","564"],
  "West Virginia": ["304","681"],
  Wisconsin: ["262","274","353","414","534","608","715","920"],
  Wyoming: ["307"],
};

export const AREA_CODE_STATE: Record<string, { state: string; stateCode: string }> = {};
for (const [state, codes] of Object.entries(BY_STATE)) {
  for (const code of codes) AREA_CODE_STATE[code] = { state, stateCode: STATE_CODE[state] };
}

export function areaCodeOf(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length >= 10 ? d.slice(0, 3) : null;
}

export function stateOfPhone(phone: string | null | undefined): { state: string; stateCode: string } | null {
  const ac = areaCodeOf(phone);
  return ac ? AREA_CODE_STATE[ac] ?? null : null;
}
```

- [ ] **Step 3: Run → PASS; commit**

```bash
npx vitest run tests/areaCodes.test.ts && npx tsc --noEmit
git -C "D:/sed-lms-v2" add lib/geo/areaCodes.ts tests/areaCodes.test.ts
git -C "D:/sed-lms-v2" commit -m "feat: US area-code→state map + phone area-code extraction (TDD)"
```

---

### Task 2: Region facets + filter helpers

**Files:** Create `lib/geo/regions.ts`, `tests/regions.test.ts`.

- [ ] **Step 1: Failing tests** `tests/regions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { leadRegion, buildRegionFacets, filterLeadsByRegions, UNKNOWN_REGION } from "@/lib/geo/regions";

const L = (business_phone: string | null) => ({ business_phone });

describe("leadRegion", () => {
  it("maps phone to state, else Unknown", () => {
    expect(leadRegion(L("(415) 555-0101"))).toBe("California");
    expect(leadRegion(L(null))).toBe(UNKNOWN_REGION);
    expect(leadRegion(L("(000) 000-0000"))).toBe(UNKNOWN_REGION);
  });
});
describe("buildRegionFacets", () => {
  const leads = [
    L("(415) 555-0001"), L("(415) 555-0002"), L("(310) 555-0003"), L("(916) 555-0004"), // CA x4, 415 most common
    L("(214) 555-0005"), // TX x1
    L(null), // Unknown x1
  ];
  it("groups by state with counts, main code, sorted codes", () => {
    const f = buildRegionFacets(leads);
    const ca = f.find((x) => x.region === "California")!;
    expect(ca.leadCount).toBe(4);
    expect(ca.mainAreaCode).toBe("415");
    expect(ca.areaCodes).toEqual(["310", "415", "916"]);
    expect(ca.stateCode).toBe("CA");
  });
  it("sorts by count desc, Unknown last", () => {
    const f = buildRegionFacets(leads);
    expect(f[0].region).toBe("California");
    expect(f[f.length - 1].region).toBe(UNKNOWN_REGION);
  });
  it("omits regions with no leads (auto)", () => {
    expect(buildRegionFacets([L("(214) 555-0001")]).map((x) => x.region)).toEqual(["Texas"]);
  });
});
describe("filterLeadsByRegions", () => {
  const leads = [L("(415) 555-0001"), L("(214) 555-0002"), L(null)];
  it("empty set → all", () => expect(filterLeadsByRegions(leads, new Set())).toHaveLength(3));
  it("filters to selected states", () => {
    expect(filterLeadsByRegions(leads, new Set(["California"]))).toHaveLength(1);
    expect(filterLeadsByRegions(leads, new Set(["California", "Texas"]))).toHaveLength(2);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `lib/geo/regions.ts`**

```ts
import { areaCodeOf, stateOfPhone } from "@/lib/geo/areaCodes";

export const UNKNOWN_REGION = "Unknown";

export interface HasPhone { business_phone: string | null }
export interface RegionFacet {
  region: string;
  stateCode: string | null;
  leadCount: number;
  mainAreaCode: string | null;
  areaCodes: string[];
}

export function leadRegion(lead: HasPhone): string {
  return stateOfPhone(lead.business_phone)?.state ?? UNKNOWN_REGION;
}

export function buildRegionFacets(leads: HasPhone[]): RegionFacet[] {
  const byRegion = new Map<string, { stateCode: string | null; count: number; codeCounts: Map<string, number> }>();
  for (const lead of leads) {
    const st = stateOfPhone(lead.business_phone);
    const region = st?.state ?? UNKNOWN_REGION;
    const ac = areaCodeOf(lead.business_phone);
    let entry = byRegion.get(region);
    if (!entry) { entry = { stateCode: st?.stateCode ?? null, count: 0, codeCounts: new Map() }; byRegion.set(region, entry); }
    entry.count++;
    if (ac) entry.codeCounts.set(ac, (entry.codeCounts.get(ac) ?? 0) + 1);
  }
  const facets: RegionFacet[] = [];
  for (const [region, e] of byRegion) {
    const codes = [...e.codeCounts.keys()].sort();
    // main = code on the most leads; ties → lowest code
    let mainAreaCode: string | null = null, best = -1;
    for (const code of codes) {
      const c = e.codeCounts.get(code)!;
      if (c > best) { best = c; mainAreaCode = code; }
    }
    facets.push({ region, stateCode: e.stateCode, leadCount: e.count, mainAreaCode, areaCodes: codes });
  }
  facets.sort((a, b) => {
    if (a.region === UNKNOWN_REGION) return 1;
    if (b.region === UNKNOWN_REGION) return -1;
    return b.leadCount - a.leadCount || a.region.localeCompare(b.region);
  });
  return facets;
}

export function filterLeadsByRegions<T extends HasPhone>(leads: T[], selected: Set<string>): T[] {
  if (selected.size === 0) return leads;
  return leads.filter((l) => selected.has(leadRegion(l)));
}
```

- [ ] **Step 3: Run → PASS; commit**

```bash
npx vitest run tests/regions.test.ts && npx tsc --noEmit
git -C "D:/sed-lms-v2" add lib/geo/regions.ts tests/regions.test.ts
git -C "D:/sed-lms-v2" commit -m "feat: region facets (state grouping, main area code, Unknown) + region filter (TDD)"
```

---

## GROUP B — UI

### Task 3: Leads list Region filter

**Files:** Create `components/leads/RegionFilter.tsx`; modify `components/leads/LeadsTable.tsx`.

- [ ] **Step 1: `components/leads/RegionFilter.tsx`** (client) — a compact multi-select popover:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import type { RegionFacet } from "@/lib/geo/regions";

export function RegionFilter({ facets, selected, onChange }: {
  facets: RegionFacet[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const toggle = (region: string) =>
    onChange(selected.includes(region) ? selected.filter((r) => r !== region) : [...selected, region]);
  const label = selected.length ? `Region · ${selected.length}` : "Region";
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={"px-3 py-2 rounded-md border text-sm outline-none focus:ring-2 focus:ring-accent " +
          (selected.length ? "border-accent bg-accent-soft text-accent-ink" : "border-border bg-surface text-text-muted")}>
        {label} ▾
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-64 max-h-72 overflow-auto bg-surface border border-border rounded-md shadow-lg p-1">
          {facets.length === 0 && <div className="px-3 py-2 text-xs text-text-faint">No regions</div>}
          {facets.map((f) => (
            <label key={f.region} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-2 cursor-pointer text-sm">
              <input type="checkbox" className="accent-accent" checked={selected.includes(f.region)} onChange={() => toggle(f.region)} />
              <span className="flex-1 text-text truncate">{f.region}</span>
              {f.mainAreaCode && <span className="text-xs font-mono text-text-faint">{f.mainAreaCode}</span>}
              <span className="text-xs text-text-muted">({f.leadCount})</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])}
              className="w-full text-left px-2 py-1.5 mt-1 text-xs text-dropped-fg hover:bg-surface-2 rounded">Clear</button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into `components/leads/LeadsTable.tsx`** — READ the file. Add imports `import { RegionFilter } from "@/components/leads/RegionFilter"; import { leadRegion, buildRegionFacets } from "@/lib/geo/regions";`. Add a hidden accessor column to the `columns` array (a column that isn't rendered — give it `header: () => null` / no cell, or add to a `columnVisibility` off-list; simplest: an accessor column with `enableHiding` and set initial `columnVisibility={{ region: false }}` on the table, OR just a column whose header/cell render nothing):

```ts
{
  id: "region",
  accessorFn: (l) => leadRegion(l),
  filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue(id) as string),
  header: () => null,
  cell: () => null,
  enableSorting: false,
}
```
Add state + control: `const [regionSel, setRegionSel] = useState<string[]>([]);` and `useEffect(() => { table.getColumn("region")?.setFilterValue(regionSel.length ? regionSel : undefined); }, [regionSel]);`. In the filter row (after the Type `<select>`), render `<RegionFilter facets={buildRegionFacets(leads)} selected={regionSel} onChange={setRegionSel} />` — use the same `leads`/`data` variable the table is built from (READ to confirm its name). Ensure the empty `region` column header/cell render nothing so the table layout is unchanged (if `header:()=>null` still creates a `<th>`, instead add `region` to an initial `state.columnVisibility={{ region:false }}` passed to `useReactTable` — pick whichever keeps the table visually identical; verify in the build/live pass).

- [ ] **Step 3: Build check + commit**

```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add components/leads/RegionFilter.tsx components/leads/LeadsTable.tsx
git -C "D:/sed-lms-v2" commit -m "feat: multi-select Region filter on the leads list (derived, hidden react-table column)"
```

---

### Task 4: Dashboard region scoping

**Files:** Create `components/dashboard/DashboardBoard.tsx`, `components/dashboard/RegionScopeBar.tsx`; modify `app/(app)/dashboard/page.tsx`.

- [ ] **Step 1: `components/dashboard/RegionScopeBar.tsx`** (client):

```tsx
"use client";
import type { RegionFacet } from "@/lib/geo/regions";

export function RegionScopeBar({ facets, selected, onChange }: {
  facets: RegionFacet[]; selected: string[]; onChange: (next: string[]) => void;
}) {
  if (!facets.length) return null;
  const toggle = (r: string) => onChange(selected.includes(r) ? selected.filter((x) => x !== r) : [...selected, r]);
  const chip = (active: boolean) =>
    "px-3 py-1 rounded-full text-xs border transition-colors " +
    (active ? "border-accent bg-accent-soft text-accent-ink font-medium" : "border-border text-text-muted hover:bg-surface-2");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => onChange([])} className={chip(selected.length === 0)}>All regions</button>
      {facets.map((f) => (
        <button key={f.region} type="button" onClick={() => toggle(f.region)} className={chip(selected.includes(f.region))}>
          {f.region}{f.mainAreaCode ? ` · ${f.mainAreaCode}` : ""} · {f.leadCount}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `components/dashboard/DashboardBoard.tsx`** (client) — move the CURRENT dashboard render body here. It receives everything and does the filtering + compute + render:
  - Props: `{ leads: Lead[]; followUps: { fu_status: string; lead_id: string | null }[]; tickets: { status: string; due_date: string | null; created_at: string; resolved_at: string | null; lead_id: string | null }[]; agentNameById: Record<string,string>; flags: DashboardVisibility; visible: string[]; facets: RegionFacet[] }`.
  - `const [sel, setSel] = useState<string[]>([]); const selSet = new Set(sel);`
  - `const regionByLead = useMemo(() => { const m = new Map<string,string>(); for (const l of leads) m.set(l.id, leadRegion(l)); return m; }, [leads]);`
  - `const fLeads = filterLeadsByRegions(leads, selSet);`
  - `const inSel = (lead_id: string | null) => selSet.size === 0 || selSet.has(regionByLead.get(lead_id ?? "") ?? "Unknown");`
  - `const fFollow = followUps.filter((f) => inSel(f.lead_id)); const fTickets = tickets.filter((t) => inSel(t.lead_id));`
  - Recompute exactly as the page did but from `fLeads`/`fFollow`/`fTickets`: `kpis = computeKpis(fLeads)`, `ext = computeExtendedKpis(fLeads, fFollow, fTickets, new Date())`, `fvf`, `siteData`, `freshTotal`, and all `by*`/`leadsOverTime`/`revenueByStatus`/`ticketStatusSplit` calls swapped to the filtered arrays.
  - Render: `<RegionScopeBar facets={facets} selected={sel} onChange={setSel} />` above the `<h1>Dashboard</h1>` header block, then the **verbatim existing markup** (header subtitle, `KpiHero`, `StatGrid`, `StatusStrip`, all `ChartCard`s incl. the `ChartCard` helper — copy that helper into this file) using the recomputed values + the `flags`/`visible` props. Keep every flag gate identical to the current page (lines ~99–198).
  - `"use client"` at top; import the chart components, metric fns, `ChartCard` inline, `STATUS_LEGEND`/`SITE_PALETTE`, `leadRegion`, `filterLeadsByRegions`, types.

- [ ] **Step 3: Slim `app/(app)/dashboard/page.tsx`** to the server shell:
  - Keep the leads/agents load; change follow-ups to `.select("fu_status, lead_id")` and tickets to `.select("status, due_date, created_at, resolved_at, lead_id")`.
  - Keep `perms`/`visible`/`flags` and the `!anyDashboardVisible(flags)` early-return empty state exactly as now.
  - Otherwise: `const facets = buildRegionFacets(leads);` then `return <DashboardBoard leads={leads} followUps={followUps ?? []} tickets={tickets ?? []} agentNameById={agentNameById} flags={flags} visible={visible} facets={facets} />;`
  - Remove the now-unused server-side metric computations + markup that moved to the board (and the imports only the board needs). Keep imports the shell still uses.

- [ ] **Step 4: Full build + commit**

```bash
cd "D:/sed-lms-v2" && npm run build
git -C "D:/sed-lms-v2" add "app/(app)/dashboard/page.tsx" components/dashboard/DashboardBoard.tsx components/dashboard/RegionScopeBar.tsx
git -C "D:/sed-lms-v2" commit -m "feat: region-scoped dashboard - client board recomputes KPIs/charts per selected region(s)"
```

---

## GROUP C — Verification

### Task 5 (controller): full gate + live pass
- [ ] `npx vitest run` (all green) + `npm run build` (green).
- [ ] Live (Chrome): `/leads` — Region dropdown lists California/Texas/etc with main code + counts; select California + Texas → table narrows to those; badge "Region · 2"; Clear resets; table layout unchanged (no stray Region column). `/dashboard` — region chips render (All regions active); click California → Total Leads + charts recompute to CA-only; multi-select adds Texas; All regions restores. Cross-check one filtered count against SQL.
- [ ] Merge to main + push; remind about hPanel redeploy.

---

## Self-review coverage map
- Area-code map + extraction → Task 1 · facets/filter helpers → Task 2 · leads filter → Task 3 · dashboard scoping (board + scope bar + shell) → Task 4 · verify → Task 5.
