import { describe, it, expect } from "vitest";
import { seedContentDoc } from "@/lib/site-studio/run/seed";
import { applyWritten, applyOperatorEdit, findDisallowedEditField } from "@/lib/site-studio/run/applyWritten";
import { contentDocSchema } from "@/lib/site-studio/schema";
import type { TemplateManifest } from "@/lib/site-studio/schema";
import type { Dossier } from "@/lib/site-studio/run/dossier";
import type { SelectedPage } from "@/lib/site-studio/run/pageSelect";
import type { WriteResult } from "@/lib/site-studio/run/writer";

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
      repeats: [{
        id: "index_r1", fragment: "index_r1", min: 1, max: 12,
        slots: [{ id: "index_r1_s1", type: "text", sample: "Sample Card", max_chars: 40, html: false }],
        samples: [{ index_r1_s1: "Sample A" }, { index_r1_s1: "Sample B" }],
      }],
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
  lead_id: "l1", business_name: "Acme Plumbing", phone: "(303) 555-1234", phone_href: "tel:3035551234",
  no_email: true, services: [], service_areas: [], requested_pages: [], design_references: [],
  add_ons: [], client_photos: [],
};

const selectedPages: SelectedPage[] = [
  { page_id: "index" },
  { page_id: "svc", output: "services/drain-cleaning.html", stamp_value: "Drain Cleaning", nav_title: "Drain Cleaning" },
  { page_id: "svc", output: "services/water-heaters.html", stamp_value: "Water Heaters", nav_title: "Water Heaters" },
];

const okResult = <T extends Extract<WriteResult, { ok: true }>>(r: T) => r;

const indexResult = okResult({
  ok: true,
  title: "Acme Plumbing | Home",
  slots: { index_s1: "Welcome to Acme Plumbing" },
  repeats: { index_r1: [{ index_r1_s1: "Card A" }, { index_r1_s1: "Card B" }] },
});

const drainResult = okResult({
  ok: true,
  title: "Drain Cleaning | Acme Plumbing",
  slots: { svc_s1: "We fix drains fast." },
  repeats: {},
});

const waterResult = okResult({
  ok: true,
  title: "Water Heaters | Acme Plumbing",
  slots: { svc_s1: "We install water heaters." },
  repeats: {},
});

describe("applyWritten", () => {
  it("merges a page's written content into exactly that doc-page", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const after = applyWritten(doc, 0, indexResult);

    expect(after.pages[0].title).toBe("Acme Plumbing | Home");
    expect(after.pages[0].slots.index_s1).toBe("Welcome to Acme Plumbing");
    expect(after.pages[0].repeats.index_r1).toEqual([{ index_r1_s1: "Card A" }, { index_r1_s1: "Card B" }]);
  });

  it("leaves image slots untouched", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const after = applyWritten(doc, 0, indexResult);
    expect(after.pages[0].slots.index_i1).toBe("img/hero.jpg");
  });

  it("a page's merge does not disturb any other doc-page, INCLUDING a stamped duplicate at a different index", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    let after = applyWritten(doc, 0, indexResult);
    after = applyWritten(after, 1, drainResult);

    // page 0 (index) still carries its own merge
    expect(after.pages[0].title).toBe("Acme Plumbing | Home");
    // page 1 (svc/drain) now carries its merge
    expect(after.pages[1].title).toBe("Drain Cleaning | Acme Plumbing");
    expect(after.pages[1].slots.svc_s1).toBe("We fix drains fast.");
    // page 2 (svc/water) — same page_id as page 1, different index — is still untouched
    expect(after.pages[2].title).toBe("");
    expect(after.pages[2].slots.svc_s1).toBe("");
    expect(after.pages[2].output).toBe("services/water-heaters.html");

    after = applyWritten(after, 2, waterResult);
    // now page 2 has its own merge, and page 1's is undisturbed by it
    expect(after.pages[2].title).toBe("Water Heaters | Acme Plumbing");
    expect(after.pages[1].title).toBe("Drain Cleaning | Acme Plumbing");
    expect(after.pages[1].slots.svc_s1).toBe("We fix drains fast.");
  });

  it("does not mutate its input", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const before = JSON.parse(JSON.stringify(doc));
    applyWritten(doc, 0, indexResult);
    expect(doc).toEqual(before);
  });

  it("records provenance written_by:'ai' for every field the write touched", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const after = applyWritten(doc, 0, indexResult);
    expect(after.provenance[0].title?.written_by).toBe("ai");
    expect(after.provenance[0].slots.index_s1.written_by).toBe("ai");
    expect(after.provenance[0].repeats.index_r1.written_by).toBe("ai");
    // an untouched page has no provenance entries yet
    expect(after.provenance[1].slots).toEqual({});
  });

  it("after every page is applied, the doc passes contentDocSchema.parse", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    let after = applyWritten(doc, 0, indexResult);
    after = applyWritten(after, 1, drainResult);
    after = applyWritten(after, 2, waterResult);
    expect(() => contentDocSchema.parse(after)).not.toThrow();
  });

  it("throws on an out-of-range page index rather than silently doing nothing", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    expect(() => applyWritten(doc, 99, indexResult)).toThrow();
  });
});

