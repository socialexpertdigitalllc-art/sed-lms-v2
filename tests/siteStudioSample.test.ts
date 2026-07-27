import { describe, it, expect } from "vitest";
import { compileTemplate } from "@/lib/site-studio/compiler/compile";
import { sampleContentDoc } from "@/lib/site-studio/sample";
import { contentDocSchema } from "@/lib/site-studio/schema";
import { fixtureZip } from "./helpers/siteStudioFixtures";

describe("sampleContentDoc", () => {
  const { template } = compileTemplate(fixtureZip("plumberpro"), "plumberpro");
  const doc = sampleContentDoc(template.manifest);

  it("is schema-valid and mirrors the manifest", () => {
    expect(() => contentDocSchema.parse(doc)).not.toThrow();
    expect(doc.identity.business_name).toBe("PlumberPro");
    expect(doc.pages.map((p) => p.page_id).sort()).toEqual(
      template.manifest.pages.map((p) => p.id).sort(),
    );
  });
  it("fills every slot and repeat from samples, theme empty (keep original colors)", () => {
    const index = doc.pages.find((p) => p.page_id === "index")!;
    const def = template.manifest.pages.find((p) => p.id === "index")!;
    expect(Object.keys(index.slots).sort()).toEqual(def.slots.map((s) => s.id).sort());
    expect(index.repeats[def.repeats[0].id]).toHaveLength(def.repeats[0].samples.length);
    expect(doc.theme).toEqual({});
    expect(index.title).toBe(def.title_sample);
  });
});
