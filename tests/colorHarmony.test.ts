import { describe, it, expect } from "vitest";
import {
  hexToHsl,
  hslToHex,
  contrastRatio,
  harmonyOptions,
  bestComplement,
} from "@/lib/leads/colorHarmony";
import { MIN_COLORS, MAX_COLORS } from "@/lib/leads/colorScheme";
import { emptyNewLead, validateNewLead } from "@/lib/leads/newLeadForm";

/**
 * Agents were entering two or three colours that did not go together, because
 * picking a second colour is a design judgement nobody asked them to have.
 * The suggestion has to land INSTANTLY and always — the AI route improves the
 * wording, this is what guarantees there is an answer at all.
 */

describe("hsl round-trip", () => {
  it("survives a round trip for saturated colours", () => {
    for (const hex of ["#1a73e8", "#ff0000", "#00ff00", "#0000ff", "#800080"]) {
      const hsl = hexToHsl(hex)!;
      expect(hslToHex(hsl).toLowerCase()).toBe(hex.toLowerCase());
    }
  });

  it("handles pure black and white without NaN", () => {
    expect(hslToHex(hexToHsl("#000000")!)).toBe("#000000");
    expect(hslToHex(hexToHsl("#ffffff")!)).toBe("#ffffff");
  });

  it("returns null for something that is not a colour", () => {
    expect(hexToHsl("same as logo")).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a colour on itself", () => {
    expect(Math.round(contrastRatio("#000000", "#ffffff"))).toBe(21);
    expect(contrastRatio("#1a73e8", "#1a73e8")).toBeCloseTo(1, 5);
  });
});

describe("harmonyOptions", () => {
  it("puts the complement first, roughly opposite on the wheel", () => {
    const [first] = harmonyOptions("#1a73e8");
    expect(first.kind).toBe("complement");
    const base = hexToHsl("#1a73e8")!;
    const comp = hexToHsl(first.hex)!;
    const separation = (((comp.h - base.h) % 360) + 360) % 360;
    expect(Math.abs(separation - 180)).toBeLessThan(5);
  });

  it("never suggests the colour it was given", () => {
    for (const hex of ["#1a73e8", "#ff8800", "#228b22", "#808080", "#111111"]) {
      for (const o of harmonyOptions(hex)) {
        expect(o.hex.toLowerCase()).not.toBe(hex.toLowerCase());
      }
    }
  });

  it("keeps suggestions out of the near-black / near-white band", () => {
    // A partner that is nearly white or nearly black reads as a mistake next
    // to a brand colour, and cannot carry a button label either.
    for (const hex of ["#1a73e8", "#ff0000", "#003300", "#ffee88"]) {
      for (const o of harmonyOptions(hex)) {
        const l = hexToHsl(o.hex)!.l;
        expect(l).toBeGreaterThan(0.15);
        expect(l).toBeLessThan(0.85);
      }
    }
  });

  it("gives a grey base a real accent instead of more grey", () => {
    // Rotating the hue of a grey returns another grey; an agent offered
    // grey-plus-grey would rightly ignore the whole feature.
    const [first] = harmonyOptions("#808080");
    expect(first.kind).toBe("neutral");
    expect(hexToHsl(first.hex)!.s).toBeGreaterThan(0.3);
  });

  it("resolves a CSS colour NAME, not only hex", () => {
    expect(bestComplement("navy")).toBeTruthy();
  });

  it("returns nothing for input that is not a colour", () => {
    expect(harmonyOptions("up to you")).toEqual([]);
    expect(bestComplement("up to you")).toBeNull();
  });
});

describe("colour count gate on the lead form", () => {
  function form(color_scheme: string) {
    return {
      ...emptyNewLead("Ready"),
      business_name: "Acme",
      business_phone: "(252) 401-2775",
      business_email: "a@b.com",
      platform: "Google",
      business_profile_link: "https://x.test",
      has_service_areas: "No" as const,
      services: ["Roofing"],
      client_experience: "5",
      follow_up_time: new Date(Date.now() + 86_400_000).toISOString().slice(0, 16),
      price_quoted: "500",
      comments: "ok",
      rating: 7,
      fresh_or_followup: "Fresh",
      color_scheme,
    };
  }

  it("rejects a single colour", () => {
    expect(validateNewLead(form("#1a73e8")).color_scheme).toMatch(/at least 2/i);
  });

  it("accepts the minimum", () => {
    expect(validateNewLead(form("#1a73e8, #e8901a")).color_scheme).toBeUndefined();
  });

  it("accepts the maximum", () => {
    expect(validateNewLead(form("#1a73e8, #e8901a, #ffffff")).color_scheme).toBeUndefined();
  });

  it("rejects more than the maximum", () => {
    expect(validateNewLead(form("#111111, #222222, #333333, #444444")).color_scheme).toMatch(/at most 3/i);
  });

  it("still rejects an empty scheme with the required message", () => {
    expect(validateNewLead(form("")).color_scheme).toMatch(/required/i);
  });

  it("agrees with the shared constants", () => {
    expect(MIN_COLORS).toBe(2);
    expect(MAX_COLORS).toBe(3);
  });
});
