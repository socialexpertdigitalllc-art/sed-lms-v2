import { describe, it, expect } from "vitest";
import {
  manifestSchema, contentDocSchema, pageKindFromFilename, PAGE_KINDS,
} from "@/lib/site-studio/schema";

const slot = { id: "index_s1", type: "text", sample: "Hello", max_chars: 60, html: false };

const manifest = {
  engine: 3, name: "plumberpro", version: 1,
  identity: { business_name: "PlumberPro", phone: "(512) 555-0147" },
  theme: { mode: "css_vars", roles: { brand: { var: "--primary", hex: "#0a5adf" } } },
  nav: [{ id: "nav_header", fragment: "nav_header", location: "header" }],
  pages: [{
    id: "index", file: "index.html", kind: "home", stampable: false,
    title_sample: "PlumberPro | Trusted Plumbing in Austin",
    slots: [slot],
    repeats: [{
      id: "index_r1", fragment: "index_r1", min: 1, max: 12,
      slots: [{ id: "index_r1_s1", type: "text", sample: "Drain Cleaning", max_chars: 40, html: false }],
      samples: [{ index_r1_s1: "Drain Cleaning" }],
    }],
  }],
};

describe("manifestSchema", () => {
  it("accepts a valid manifest", () => {
    expect(manifestSchema.parse(manifest).pages[0].id).toBe("index");
  });
  it("rejects an unknown page kind", () => {
    const bad = { ...manifest, pages: [{ ...manifest.pages[0], kind: "landing" }] };
    expect(manifestSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a manifest with zero pages", () => {
    expect(manifestSchema.safeParse({ ...manifest, pages: [] }).success).toBe(false);
  });
});

describe("contentDocSchema", () => {
  const doc = {
    identity: { business_name: "Acme Plumbing", phone: "(303) 555-1234" },
    theme: {},
    pages: [{
      page_id: "index", title: "Acme Plumbing | Denver",
      slots: { index_s1: "Welcome to Acme" },
      repeats: { index_r1: [{ index_r1_s1: "Sewer Repair" }] },
    }],
  };
  it("accepts a valid doc", () => {
    expect(contentDocSchema.parse(doc).pages[0].page_id).toBe("index");
  });
  it("allows identity tokens but rejects structural token syntax in values", () => {
    const idOk = { ...doc, pages: [{ ...doc.pages[0], slots: { index_s1: "Call {{id:phone}} now" } }] };
    expect(contentDocSchema.safeParse(idOk).success).toBe(true);
    const bad = { ...doc, pages: [{ ...doc.pages[0], slots: { index_s1: "Hi {{slot:other}}" } }] };
    expect(contentDocSchema.safeParse(bad).success).toBe(false);
  });
});

describe("pageKindFromFilename", () => {
  it("maps common filenames", () => {
    expect(pageKindFromFilename("index.html")).toBe("home");
    expect(pageKindFromFilename("about-us.html")).toBe("about");
    expect(pageKindFromFilename("services.html")).toBe("services_hub");
    expect(pageKindFromFilename("contact.html")).toBe("contact");
    expect(pageKindFromFilename("menu.html")).toBe("generic");
  });
  it("PAGE_KINDS matches the spec set", () => {
    expect(PAGE_KINDS).toContain("service");
    expect(PAGE_KINDS).toContain("area");
  });
});
