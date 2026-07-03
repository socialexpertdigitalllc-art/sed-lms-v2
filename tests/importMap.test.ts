import { describe, it, expect } from "vitest";
import { columnLetterToIndex, DEFAULT_MAPPING } from "@/lib/import/columns";
import { mapRow } from "@/lib/import/map";

describe("columnLetterToIndex", () => {
  it("maps single and double letters", () => {
    expect(columnLetterToIndex("A")).toBe(0);
    expect(columnLetterToIndex("Z")).toBe(25);
    expect(columnLetterToIndex("AA")).toBe(26);
    expect(columnLetterToIndex("AB")).toBe(27);
  });
});

describe("mapRow", () => {
  function rowFrom(byLetter: Record<string, string>): string[] {
    const max = Math.max(...Object.keys(byLetter).map(columnLetterToIndex));
    const arr = Array(max + 1).fill("");
    for (const [L, v] of Object.entries(byLetter)) arr[columnLetterToIndex(L)] = v;
    return arr;
  }
  it("maps and coerces fields, returning agentName separately", () => {
    const row = rowFrom({ B: "Ready", F: "Acme Roofing", G: "555", D: "Alex", K: "Roofing, Gutters", N: "5", Y: "8", L: "Yes" });
    const r = mapRow(row, DEFAULT_MAPPING)!;
    expect(r.lead.business_name).toBe("Acme Roofing");
    expect(r.lead.status).toBe("Ready");
    expect(r.lead.services).toEqual(["Roofing", "Gutters"]);
    expect(r.lead.num_webpages).toBe(5);
    expect(r.lead.rating).toBe(8);
    expect(r.lead.has_service_areas).toBe(true);
    expect(r.agentName).toBe("Alex");
  });
  it("defaults an unknown status to Not Ready", () => {
    const r = mapRow(rowFrom({ F: "Biz", B: "Weird" }), DEFAULT_MAPPING)!;
    expect(r.lead.status).toBe("Not Ready");
  });
  it("returns null when business_name is empty (invalid row)", () => {
    expect(mapRow(rowFrom({ B: "Ready" }), DEFAULT_MAPPING)).toBeNull();
  });
  it("ignores columns mapped to (ignore)", () => {
    const r = mapRow(rowFrom({ F: "Biz", X: "secret note" }), { ...DEFAULT_MAPPING, X: "(ignore)" })!;
    expect(r.lead.comments).toBeUndefined();
  });
  it("parses DD/MM/YYYY dates that new Date() would reject", () => {
    const r = mapRow(rowFrom({ F: "Biz", T: "30/06/2026" }), DEFAULT_MAPPING)!;
    expect(r.lead.follow_up_time).toBe(new Date("2026-06-30").toISOString());
  });
  it("nulls an unparseable date", () => {
    const r = mapRow(rowFrom({ F: "Biz", T: "not a date" }), DEFAULT_MAPPING)!;
    expect(r.lead.follow_up_time).toBeUndefined();
  });
});
