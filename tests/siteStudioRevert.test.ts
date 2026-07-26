import { describe, it, expect } from "vitest";
import { seedContentDoc } from "@/lib/site-studio/run/seed";
import { applyWritten, applyOperatorEdit } from "@/lib/site-studio/run/applyWritten";
import { revertField } from "@/lib/site-studio/run/revert";
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
      repeats: [],
    },
    {
      id: "svc", file: "service.html", kind: "service", stampable: true,
      title_sample: "Service | Demo",
      slots: [{ id: "svc_s1", type: "text", sample: "Service description here", max_chars: 80, html: false }],
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
  { page_id: "svc", output: "services/drain.html", stamp_value: "Drain", nav_title: "Drain" },
];

const okResult = <T extends Extract<WriteResult, { ok: true }>>(r: T) => r;

const indexResult = okResult({
  ok: true,
  title: "Acme Plumbing | Home",
  slots: { index_s1: "Welcome to Acme Plumbing" },
  repeats: {},
});

describe("applyOperatorEdit records an ai_backup on the first ai->operator flip", () => {
  it("backs up the title's prior AI value the first time it's operator-edited", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const written = applyWritten(doc, 0, indexResult);
    const edited = applyOperatorEdit(written, 0, { title: "Operator's title" });
    expect(edited.provenance[0].ai_backup?.title).toBe("Acme Plumbing | Home");
    expect(edited.pages[0].title).toBe("Operator's title");
  });

  it("backs up a slot's prior AI value the first time it's operator-edited", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const written = applyWritten(doc, 0, indexResult);
    const edited = applyOperatorEdit(written, 0, { slots: { index_s1: "Operator's headline" } });
    expect(edited.provenance[0].ai_backup?.slots?.index_s1).toBe("Welcome to Acme Plumbing");
  });

  it("does NOT overwrite an existing backup on a second operator edit of the same field", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const written = applyWritten(doc, 0, indexResult);
    let edited = applyOperatorEdit(written, 0, { title: "First operator edit" });
    edited = applyOperatorEdit(edited, 0, { title: "Second operator edit" });
    expect(edited.pages[0].title).toBe("Second operator edit");
    // backup is still the ORIGINAL ai value, not "First operator edit"
    expect(edited.provenance[0].ai_backup?.title).toBe("Acme Plumbing | Home");
  });

  it("backs up the CURRENT (pre-edit) value even on a doc with no provenance yet", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const edited = applyOperatorEdit(doc, 1, { slots: { svc_s1: "Manual copy" } });
    expect(edited.provenance[1].ai_backup?.slots?.svc_s1).toBe("");
  });

  it("does not mutate its input", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const written = applyWritten(doc, 0, indexResult);
    const before = JSON.parse(JSON.stringify(written));
    applyOperatorEdit(written, 0, { title: "Changed" });
    expect(written).toEqual(before);
  });
});

describe("revertField", () => {
  it("restores the backed-up AI value, flips provenance back to ai, and clears the backup", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const written = applyWritten(doc, 0, indexResult);
    const edited = applyOperatorEdit(written, 0, { title: "Operator's title" });

    const reverted = revertField(edited, 0, { title: true });
    expect(reverted.ok).toBe(true);
    if (!reverted.ok) return;
    expect(reverted.doc.pages[0].title).toBe("Acme Plumbing | Home");
    expect(reverted.doc.provenance[0].title?.written_by).toBe("ai");
    expect(reverted.doc.provenance[0].ai_backup?.title).toBeUndefined();
  });

  it("restores a reverted slot the same way", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const written = applyWritten(doc, 0, indexResult);
    const edited = applyOperatorEdit(written, 0, { slots: { index_s1: "Operator's headline" } });

    const reverted = revertField(edited, 0, { slotId: "index_s1" });
    expect(reverted.ok).toBe(true);
    if (!reverted.ok) return;
    expect(reverted.doc.pages[0].slots.index_s1).toBe("Welcome to Acme Plumbing");
    expect(reverted.doc.provenance[0].slots.index_s1.written_by).toBe("ai");
    expect(reverted.doc.provenance[0].ai_backup?.slots?.index_s1).toBeUndefined();
  });

  it("returns {ok:false} when the field was never operator-edited (no backup) — never a silent no-op", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const written = applyWritten(doc, 0, indexResult);
    const reverted = revertField(written, 0, { title: true });
    expect(reverted.ok).toBe(false);
  });

  it("returns {ok:false} for a slot that was never operator-edited", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const written = applyWritten(doc, 0, indexResult);
    const reverted = revertField(written, 0, { slotId: "index_s1" });
    expect(reverted.ok).toBe(false);
  });

  it("a revert on one field leaves every other field and page alone", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    let d = applyWritten(doc, 0, indexResult);
    d = applyOperatorEdit(d, 0, { title: "Operator's title", slots: { index_s1: "Operator's headline" } });

    const reverted = revertField(d, 0, { title: true });
    expect(reverted.ok).toBe(true);
    if (!reverted.ok) return;
    // the slot edit is untouched by reverting the title
    expect(reverted.doc.pages[0].slots.index_s1).toBe("Operator's headline");
    expect(reverted.doc.provenance[0].slots.index_s1.written_by).toBe("operator");
    // page 1 is completely undisturbed
    expect(reverted.doc.pages[1]).toEqual(d.pages[1]);
    expect(reverted.doc.provenance[1]).toEqual(d.provenance[1]);
  });

  it("is pure: does not mutate its input", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const written = applyWritten(doc, 0, indexResult);
    const edited = applyOperatorEdit(written, 0, { title: "Operator's title" });
    const before = JSON.parse(JSON.stringify(edited));
    revertField(edited, 0, { title: true });
    expect(edited).toEqual(before);
  });

  it("a field edited, reverted, and edited again backs up the ORIGINAL AI value both times", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    const written = applyWritten(doc, 0, indexResult);

    let d = applyOperatorEdit(written, 0, { title: "First operator edit" });
    expect(d.provenance[0].ai_backup?.title).toBe("Acme Plumbing | Home");

    const reverted = revertField(d, 0, { title: true });
    expect(reverted.ok).toBe(true);
    if (!reverted.ok) return;
    d = reverted.doc;
    expect(d.pages[0].title).toBe("Acme Plumbing | Home");

    d = applyOperatorEdit(d, 0, { title: "Second operator edit" });
    // backed up again, and it's still the ORIGINAL AI value
    expect(d.provenance[0].ai_backup?.title).toBe("Acme Plumbing | Home");
    expect(d.pages[0].title).toBe("Second operator edit");
  });

  it("throws on an out-of-range page index", () => {
    const { doc } = seedContentDoc(manifest, dossier, selectedPages);
    expect(() => revertField(doc, 99, { title: true })).toThrow();
  });
});
