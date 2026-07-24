import { describe, it, expect } from "vitest";
import { inventory } from "@/lib/site-studio/compiler/inventory";
import { extractIdentity } from "@/lib/site-studio/compiler/identity";
import { fixtureFiles } from "./helpers/siteStudioFixtures";

describe("extractIdentity (plumberpro)", () => {
  const inv = inventory(fixtureFiles("plumberpro"));
  const { identity, diagnostics } = extractIdentity(inv);
  const all = inv.pages.map((p) => p.root.toString()).join("\n");

  it("captures the sample values", () => {
    expect(identity.business_name).toBe("PlumberPro");
    expect(identity.phone).toBe("(512) 555-0147");
    expect(identity.email).toBe("help@plumberpro.com");
    expect(identity.map_embed).toContain("google.com/maps");
  });
  it("no raw identity remains in any page", () => {
    expect(all).not.toContain("PlumberPro");
    expect(all).not.toContain("(512) 555-0147");
    expect(all).not.toContain("help@plumberpro.com");
    expect(all).not.toContain("google.com/maps");
  });
  it("tokenized instead", () => {
    expect(all).toContain("{{id:business_name}}");
    expect(all).toContain("{{id:phone}}");
    expect(all).toContain("{{id:email}}");
    expect(all).toContain("{{id:map_embed}}");
  });
  it("warns that name detection is heuristic", () => {
    expect(diagnostics.some((d) => d.code === "identity_name_heuristic" && d.level === "warn")).toBe(true);
  });
});

describe("extractIdentity (bakery)", () => {
  const inv = inventory(fixtureFiles("bakery"));
  const { identity } = extractIdentity(inv);
  it("captures year from the copyright line", () => {
    expect(identity.year).toBe("2024");
    expect(inv.pages[0].root.toString()).toContain("{{id:year}}");
  });
  it("does not match the phone inside longer digit runs", () => {
    expect(identity.phone).toBe("(503) 555-0022");
  });
});
