import { describe, it, expect } from "vitest";
import { deriveImageNeeds } from "@/lib/site-builder/imageNeeds";
import type { BusinessBrief } from "@/lib/site-builder/prompt";

const baseBrief: BusinessBrief = {
  business_name: "Ace Window Tinting",
  services: ["Window Tinting", "Ceramic Coating"],
  service_areas: ["Denver"],
};

describe("deriveImageNeeds", () => {
  it("derives one row per service, in order — no Hero row and no About row", () => {
    const { services } = deriveImageNeeds(baseBrief);
    expect(services.map((s) => s.service)).toEqual(["Window Tinting", "Ceramic Coating"]);
  });

  it("uses the bare service name as the query — nothing appended, no trade noun, no site_type", () => {
    const { services } = deriveImageNeeds(baseBrief);
    expect(services[0].query).toBe("Window Tinting");
    expect(services[1].query).toBe("Ceramic Coating");
  });

  it("site_type never influences a query, even when present", () => {
    // Historically a trade noun ("site_type" if set, else the first service)
    // was appended to every query. site_type is a sales/pipeline field
    // ("Custom Website", "Custom", "Redesign") and is no longer even a field
    // on BusinessBrief — but assert the actual behaviour: no query anywhere
    // contains a site_type-derived word.
    const { services } = deriveImageNeeds({ ...baseBrief, services: ["Drain Cleaning & Rooter Service"] });
    expect(services[0].query).toBe("Drain Cleaning & Rooter Service");
    for (const s of services) {
      expect(s.query.toLowerCase()).not.toContain("custom website");
      expect(s.query.toLowerCase()).not.toContain("custom");
      expect(s.query.toLowerCase()).not.toContain("redesign");
    }
  });

  it("never guesses a trade taxonomy — a service is used exactly as written", () => {
    const { services } = deriveImageNeeds({ ...baseBrief, services: ["Drain Cleaning & Rooter Service"] });
    expect(services[0].query).toBe("Drain Cleaning & Rooter Service");
  });

  it("caps service rows at 8 and reports the truncation", () => {
    const services = Array.from({ length: 11 }, (_, i) => `Service ${i + 1}`);
    const { services: rows, servicesTruncated, droppedServices } = deriveImageNeeds({ ...baseBrief, services });
    expect(rows).toHaveLength(8);
    expect(rows.map((r) => r.service)).toEqual([
      "Service 1",
      "Service 2",
      "Service 3",
      "Service 4",
      "Service 5",
      "Service 6",
      "Service 7",
      "Service 8",
    ]);
    expect(servicesTruncated).toBe(true);
    expect(droppedServices).toEqual(["Service 9", "Service 10", "Service 11"]);
  });

  it("does not truncate exactly 8 services", () => {
    const services = Array.from({ length: 8 }, (_, i) => `Service ${i + 1}`);
    const { servicesTruncated, droppedServices } = deriveImageNeeds({ ...baseBrief, services });
    expect(servicesTruncated).toBe(false);
    expect(droppedServices).toEqual([]);
  });

  it("produces an empty row list for a lead with no services — no crash", () => {
    const { services, servicesTruncated, droppedServices } = deriveImageNeeds({ ...baseBrief, services: [] });
    expect(services).toEqual([]);
    expect(servicesTruncated).toBe(false);
    expect(droppedServices).toEqual([]);
  });

  it("is deterministic — same input always produces the same output", () => {
    const a = deriveImageNeeds(baseBrief);
    const b = deriveImageNeeds(baseBrief);
    expect(a).toEqual(b);
  });

  it("ignores blank/whitespace-only service entries", () => {
    const { services } = deriveImageNeeds({ ...baseBrief, services: ["  ", "Window Tinting", ""] });
    expect(services.map((s) => s.service)).toEqual(["Window Tinting"]);
  });
});
