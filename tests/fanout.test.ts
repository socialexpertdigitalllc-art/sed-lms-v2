import { describe, it, expect } from "vitest";
import { planFanout, type FanoutInput } from "@/lib/template-engine/fanout";

const manifest = [
  { file: "index.html", kind: "home" },
  { file: "services.html", kind: "services_hub" },
  { file: "service-areas.html", kind: "areas_hub" },
  { file: "service-kitchen.html", kind: "service_detail" },
  { file: "area-cherry-creek.html", kind: "area_detail" },
  { file: "contact.html", kind: "contact" },
];

const base: FanoutInput = {
  services: [
    { key: "kitchen-remodeling", name: "Kitchen Remodeling" },
    { key: "roofing", name: "Roofing" },
  ],
  areas: ["Dallas", "Fort Worth"],
  manifestPages: manifest,
  buildFiles: ["index.html", "services.html", "service-areas.html", "contact.html"],
};

describe("planFanout", () => {
  it("makes one service page per service from the service_detail sample, slugged", () => {
    const { pages } = planFanout(base);
    const svc = pages.filter((p) => p.kind === "service_detail");
    expect(svc).toEqual([
      { file: "service-kitchen-remodeling.html", sampleFile: "service-kitchen.html", kind: "service_detail", focus: "Kitchen Remodeling", focusKey: "kitchen-remodeling" },
      { file: "service-roofing.html", sampleFile: "service-kitchen.html", kind: "service_detail", focus: "Roofing", focusKey: "roofing" },
    ]);
  });

  it("makes one area page per area from the area_detail sample", () => {
    const { pages } = planFanout(base);
    const areas = pages.filter((p) => p.kind === "area_detail");
    expect(areas.map((p) => p.file)).toEqual(["area-dallas.html", "area-fort-worth.html"]);
    expect(areas[0]).toMatchObject({ sampleFile: "area-cherry-creek.html", focus: "Dallas" });
  });

  it("only fans out service pages when the services hub is being built", () => {
    const out = planFanout({ ...base, buildFiles: ["index.html", "contact.html"] });
    expect(out.pages).toEqual([]);
  });

  it("only fans out area pages when the areas hub is built AND the lead has areas", () => {
    const noAreas = planFanout({ ...base, areas: [] });
    expect(noAreas.pages.some((p) => p.kind === "area_detail")).toBe(false);
    expect(noAreas.pages.some((p) => p.kind === "service_detail")).toBe(true);
  });

  it("skips a kind entirely when the template has no sample for it", () => {
    const noAreaSample = manifest.filter((p) => p.kind !== "area_detail");
    const out = planFanout({ ...base, manifestPages: noAreaSample });
    expect(out.pages.some((p) => p.kind === "area_detail")).toBe(false);
    expect(out.pages.some((p) => p.kind === "service_detail")).toBe(true);
  });

  it("dedupes filenames when two names slug to the same file", () => {
    const out = planFanout({
      ...base,
      services: [
        { key: "a", name: "Roof Repair" },
        { key: "b", name: "Roof  Repair" },
        { key: "c", name: "Roof-Repair" },
      ],
    });
    const files = out.pages.filter((p) => p.kind === "service_detail").map((p) => p.file);
    expect(files).toEqual(["service-roof-repair.html", "service-roof-repair-2.html", "service-roof-repair-3.html"]);
  });

  it("reports which hubs were expanded (for the hub-card multiplication step)", () => {
    const out = planFanout(base);
    expect(out.serviceHub).toBe("services.html");
    expect(out.areaHub).toBe("service-areas.html");
    expect(out.sampleServiceFile).toBe("service-kitchen.html");
    expect(out.sampleAreaFile).toBe("area-cherry-creek.html");
  });

  it("drops the sample detail files from the build (they are replaced by the fanned pages)", () => {
    const out = planFanout(base);
    expect(out.replacedSamples).toEqual(expect.arrayContaining(["service-kitchen.html", "area-cherry-creek.html"]));
  });
});
