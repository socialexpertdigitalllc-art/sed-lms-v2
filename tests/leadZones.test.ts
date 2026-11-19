// @vitest-environment node
import { describe, it, expect } from "vitest";
import { leadTimezoneGroup } from "@/lib/geo/regions";
import { LEAD_ZONES, zoneLabel } from "@/lib/geo/timezones";

/** The Timezone filter's grouping: a lead's region → its US timezone. */
const zone = (business_phone: string | null, custom_area: string | null = null) => leadTimezoneGroup({ business_phone, custom_area });

describe("lead timezone groups", () => {
  it("follows the phone's state", () => {
    expect(zone("(212) 555-0100")).toBe("eastern"); // New York
    expect(zone("(512) 555-0100")).toBe("central"); // Austin, TX
    expect(zone("(303) 555-0100")).toBe("mountain"); // Denver
    expect(zone("(602) 555-0100")).toBe("arizona"); // Phoenix
    expect(zone("(503) 555-0100")).toBe("pacific"); // Portland
    expect(zone("(907) 555-0100")).toBe("alaska");
    expect(zone("(808) 555-0100")).toBe("hawaii");
  });

  it("corrects area codes in split states", () => {
    expect(zone("(915) 555-0100")).toBe("mountain"); // El Paso, TX
    expect(zone("(850) 555-0100")).toBe("central"); // Florida panhandle
    expect(zone("(865) 555-0100")).toBe("eastern"); // Knoxville, TN
    expect(zone("(615) 555-0100")).toBe("central"); // Nashville, TN
    expect(zone("(270) 555-0100")).toBe("central"); // western Kentucky
  });

  it("the manual region override wins", () => {
    expect(zone("(212) 555-0100", "California")).toBe("pacific");
    expect(zone("(915) 555-0100", "Texas")).toBe("central");
  });

  it("no usable region is Unknown", () => {
    expect(zone(null)).toBe("unknown");
    expect(zone("555-0100")).toBe("unknown");
    expect(zoneLabel("unknown")).toBe("Unknown");
  });

  it("offers the US zones in order, west of Eastern", () => {
    expect(LEAD_ZONES.map((z) => z.key)).toEqual(["eastern", "central", "mountain", "arizona", "pacific", "alaska", "hawaii"]);
  });
});
