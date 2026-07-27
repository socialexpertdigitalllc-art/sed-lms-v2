import { describe, it, expect } from "vitest";
import { deriveImageNeeds } from "@/lib/site-builder/imageNeeds";
import type { BusinessBrief } from "@/lib/site-builder/prompt";

const baseBrief: BusinessBrief = {
  business_name: "Ace Window Tinting",
  services: ["Window Tinting", "Ceramic Coating"],
  service_areas: ["Denver"],
};

describe("deriveImageNeeds", () => {
  it("derives Hero, one per service, and About, in that order", () => {
    const { needs } = deriveImageNeeds(baseBrief);
    expect(needs.map((n) => n.purpose)).toEqual([
      "Hero",
      "Service: Window Tinting",
      "Service: Ceramic Coating",
      "About",
    ]);
  });

  it("uses site_type as the trade noun when present, verbatim and lowercased", () => {
    const { needs } = deriveImageNeeds({ ...baseBrief, site_type: "Auto Detailing" });
    expect(needs[0].query).toBe("auto detailing");
    expect(needs.find((n) => n.purpose === "About")?.query).toBe("team auto detailing");
  });

  it("falls back to the first service phrase, verbatim and lowercased, when site_type is absent", () => {
    const { needs } = deriveImageNeeds(baseBrief);
    expect(needs[0].query).toBe("window tinting");
  });

  it("never guesses a trade taxonomy — a service is used exactly as written, only lowercased", () => {
    const { needs } = deriveImageNeeds({ ...baseBrief, services: ["Drain Cleaning & Rooter Service"] });
    expect(needs[0].query).toBe("drain cleaning & rooter service");
  });

  it("builds each service's query from the service plus the trade noun, without duplicating identical words", () => {
    const { needs } = deriveImageNeeds(baseBrief);
    const svc = needs.find((n) => n.purpose === "Service: Window Tinting");
    // trade noun (from site_type absent -> first service) is "window tinting"
    // itself here, so the query must not repeat it.
    expect(svc?.query).toBe("window tinting");

    const svc2 = needs.find((n) => n.purpose === "Service: Ceramic Coating");
    expect(svc2?.query).toBe("ceramic coating window tinting");
  });

  it("caps service needs at 8 and reports the truncation", () => {
    const services = Array.from({ length: 11 }, (_, i) => `Service ${i + 1}`);
    const { needs, servicesTruncated, droppedServices } = deriveImageNeeds({ ...baseBrief, services });
    const serviceNeeds = needs.filter((n) => n.purpose.startsWith("Service: "));
    expect(serviceNeeds).toHaveLength(8);
    expect(serviceNeeds.map((n) => n.purpose)).toEqual([
      "Service: Service 1",
      "Service: Service 2",
      "Service: Service 3",
      "Service: Service 4",
      "Service: Service 5",
      "Service: Service 6",
      "Service: Service 7",
      "Service: Service 8",
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

  it("still produces Hero and About for a lead with no services, with an empty needs array reduced to just those two", () => {
    const { needs, servicesTruncated } = deriveImageNeeds({ ...baseBrief, services: [] });
    expect(needs.map((n) => n.purpose)).toEqual(["Hero", "About"]);
    expect(needs[0].query).toBe(""); // no site_type, no services -> no trade noun at all
    expect(needs[1].query).toBe("team");
    expect(servicesTruncated).toBe(false);
  });

  it("is deterministic — same input always produces the same output", () => {
    const a = deriveImageNeeds(baseBrief);
    const b = deriveImageNeeds(baseBrief);
    expect(a).toEqual(b);
  });

  it("ignores blank/whitespace-only service entries", () => {
    const { needs } = deriveImageNeeds({ ...baseBrief, services: ["  ", "Window Tinting", ""] });
    expect(needs.map((n) => n.purpose)).toEqual(["Hero", "Service: Window Tinting", "About"]);
  });
});
