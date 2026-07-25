import { describe, it, expect, vi } from "vitest";
import { seedContentDoc } from "@/lib/site-studio/run/seed";
import { applyWritten, applyOperatorEdit } from "@/lib/site-studio/run/applyWritten";
import { rerollPage, rerollSlot } from "@/lib/site-studio/run/reroll";
import type { TemplateManifest } from "@/lib/site-studio/schema";
import type { Dossier } from "@/lib/site-studio/run/dossier";
import type { SelectedPage } from "@/lib/site-studio/run/pageSelect";
import type { AiCall } from "@/lib/site-studio/run/writer";
import type { StudioRunRow } from "@/lib/site-studio/run/types";

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
  ],
} as unknown as TemplateManifest;

const dossier: Dossier = {
  lead_id: "l1", business_name: "Acme Plumbing", phone: "(303) 555-1234", phone_href: "tel:3035551234",
  no_email: true, services: [], service_areas: [], requested_pages: [], design_references: [],
  add_ons: [], client_photos: [],
};

const selectedPages: SelectedPage[] = [{ page_id: "index" }];

const initialWrite = {
  ok: true as const,
  title: "Acme Plumbing | Home",
  slots: { index_s1: "Welcome to Acme Plumbing" },
  repeats: { index_r1: [{ index_r1_s1: "Card A" }, { index_r1_s1: "Card B" }] },
};

/** A stub Writer: reads the page id from the prompt and returns fresh,
 *  clearly-different-from-`initialWrite` copy, so a test can prove a
 *  re-roll actually changed the AI-written fields (and only those). */
function rerollWriter(): AiCall {
  return async (_system, user) => {
    const titleMatch = user.match(/PAGE: (\S+)/);
    return {
      text: JSON.stringify({
        title: `REROLLED for ${titleMatch?.[1] ?? "page"}`,
        slots: { index_s1: "Rerolled headline copy" },
        repeats: { index_r1: [{ index_r1_s1: "Rerolled A" }, { index_r1_s1: "Rerolled B" }] },
      }),
    };
  };
}

const failingWriter: AiCall = async () => ({ text: "not json" });

