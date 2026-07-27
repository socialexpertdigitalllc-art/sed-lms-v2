import { describe, it, expect } from "vitest";
import { seedContentDoc, gallerySlotTargets } from "@/lib/site-studio/run/seed";
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
    expect(doc.identity).not.toHaveProperty("profile_embed");
  });

  it("carries profile_embed verbatim from the dossier when present (Phase 4c, Task 6)", () => {
    const { doc: withEmbed } = seedContentDoc(
      manifest, { ...dossier, profile_link: "https://g.page/acme", profile_embed: "https://g.page/acme" }, selectedPages,
    );
    expect(withEmbed.identity.profile_embed).toBe("https://g.page/acme");
    expect(withEmbed.identity.profile_link).toBe("https://g.page/acme");
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

describe("seedContentDoc — injected clock (determinism)", () => {
  it("stamps identity.year from an injected clock rather than the wall clock, so re-running prepare is genuinely idempotent", () => {
    const pinned = new Date("2019-03-15T00:00:00.000Z");
    const { doc } = seedContentDoc(manifest, dossier, selectedPages, pinned);
    expect(doc.identity.year).toBe("2019");
  });

  it("defaults to the current wall-clock year when no clock is injected", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    expect(doc.identity.year).toBe(String(new Date().getFullYear()));
  });
});

describe("seedContentDoc — an unknown selected page id", () => {
  it("is skipped and reported rather than thrown, and does not disturb the other pages", () => {
    const withBogus: SelectedPage[] = [...selectedPages, { page_id: "does-not-exist" }];
    expect(() => seedContentDoc(manifest, dossier, withBogus)).not.toThrow();

    const { doc, skipped } = seedContentDoc(manifest, dossier, withBogus);
    expect(skipped).toEqual(["does-not-exist"]);
    expect(doc.pages).toHaveLength(3);
    expect(doc.pages.map((p) => p.page_id)).toEqual(["index", "svc", "svc"]);
  });
});

describe("gallerySlotTargets — Task 2 (Phase 4c): where the lead's own photos are placed at prepare", () => {
  const galleryManifest = {
    engine: 3, name: "t", version: 1,
    identity: {},
    theme: { mode: "none", roles: {} },
    nav: [],
    pages: [
      {
        id: "index", file: "index.html", kind: "home", stampable: false,
        title_sample: "Home | Demo",
        slots: [
          { id: "index_s1", type: "text", sample: "Welcome", max_chars: 60, html: false },
          { id: "index_i1", type: "image", sample: "img/hero.jpg", html: false },
        ],
        repeats: [],
      },
      {
        id: "gallery", file: "gallery.html", kind: "gallery", stampable: false,
        title_sample: "Gallery | Demo",
        slots: [
          { id: "gal_i1", type: "image", sample: "img/gal1.jpg", html: false },
          { id: "gal_i2", type: "image", sample: "img/gal2.jpg", html: false, subject_hint: "finished patio" },
          { id: "gal_s1", type: "text", sample: "Our work", max_chars: 40, html: false },
        ],
        repeats: [],
      },
    ],
  } as unknown as TemplateManifest;

  const noGalleryManifest = {
    ...galleryManifest,
    pages: [galleryManifest.pages[0]],
  } as unknown as TemplateManifest;

  it("finds only IMAGE slots on pages whose manifest kind is 'gallery', in manifest slot order, ignoring text slots and other pages", () => {
    const galleryPages: SelectedPage[] = [{ page_id: "index" }, { page_id: "gallery" }];
    const { doc } = seedContentDoc(galleryManifest, dossier, galleryPages);

    const targets = gallerySlotTargets(galleryManifest, doc);

    expect(targets).toEqual([
      { page_index: 1, slot_id: "gal_i1" },
      { page_index: 1, slot_id: "gal_i2", subject_hint: "finished patio" },
    ]);
  });

  it("returns an empty list when the template has no gallery-kind page", () => {
    const { doc } = seedContentDoc(noGalleryManifest, dossier, [{ page_id: "index" }]);
    expect(gallerySlotTargets(noGalleryManifest, doc)).toEqual([]);
  });

  it("addresses a stamped duplicate gallery page by its DOC-PAGE INDEX, not its page_id, so two instances don't collide", () => {
    const stampedPages: SelectedPage[] = [
      { page_id: "gallery", output: "gallery/one.html" },
      { page_id: "gallery", output: "gallery/two.html" },
    ];
    const { doc } = seedContentDoc(galleryManifest, dossier, stampedPages);

    const targets = gallerySlotTargets(galleryManifest, doc);

    expect(targets).toEqual([
      { page_index: 0, slot_id: "gal_i1" },
      { page_index: 0, slot_id: "gal_i2", subject_hint: "finished patio" },
      { page_index: 1, slot_id: "gal_i1" },
      { page_index: 1, slot_id: "gal_i2", subject_hint: "finished patio" },
    ]);
  });
});
