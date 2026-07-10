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