function freshRun(overrides: Partial<StudioRunRow> = {}): StudioRunRow {
  return {
    id: "run1",
    lead_id: "lead1",
    template_id: "tpl1",
    template_version: 1,
    status: "reviewing",
    options: {},
    content_doc: null,
    steps: {},
    client_photos: [],
    site_slug: null,
    zip_path: null,
    deployed_url: null,
    error: null,
    paused: false,
    created_by: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("rerollPage", () => {
  it("re-runs the write and applies AI-written fields, leaving an operator's edit alone by default", async () => {
    const { doc: seeded } = seedContentDoc(manifest, dossier, selectedPages);
    let doc = applyWritten(seeded, 0, initialWrite);
    doc = applyOperatorEdit(doc, 0, { title: "Operator's own title" });
    const run = freshRun({ content_doc: doc });

    const result = await rerollPage({ aiCall: rerollWriter() }, manifest, dossier, run, 0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // the operator-owned title survives untouched...
    expect(result.doc.pages[0].title).toBe("Operator's own title");
    expect(result.doc.provenance[0].title?.written_by).toBe("operator");
    // ...but the AI-owned slot and repeat were re-rolled
    expect(result.doc.pages[0].slots.index_s1).toBe("Rerolled headline copy");
    expect(result.doc.pages[0].repeats.index_r1).toEqual([{ index_r1_s1: "Rerolled A" }, { index_r1_s1: "Rerolled B" }]);
    expect(result.doc.provenance[0].slots.index_s1.written_by).toBe("ai");
  });

  it("with includeOperatorFields:true, overwrites the operator's edit too", async () => {
    const { doc: seeded } = seedContentDoc(manifest, dossier, selectedPages);
    let doc = applyWritten(seeded, 0, initialWrite);
    doc = applyOperatorEdit(doc, 0, { title: "Operator's own title" });
    const run = freshRun({ content_doc: doc });

    const result = await rerollPage({ aiCall: rerollWriter() }, manifest, dossier, run, 0, { includeOperatorFields: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.pages[0].title).toBe("REROLLED for index");
    expect(result.doc.provenance[0].title?.written_by).toBe("ai");
  });

  it("refuses off-gate: a run not at 'reviewing' is never re-rolled", async () => {
    const { doc: seeded } = seedContentDoc(manifest, dossier, selectedPages);
    const doc = applyWritten(seeded, 0, initialWrite);
    const run = freshRun({ content_doc: doc, status: "preparing" });

    const calls: string[] = [];
    const spy: AiCall = async (s, u) => { calls.push(u); return rerollWriter()(s, u); };

    const result = await rerollPage({ aiCall: spy }, manifest, dossier, run, 0);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/gate|reviewing/i);
    expect(calls).toHaveLength(0);
  });

  it("a failed write leaves the doc untouched and reports the error", async () => {
    const { doc: seeded } = seedContentDoc(manifest, dossier, selectedPages);
    const doc = applyWritten(seeded, 0, initialWrite);
    const run = freshRun({ content_doc: doc });

    const result = await rerollPage({ aiCall: failingWriter }, manifest, dossier, run, 0);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeTruthy();
    // the run's own content_doc reference (what the caller still holds) is untouched
    expect(run.content_doc!.pages[0].title).toBe("Acme Plumbing | Home");
  });
});

describe("rerollSlot", () => {
  it("re-runs the whole-page write but merges ONLY the named slot, leaving title and repeats alone", async () => {
    const { doc: seeded } = seedContentDoc(manifest, dossier, selectedPages);
    const doc = applyWritten(seeded, 0, initialWrite);
    const run = freshRun({ content_doc: doc });

    const result = await rerollSlot({ aiCall: rerollWriter() }, manifest, dossier, run, 0, "index_s1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.pages[0].slots.index_s1).toBe("Rerolled headline copy");
    // untouched: title and the repeat, even though the Writer returned fresh
    // values for them too — the merge cherry-picks just the one slot.
    expect(result.doc.pages[0].title).toBe("Acme Plumbing | Home");
    expect(result.doc.pages[0].repeats.index_r1).toEqual([{ index_r1_s1: "Card A" }, { index_r1_s1: "Card B" }]);
    expect(result.doc.provenance[0].slots.index_s1.written_by).toBe("ai");
  });

  it("refuses an operator-owned slot unless includeOperatorFields is set — and never calls the model for the refusal", async () => {
    const { doc: seeded } = seedContentDoc(manifest, dossier, selectedPages);
    let doc = applyWritten(seeded, 0, initialWrite);
    doc = applyOperatorEdit(doc, 0, { slots: { index_s1: "Operator's own headline" } });
    const run = freshRun({ content_doc: doc });

    const calls: string[] = [];
    const spy: AiCall = async (s, u) => { calls.push(u); return rerollWriter()(s, u); };

    const refused = await rerollSlot({ aiCall: spy }, manifest, dossier, run, 0, "index_s1");
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatch(/operator/i);
    expect(calls).toHaveLength(0);

    const overridden = await rerollSlot({ aiCall: spy }, manifest, dossier, run, 0, "index_s1", { includeOperatorFields: true });
    expect(overridden.ok).toBe(true);
    if (!overridden.ok) return;
    expect(overridden.doc.pages[0].slots.index_s1).toBe("Rerolled headline copy");
  });

  it("a slot with NO provenance entry at all (never written by anyone) is re-rollable — proceeds and calls the model", async () => {
    // A freshly seeded doc has never been through applyWritten or an
    // operator edit at all — there is no provenance array yet, so the slot
    // is neither AI-owned nor operator-owned; it's simply unwritten. That
    // must not be mistaken for "protected" — the whole point of provenance
    // gating is to protect a HUMAN'S edit, and there is no edit here yet.
    const { doc: seeded } = seedContentDoc(manifest, dossier, selectedPages);
    const run = freshRun({ content_doc: seeded });

    const calls: string[] = [];
    const spy: AiCall = async (s, u) => { calls.push(u); return rerollWriter()(s, u); };

    const result = await rerollSlot({ aiCall: spy }, manifest, dossier, run, 0, "index_s1", {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toHaveLength(1); // the model WAS called — this was not refused
    expect(result.doc.pages[0].slots.index_s1).toBe("Rerolled headline copy");
    expect(result.doc.provenance[0].slots.index_s1.written_by).toBe("ai");
  });

  it("refuses off-gate", async () => {
    const { doc: seeded } = seedContentDoc(manifest, dossier, selectedPages);
    const doc = applyWritten(seeded, 0, initialWrite);
    const run = freshRun({ content_doc: doc, status: "approved" });

    const result = await rerollSlot({ aiCall: rerollWriter() }, manifest, dossier, run, 0, "index_s1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/gate|reviewing/i);
  });

  it("a failed write leaves the doc untouched and reports the error", async () => {
    const { doc: seeded } = seedContentDoc(manifest, dossier, selectedPages);
    const doc = applyWritten(seeded, 0, initialWrite);
    const run = freshRun({ content_doc: doc });

    const result = await rerollSlot({ aiCall: failingWriter }, manifest, dossier, run, 0, "index_s1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeTruthy();
  });
});
