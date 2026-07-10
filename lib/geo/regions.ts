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