describe("applyOperatorEdit", () => {
  it("touches only the fields supplied, leaving the rest of the page alone", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const written = applyWritten(doc, 0, indexResult);

    const edited = applyOperatorEdit(written, 0, { slots: { index_s1: "Operator's headline" } });
    expect(edited.pages[0].slots.index_s1).toBe("Operator's headline");
    // untouched fields survive verbatim
    expect(edited.pages[0].title).toBe("Acme Plumbing | Home");
    expect(edited.pages[0].repeats.index_r1).toEqual([{ index_r1_s1: "Card A" }, { index_r1_s1: "Card B" }]);
  });

  it("stamps written_by:'operator' only on the fields it touched, leaving the AI provenance on the rest", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const written = applyWritten(doc, 0, indexResult);

    const edited = applyOperatorEdit(written, 0, { title: "Operator's title" });
    expect(edited.provenance[0].title?.written_by).toBe("operator");
    expect(edited.provenance[0].slots.index_s1.written_by).toBe("ai");
  });

  it("works on a doc with no provenance yet (a fresh seed, never AI-written)", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const edited = applyOperatorEdit(doc, 1, { slots: { svc_s1: "Manual copy" } });
    expect(edited.pages[1].slots.svc_s1).toBe("Manual copy");
    expect(edited.provenance[1].slots.svc_s1.written_by).toBe("operator");
    expect(edited.provenance[0].slots).toEqual({});
  });

  it("does not mutate its input", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const before = JSON.parse(JSON.stringify(doc));
    applyOperatorEdit(doc, 0, { title: "Changed" });
    expect(doc).toEqual(before);
  });

  it("throws on an out-of-range page index", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    expect(() => applyOperatorEdit(doc, 99, { title: "x" })).toThrow();
  });

  it("an edit result still passes contentDocSchema.parse", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const written = applyWritten(doc, 0, indexResult);
    const edited = applyOperatorEdit(written, 0, { slots: { index_s1: "Fixed by hand" } });
    expect(() => contentDocSchema.parse(edited)).not.toThrow();
  });
});

describe("applyOperatorEdit never backs up an IMAGE slot when told which ones are images (FIX 3)", () => {
  it("does not capture ai_backup for an image slot pick, even on its first operator edit", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const written = applyWritten(doc, 0, indexResult);
    // index_i1 is an IMAGE slot — before any pick it holds the template's own
    // demo sample ("img/hero.jpg"), never something the AI wrote.
    expect(written.pages[0].slots.index_i1).toBe("img/hero.jpg");

    const edited = applyOperatorEdit(written, 0, { slots: { index_i1: "asset:abc-123" } }, new Set(["index_i1"]));
    expect(edited.pages[0].slots.index_i1).toBe("asset:abc-123");
    expect(edited.provenance[0].slots.index_i1.written_by).toBe("operator");
    // the fix: no backup captured at all for this slot
    expect(edited.provenance[0].ai_backup?.slots?.index_i1).toBeUndefined();
  });

  it("demonstrates why a caller MUST pass imageSlotIds: omitting it falls back to capturing the template's demo sample as if it were an AI value", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const written = applyWritten(doc, 0, indexResult);
    const edited = applyOperatorEdit(written, 0, { slots: { index_i1: "asset:abc-123" } });
    expect(edited.provenance[0].ai_backup?.slots?.index_i1).toBe("img/hero.jpg");
  });

  it("excluding the image slot does not affect backup capture for a sibling TEXT slot in the same call", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const written = applyWritten(doc, 0, indexResult);
    const edited = applyOperatorEdit(
      written,
      0,
      { slots: { index_i1: "asset:abc-123", index_s1: "operator text" } },
      new Set(["index_i1"]),
    );
    expect(edited.provenance[0].ai_backup?.slots?.index_i1).toBeUndefined();
    expect(edited.provenance[0].ai_backup?.slots?.index_s1).toBe("Welcome to Acme Plumbing");
  });
});

describe("findDisallowedEditField", () => {
  it("passes a clean edit", () => {
    expect(findDisallowedEditField({ title: "A fine title", slots: { s1: "Plain copy." } })).toBeNull();
  });

  it("catches markup in the title", () => {
    expect(findDisallowedEditField({ title: "<b>Bold</b>" })).toBe("title");
  });

  it("catches a script tag, a bare URL, and www. in slot values, naming the slot", () => {
    expect(findDisallowedEditField({ slots: { s1: "ok", s2: "<script>alert(1)</script>" } })).toBe('slot "s2"');
    expect(findDisallowedEditField({ slots: { s1: "Visit https://example.com now" } })).toBe('slot "s1"');
    expect(findDisallowedEditField({ slots: { s1: "See www.example.com" } })).toBe('slot "s1"');
  });

  it("catches a template token, so an operator can't smuggle in {{id:*}} either", () => {
    expect(findDisallowedEditField({ slots: { s1: "Call {{id:phone}}" } })).toBe('slot "s1"');
  });

  it("holds the operator to exactly writePage's own bar (DISALLOWED), not the schema's laxer tokenFree", () => {
    // contentDocSchema's tokenFree would let this straight through (it only
    // blocks {{ tokens) — findDisallowedEditField must not.
    expect(findDisallowedEditField({ title: "<i>fine print</i>" })).not.toBeNull();
  });

  it("ignores fields that were not part of the edit", () => {
    expect(findDisallowedEditField({})).toBeNull();
    expect(findDisallowedEditField({ slots: {} })).toBeNull();
  });
});
