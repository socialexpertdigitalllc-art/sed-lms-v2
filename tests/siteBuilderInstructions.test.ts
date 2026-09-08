// tests/siteBuilderInstructions.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildPagePrompt, buildComponentsPrompt, type BusinessBrief } from "@/lib/site-builder/prompt";

const brief: BusinessBrief = {
  business_name: "Acme Roofing",
  services: ["Roof repair"],
  service_areas: ["Dallas"],
  instructions: "Make the site bilingual English/Spanish with a header toggle.",
};

describe("operator instructions reach the generation prompts", () => {
  it("page prompt carries the instructions block", () => {
    const p = buildPagePrompt({ brief, images: [], pageFile: "index.html", pageHtml: "<html></html>", siteFiles: ["index.html"] });
    expect(p).toContain("ADDITIONAL INSTRUCTIONS FROM THE OPERATOR");
    expect(p).toContain("bilingual English/Spanish");
  });

  it("components prompt carries them too, and omits the block without instructions", () => {
    const c = buildComponentsPrompt({ brief, images: [], source: "// js", file: "components.js", siteFiles: ["index.html"] });
    expect(c).toContain("bilingual English/Spanish");
    const bare = buildPagePrompt({
      brief: { ...brief, instructions: undefined },
      images: [], pageFile: "index.html", pageHtml: "<html></html>", siteFiles: ["index.html"],
    });
    expect(bare).not.toContain("ADDITIONAL INSTRUCTIONS");
  });
});
