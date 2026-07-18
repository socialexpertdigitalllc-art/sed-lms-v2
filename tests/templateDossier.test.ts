import { describe, it, expect } from "vitest";
import { dossierFields, dossierCompleteness, type DossierInput } from "@/lib/template-engine/dossier";

const empty: DossierInput = {
  logo_link: null,
  map_embed_link: null,
  color_scheme: null,
  color_same_as_logo: null,
  services: null,
  service_areas: null,
  business_phone: null,
  business_email: null,
  no_email: null,
  image_links: null,
};
const present = (lead: DossierInput, key: string) =>
  dossierFields(lead).find((f) => f.key === key)!.present;

describe("dossierFields", () => {
  it("reports every key field missing for an empty lead", () => {
    const { filled, total } = dossierCompleteness(empty);
    expect(total).toBe(8);
    expect(filled).toBe(0);
  });

  it("treats 'match the logo' as a present colour choice", () => {
    expect(present({ ...empty, color_same_as_logo: true }, "colors")).toBe(true);
    expect(present({ ...empty, color_scheme: "navy + gold" }, "colors")).toBe(true);
    expect(present(empty, "colors")).toBe(false);
  });

  it("treats an explicit no_email decision as a resolved email field", () => {
    expect(present({ ...empty, no_email: true }, "email")).toBe(true);
    expect(present({ ...empty, business_email: "a@b.com" }, "email")).toBe(true);
    expect(present(empty, "email")).toBe(false);
  });

  it("ignores blank strings and empty/blank-only lists", () => {
    expect(present({ ...empty, logo_link: "   " }, "logo")).toBe(false);
    expect(present({ ...empty, services: [] }, "services")).toBe(false);
    expect(present({ ...empty, services: ["", "  "] }, "services")).toBe(false);
    expect(present({ ...empty, services: ["Plumbing"] }, "services")).toBe(true);
  });

  it("tallies filled fields", () => {
    const lead: DossierInput = {
      ...empty,
      logo_link: "https://x/logo.png",
      business_phone: "555",
      services: ["a"],
      no_email: true,
    };
    expect(dossierCompleteness(lead).filled).toBe(4);
  });
});
