import { describe, it, expect } from "vitest";
import { seedContentDoc } from "@/lib/site-studio/run/seed";
import { contentDocSchema } from "@/lib/site-studio/schema";
import type { TemplateManifest } from "@/lib/site-studio/schema";
import type { Dossier } from "@/lib/site-studio/run/dossier";
import type { SelectedPage } from "@/lib/site-studio/run/pageSelect";

const manifest = {
  engine: 3, name: "t", version: 1,
  identity: { logo: "img/logo-sample.png" },
  theme: { mode: "css_vars", roles: { brand: { hex: "#111111" } } },
  nav: [],
  pages: [
    {
      id: "index", file: "index.html", kind: "home", stampable: false,
      title_sample: "Home | Demo",
      slots: [
        { id: "index_s1", type: "text", sample: "Welcome to Demo Co", max_chars: 60, html: false },
        { id: "index_i1", type: "image", sample: "img/hero.jpg", html: false },
      ],
      repeats: [],
    },
    {
      id: "svc", file: "service.html", kind: "service", stampable: true,
      title_sample: "Service | Demo",
      slots: [
        { id: "svc_s1", type: "text", sample: "Service description here", max_chars: 80, html: false },
        { id: "svc_i1", type: "image", sample: "img/service.jpg", html: false },
      ],
      repeats: [],
    },
  ],
} as unknown as TemplateManifest;

const dossier: Dossier = {
  lead_id: "l1",
  business_name: "Acme Plumbing",
  phone: "(303) 555-1234",
  phone_href: "tel:3035551234",
  no_email: true,
  services: [],
  service_areas: [],
  requested_pages: [],
  design_references: [],
  add_ons: [],
  client_photos: [],
  // email, logo, map_embed, profile_link deliberately absent
};

const selectedPages: SelectedPage[] = [
  { page_id: "index" },
  { page_id: "svc", output: "services/drain-cleaning.html", stamp_value: "Drain Cleaning", nav_title: "Drain Cleaning" },
  { page_id: "svc", output: "services/water-heaters.html", stamp_value: "Water Heaters", nav_title: "Water Heaters" },
];

describe("seedContentDoc", () => {
  const { doc, pending } = seedContentDoc(manifest, dossier, selectedPages);

  it("pages mirror selectedPages, including stamped duplicates with their own output/nav_title", () => {
    expect(doc.pages).toHaveLength(3);
    expect(doc.pages.map((p) => p.page_id)).toEqual(["index", "svc", "svc"]);
    expect(doc.pages[1].output).toBe("services/drain-cleaning.html");
    expect(doc.pages[1].nav_title).toBe("Drain Cleaning");
    expect(doc.pages[2].output).toBe("services/water-heaters.html");
    expect(doc.pages[2].nav_title).toBe("Water Heaters");
  });

  it("carries identity verbatim from the dossier, omitting keys it lacks, and stamps the current year", () => {
    expect(doc.identity.business_name).toBe("Acme Plumbing");
    expect(doc.identity.phone).toBe("(303) 555-1234");
    expect(doc.identity.phone_href).toBe("tel:3035551234");
    expect(doc.identity.year).toBe(String(new Date().getFullYear()));
    expect(doc.identity).not.toHaveProperty("email");
    expect(doc.identity).not.toHaveProperty("logo");
    expect(doc.identity).not.toHaveProperty("map_embed");
    expect(doc.identity).not.toHaveProperty("profile_link");
  });

  it("defaults every image slot to the template's own sample", () => {
    expect(doc.pages[0].slots.index_i1).toBe("img/hero.jpg");
    expect(doc.pages[1].slots.svc_i1).toBe("img/service.jpg");
    expect(doc.pages[2].slots.svc_i1).toBe("img/service.jpg");
  });

  it("leaves every text slot and title empty, and lists text slots as pending for the Writer", () => {
    expect(doc.pages[0].slots.index_s1).toBe("");
    expect(doc.pages[0].title).toBe("");
    expect(doc.pages[1].slots.svc_s1).toBe("");
    expect(doc.pages[1].title).toBe("");

    expect(pending).toContainEqual({ page_id: "index", slot_id: "index_s1" });
    expect(pending).toContainEqual({ page_id: "svc", slot_id: "svc_s1" });
    // one pending entry per doc-page instance, so the stamped duplicate appears twice
    expect(pending.filter((p) => p.page_id === "svc" && p.slot_id === "svc_s1")).toHaveLength(2);
    // image slots never appear in pending
    expect(pending.some((p) => p.slot_id === "index_i1" || p.slot_id === "svc_i1")).toBe(false);
  });

  it("contentDocSchema.parse SUCCEEDS on the raw seed (record-typed identity/slots impose no min-length or key-presence constraints, only token-freedom)", () => {
    expect(() => contentDocSchema.parse(doc)).not.toThrow();
  });
});
