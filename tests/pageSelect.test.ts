import { describe, it, expect } from "vitest";
import { selectContentFiles, type ManifestPage } from "@/lib/template-engine/pageSelect";

const manifestPages: ManifestPage[] = [
  { file: "index.html", kind: "home" },
  { file: "about.html", kind: "about" },
  { file: "area-cherry-creek.html", kind: "area_detail" },
];
const contentFiles = ["index.html", "about.html", "area-cherry-creek.html", "script.js", "components.js"];

describe("selectContentFiles", () => {
  it("always builds shared content JS even when it is not (and cannot be) requested", () => {
    const sel = selectContentFiles({
      contentFiles,
      manifestPages,
      requestedPages: ["index.html"], // script.js / components.js are never manifest pages
      hasServiceAreas: false,
    });
    expect(sel.build).toContain("script.js");
    expect(sel.build).toContain("components.js");
    expect(sel.dropped.some((d) => d.file === "script.js")).toBe(false);
    expect(sel.dropped.some((d) => d.file === "components.js")).toBe(false);
  });

  it("builds a manifest page that was requested", () => {
    const sel = selectContentFiles({
      contentFiles,
      manifestPages,
      requestedPages: ["index.html", "about.html"],
      hasServiceAreas: false,
    });
    expect(sel.build).toContain("about.html");
    expect(sel.dropped.some((d) => d.file === "about.html")).toBe(false);
  });

  it("drops a manifest page that was NOT requested, reason mentions 'not requested'", () => {
    const sel = selectContentFiles({
      contentFiles,
      manifestPages,
      requestedPages: ["index.html"], // about.html deliberately omitted
      hasServiceAreas: true, // isolate this case from the service-areas rule
    });
    const drop = sel.dropped.find((d) => d.file === "about.html");
    expect(drop).toBeTruthy();
    expect(drop!.reason).toMatch(/not requested/i);
    expect(sel.build).not.toContain("about.html");
  });

  it("drops a requested area_detail page when the client has no service areas", () => {
    const sel = selectContentFiles({
      contentFiles,
      manifestPages,
      requestedPages: ["index.html", "area-cherry-creek.html"],
      hasServiceAreas: false,
    });
    const drop = sel.dropped.find((d) => d.file === "area-cherry-creek.html");
    expect(drop).toBeTruthy();
    expect(drop!.reason).toMatch(/no service areas/i);
    expect(sel.build).not.toContain("area-cherry-creek.html");
  });

  it("builds the same requested area_detail page when the client HAS service areas", () => {
    const sel = selectContentFiles({
      contentFiles,
      manifestPages,
      requestedPages: ["index.html", "area-cherry-creek.html"],
      hasServiceAreas: true,
    });
    expect(sel.build).toContain("area-cherry-creek.html");
    expect(sel.dropped.some((d) => d.file === "area-cherry-creek.html")).toBe(false);
  });

  it("also drops an areas_hub page when the client has no service areas", () => {
    const hubPages: ManifestPage[] = [...manifestPages, { file: "areas.html", kind: "areas_hub" }];
    const files = [...contentFiles, "areas.html"];
    const sel = selectContentFiles({
      contentFiles: files,
      manifestPages: hubPages,
      requestedPages: ["index.html", "areas.html"],
      hasServiceAreas: false,
    });
    const drop = sel.dropped.find((d) => d.file === "areas.html");
    expect(drop).toBeTruthy();
    expect(drop!.reason).toMatch(/no service areas/i);
  });

  it("places every input content file in exactly one of build/dropped", () => {
    const sel = selectContentFiles({
      contentFiles,
      manifestPages,
      requestedPages: ["index.html"],
      hasServiceAreas: false,
    });
    const all = [...sel.build, ...sel.dropped.map((d) => d.file)].sort();
    expect(all).toEqual([...contentFiles].sort());
    const buildSet = new Set(sel.build);
    const droppedSet = new Set(sel.dropped.map((d) => d.file));
    for (const f of contentFiles) {
      expect(buildSet.has(f) !== droppedSet.has(f)).toBe(true); // XOR: in exactly one
    }
  });
});
