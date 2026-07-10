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
    L("(415) 555-0001"), L("(415) 555-0002"), L("(310) 555-0003"), L("(916) 555-0004"),
    L("(214) 555-0005"),
    L(null),
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
