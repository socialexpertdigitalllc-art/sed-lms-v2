import { describe, it, expect } from "vitest";
import { resolveLeadPages, PAGE_NAME_KINDS } from "@/lib/template-engine/leadPages";

const manifest = [
  { file: "index.html", kind: "home" },
  { file: "about.html", kind: "about" },
  { file: "services.html", kind: "services_hub" },
  { file: "service-areas.html", kind: "areas_hub" },
  { file: "gallery.html", kind: "gallery" },
  { file: "contact.html", kind: "contact" },
  { file: "service-kitchen.html", kind: "service_detail" },
  { file: "area-cherry-creek.html", kind: "area_detail" },
];

describe("resolveLeadPages", () => {
  it("maps the sales page names to template files by kind, home first", () => {
    const out = resolveLeadPages(["Home", "About Us", "Services", "Gallery", "Service Areas", "Contact Us"], manifest);
    expect(out).toEqual([
      "index.html", "about.html", "services.html", "gallery.html", "service-areas.html", "contact.html",
    ]);
  });
  it("is case- and spacing-insensitive and matches common synonyms", () => {
    expect(resolveLeadPages(["home", "our services", "portfolio", "locations", "about"], manifest)).toEqual([
      "index.html", "services.html", "gallery.html", "service-areas.html", "about.html",
    ]);
  });
  it("always includes the home page even when the lead did not list it", () => {
    expect(resolveLeadPages(["Services", "Contact Us"], manifest)).toEqual([
      "index.html", "services.html", "contact.html",
    ]);
  });
  it("never emits per-item detail pages (service_detail/area_detail are fanned out elsewhere)", () => {
    const out = resolveLeadPages(["Home", "Services", "Service Areas"], manifest);
    expect(out).not.toContain("service-kitchen.html");
    expect(out).not.toContain("area-cherry-creek.html");
  });
  it("skips a requested page whose kind the template lacks", () => {
    const noGallery = manifest.filter((p) => p.kind !== "gallery");
    expect(resolveLeadPages(["Home", "Gallery", "Contact Us"], noGallery)).toEqual([
      "index.html", "contact.html",
    ]);
  });
  it("falls back to all standard template pages when the lead specified none", () => {
    expect(resolveLeadPages([], manifest)).toEqual([
      "index.html", "about.html", "services.html", "service-areas.html", "gallery.html", "contact.html",
    ]);
  });
  it("dedupes when two names map to the same kind", () => {
    expect(resolveLeadPages(["Home", "Homepage", "Contact"], manifest)).toEqual([
      "index.html", "contact.html",
    ]);
  });
  it("exposes the name→kind table for reuse", () => {
    expect(PAGE_NAME_KINDS.home).toContain("home");
  });
});
