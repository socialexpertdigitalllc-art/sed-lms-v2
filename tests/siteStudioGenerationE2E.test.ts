import { describe, it, expect } from "vitest";
import { compileTemplate } from "@/lib/site-studio/compiler/compile";
import { fixtureZip } from "./helpers/siteStudioFixtures";
import { buildDossier, type Dossier } from "@/lib/site-studio/run/dossier";
import { selectPages } from "@/lib/site-studio/run/pageSelect";
import { seedContentDoc } from "@/lib/site-studio/run/seed";
import { writePage, type AiCall } from "@/lib/site-studio/run/writer";
import { applyWritten, applyOperatorEdit, getPageProvenance, type RunContentDoc } from "@/lib/site-studio/run/applyWritten";
import { revertField } from "@/lib/site-studio/run/revert";
import { renderSite } from "@/lib/site-studio/render/renderer";
import { SLOT_ATTR, PAGE_ATTR, IMAGE_ATTR, ALT_ATTR } from "@/lib/site-studio/render/annotate";
import { buildPreview } from "@/lib/site-studio/preview/buildPreview";
import { contentDocSchema, type CompiledTemplate, type ContentDoc, type TemplateManifest } from "@/lib/site-studio/schema";
import { findTokens } from "@/lib/site-studio/tokens";
import { runStep, type RunStepDeps } from "@/lib/site-studio/run/engine";
import type { StudioRunRow } from "@/lib/site-studio/run/types";
import { rerollPage } from "@/lib/site-studio/run/reroll";
import { rehostFromUrl } from "@/lib/site-studio/assets/rehost";
import { savePackage } from "@/lib/site-studio/service/templates";
import { unzipToMap } from "@/lib/site-studio/zip";
import { emptyFakeAdminState, makeFakeAdmin } from "./helpers/fakeStudioAdmin";

const dec = (b: Uint8Array) => new TextDecoder().decode(b);

// A different trade and a different city than the fixture template (a
// plumber in Austin) — so any leftover demo copy ("plumbing", "Austin") or
// a category-drift bug in the Writer would be visible in the output, even
// though the assertions below check the specific, provable things: zero
// demo identity, the client's own facts present, zero surviving tokens.
const CLIENT_LEAD: Record<string, unknown> = {
  id: "lead-e2e-electric",
  business_name: "Rocky Mountain Electric",
  business_phone: "(720) 555-9821",
  business_email: "service@rockymtnelectric.com",
  no_email: false,
  business_profile_link: "https://g.page/rockymtnelectric",
  map_embed_link: "https://www.google.com/maps/embed?pb=denver-co-electric",
  site_type: "Electrician",
  services: ["Panel Upgrades", "EV Charger Installation", "Emergency Rewiring"],
  service_areas: ["Denver", "Aurora", "Lakewood"],
  client_experience: 18,
  specify_pages: [],
  about_business: "Licensed electricians serving the Denver metro since 2007.",
  image_links: [],
  design_reference_links: [],
  add_ons: [],
};

/** A stub model: no network, deterministic, and it never reuses the
 *  template's plumbing-in-Austin sample text — it always writes fresh copy
 *  built from the dossier, which is what a real Writer must also do (rule 2:
 *  "write for the CLIENT's trade, not the template's"). Every repeat row is
 *  filled (the writer now requires complete rows), and the client's own
 *  services are woven into the repeat cards so their presence in the
 *  rendered output is provable, not incidental. */
function makeStubWriter(dossier: Dossier): AiCall {
  return async (_system, user) => {
    const slots: Record<string, string> = {};
    for (const m of user.matchAll(/^- (\S+).*\| sample: "/gm)) {
      slots[m[1]] =
        `${dossier.business_name} delivers dependable ${dossier.site_type ?? "home service"} work across ${dossier.service_areas.join(", ")}.`;
    }

    const repeats: Record<string, Record<string, string>[]> = {};
    for (const m of user.matchAll(/^- (\S+): write (\d+) row\(s\), fields: (.+)$/gm)) {
      const [, repId, countStr, fieldsStr] = m;
      const count = Number(countStr);
      const fields = fieldsStr.split(",").map((f) => f.trim());
      repeats[repId] = Array.from({ length: count }, (_, i) => {
        const service = dossier.services[i % dossier.services.length] ?? dossier.business_name;
        return Object.fromEntries(
          fields.map((f, fi) => [f, fi === 0 ? service : `${service} handled right by ${dossier.business_name}.`]),
        );
      });
    }

    const pageMatch = user.match(/PAGE: (\S+)/);
    return {
      text: JSON.stringify({
        title: `${dossier.business_name} | ${pageMatch?.[1] ?? "Page"}`,
        slots,
        repeats,
      }),
    };
  };
}

/** The Gate 2 re-roll's own stub: wraps `makeStubWriter`'s output (so it
 *  reuses the exact same field-name discovery from the prompt) but marks
 *  every value it produces with a "REROLLED" tag distinct from the first
 *  write's plain dossier-derived copy. This is what lets the Gate 2 E2E case
 *  prove a re-roll actually ran (an AI-owned field visibly changes) rather
 *  than merely asserting an operator-owned field didn't change, which would
 *  be true even if the re-roll silently no-op'd. */
function makeRerollStubWriter(dossier: Dossier): AiCall {
  const base = makeStubWriter(dossier);
  return async (system, user) => {
    const { text } = await base(system, user);
    const parsed = JSON.parse(text) as {
      title: string;
      slots: Record<string, string>;
      repeats: Record<string, Record<string, string>[]>;
    };
    parsed.title = `REROLLED ${parsed.title}`;
    for (const k of Object.keys(parsed.slots)) parsed.slots[k] = `REROLLED: ${parsed.slots[k]}`;
    for (const k of Object.keys(parsed.repeats)) {
      parsed.repeats[k] = parsed.repeats[k].map((row) => {
        const out: Record<string, string> = {};
        for (const [f, v] of Object.entries(row)) out[f] = `REROLLED: ${v}`;
        return out;
      });
    }
    return { text: JSON.stringify(parsed) };
  };
}

/** Every `{{id:*}}` key the compiled package's page skeletons, fragments, or
 *  nav labels can reference. Mirrors the engine's own `prepare`-step gate
 *  (lib/site-studio/run/engine.ts, private there) so the fail-fast identity
 *  check can be proven here without a database. */
function referencedIdentityKeys(tpl: CompiledTemplate): Set<string> {
  const navLabels = tpl.manifest.nav.flatMap((r) => (r.items ?? []).map((it) => it.label));
  const haystacks = [...Object.values(tpl.pages), ...Object.values(tpl.fragments), ...navLabels];
  const keys = new Set<string>();
  for (const s of haystacks) for (const t of findTokens(s)) if (t.kind === "id") keys.add(t.key);
  return keys;
}

describe("Site Studio generation E2E — a real client site from the plumberpro fixture", () => {
  const compiled = compileTemplate(fixtureZip("plumberpro"), "plumberpro");
  expect(compiled.ok).toBe(true);
  const tpl = compiled.template;

  const dossier = buildDossier(CLIENT_LEAD);
  const selection = selectPages(tpl.manifest, {
    requested: dossier.requested_pages,
    services: dossier.services,
    areas: dossier.service_areas,
  });

  it("selects every page in the template with nothing skipped", () => {
    expect(selection.skipped).toEqual([]);
    expect(selection.pages.map((p) => p.page_id).sort()).toEqual(["about", "contact", "index", "services"].sort());
  });

  it("writes, applies, and renders a complete site with zero demo identity", async () => {
    const { doc: seeded, skipped } = seedContentDoc(tpl.manifest, dossier, selection.pages);
    expect(skipped).toEqual([]);

    const pagesById = new Map(tpl.manifest.pages.map((p) => [p.id, p]));
    const stubWriter = makeStubWriter(dossier);

    let doc: ContentDoc = seeded;
    for (let i = 0; i < selection.pages.length; i++) {
      const sel = selection.pages[i];
      const def = pagesById.get(sel.page_id);
      expect(def).toBeTruthy();
      const result = await writePage(def!, dossier, { stampValue: sel.stamp_value }, stubWriter);
      if (!result.ok) throw new Error(`writer failed on ${sel.page_id}: ${result.error}`);
      doc = applyWritten(doc, i, result);
    }

    // The final doc must satisfy the same contract the renderer relies on.
    expect(() => contentDocSchema.parse(doc)).not.toThrow();

    const rendered = renderSite(tpl, doc);
    if (!rendered.ok) {
      throw new Error(`render refused: ${rendered.missing.map((m) => `${m.page_id}/${m.slot_id}`).join(", ")}`);
    }
    expect(rendered.ok).toBe(true);

    // Every selected page landed in the output.
    const expectedFiles = selection.pages.map((sel) => sel.output ?? pagesById.get(sel.page_id)!.file);
    for (const file of expectedFiles) {
      expect(rendered.files[file]).toBeTruthy();
    }

    const allHtml = expectedFiles.map((f) => dec(rendered.files[f])).join("\n---\n");
    const wholeSite = Object.values(rendered.files).map(dec).join("\n---\n");

    // The client's own identity is present...
    expect(allHtml).toContain("Rocky Mountain Electric");
    // ...and the template's demo identity is gone, everywhere.
    expect(wholeSite).not.toContain("PlumberPro");
    expect(wholeSite).not.toContain("(512) 555-0147");
    expect(wholeSite).not.toContain("help@plumberpro.com");

    // The client's own services, written into the repeat cards by the stub
    // model, appear in the rendered output.
    for (const service of dossier.services) {
      expect(allHtml).toContain(service);
    }

    // No structural leftovers: every {{...}} token and <!--@...--> marker was
    // resolved by the renderer (it refuses otherwise, but double-check here).
    expect(wholeSite).not.toMatch(/\{\{|<!--@/);

    // The Phase 3a image default: every image slot still points at the
    // template's own sample image (no curation exists yet in this phase).
    expect(wholeSite).toContain("img/hero.jpg");
    expect(wholeSite).toContain("img/team.jpg");
  });

  it("fails fast on a sparse lead — missing identity is named and the model is never called", async () => {
    const sparseLead = {
      id: "lead-e2e-sparse",
      business_name: "Sparse Electric",
      business_phone: "(720) 555-1000",
    };
    const sparseDossier = buildDossier(sparseLead);
    const sparseSelection = selectPages(tpl.manifest, {
      requested: sparseDossier.requested_pages,
      services: sparseDossier.services,
      areas: sparseDossier.service_areas,
    });
    const { doc: sparseDoc } = seedContentDoc(tpl.manifest, sparseDossier, sparseSelection.pages);

    const referenced = referencedIdentityKeys(tpl);
    const missing = [...referenced]
      .filter((k) => !(k in sparseDoc.identity))
      .map((k) => `id:${k}`)
      .sort();

    expect(missing).toEqual(["id:email", "id:email_href", "id:map_embed"]);

    // The identity-completeness gate runs BEFORE any page write — prove the
    // model is never invoked by only calling it when the gate passes, then
    // asserting on this run (which must not pass it) that it never did.
    let modelCalls = 0;
    const spyWriter: AiCall = async (system, user) => {
      modelCalls += 1;
      return makeStubWriter(sparseDossier)(system, user);
    };

    if (missing.length === 0) {
      // unreachable for this lead, but keeps the gate logic exercised for real
      const def = tpl.manifest.pages[0];
      await writePage(def, sparseDossier, {}, spyWriter);
    }

    expect(modelCalls).toBe(0);
  });
});

// ===========================================================================
// Phase 3b acceptance: Gate 1 (park/pick/edit/reroll/approve) and auto mode,
// driven through the REAL engine (`runStep`) against an in-memory fake admin
// — still no DB, no network. This is the proof that the whole pipeline (gate
// machine + image rehost + resolveAssets + finalize) produces a deployable
// zip: real image bytes at the right path, a depth-correct relative src, and
// an operator's hand edit that survives a re-roll landing in the final HTML.
// ===========================================================================

/** A stampable "service" page (kind "service") alongside a non-stampable
 *  "index" page (kind "home") — fan-out produces exactly one stamped page at
 *  `services/<slug>.html` (depth 1), so the picked image's relative path must
 *  carry a `../` prefix to be correct. This is the one thing a one-page
 *  fixture (as used elsewhere in the 3a/3b suites) can never prove. */
const gatePageManifest: TemplateManifest = {
  engine: 3, name: "e2e-gate-3b", version: 1,
  identity: {},
  theme: { mode: "none", roles: {} },
  nav: [],
  pages: [
    {
      id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Home",
      slots: [
        { id: "index_s1", type: "text", sample: "Welcome to our shop", max_chars: 80, html: false },
        { id: "index_i1", type: "image", sample: "img/hero.jpg", html: false },
      ],
      repeats: [],
    },
    {
      id: "svc", file: "service.html", kind: "service", stampable: true, title_sample: "Our Service",
      slots: [
        { id: "svc_s1", type: "text", sample: "We handle this service", max_chars: 80, html: false },
        { id: "svc_i1", type: "image", sample: "img/team.jpg", html: false },
      ],
      repeats: [],
    },
  ],
};

const gatePageCompiled: CompiledTemplate = {
  manifest: gatePageManifest,
  pages: {
    "index.html": `<html><head><title>{{title}}</title></head><body><h1>{{slot:index_s1}}</h1><img src="{{img:index_i1}}"></body></html>`,
    "service.html": `<html><head><title>{{title}}</title></head><body><p>{{slot:svc_s1}}</p><img src="{{img:svc_i1}}"></body></html>`,
  },
  fragments: {},
  assets: {},
};

const GATE_LEAD: Record<string, unknown> = {
  id: "lead-e2e-gate",
  business_name: "Gatekeeper Electric",
  business_phone: "(303) 555-0100",
  services: ["Panel Repair"],
  service_areas: [],
  specify_pages: [],
};

/** Deterministic stub writer: fills every text slot and title straight from
 *  its own prompt (same pattern as the 3a/gate-engine suites) — no network,
 *  no randomness, so a re-roll produces distinctly different (but still
 *  deterministic) copy than the first write, letting the test prove an
 *  operator-edited field is NOT overwritten by it. */
function makeGateStubWriter(tag: string): AiCall {
  return async (_system, user) => {
    const slots: Record<string, string> = {};
    for (const m of user.matchAll(/^- (\S+).*\| sample: "/gm)) slots[m[1]] = `${tag} copy for ${m[1]}`;
    const pageMatch = user.match(/PAGE: (\S+)/);
    return { text: JSON.stringify({ title: `${tag} title for ${pageMatch?.[1] ?? "page"}`, slots, repeats: {} }) };
  };
}

async function seedGateAdmin(runId: string, options: StudioRunRow["options"]) {
  const state = emptyFakeAdminState();
  const admin = makeFakeAdmin(state);
  await savePackage(admin, "tpl-e2e-gate", gatePageCompiled);
  state.templates["tpl-e2e-gate"] = { manifest: gatePageManifest };
  state.leads["lead-e2e-gate"] = GATE_LEAD;
  const row: StudioRunRow = {
    id: runId,
    lead_id: "lead-e2e-gate",
    template_id: "tpl-e2e-gate",
    template_version: 1,
    status: "queued",
    options,
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
  };
  state.runs[runId] = row as unknown as Record<string, unknown>;
  return { state, admin };
}

const noPexels = async () => ({ ok: false as const, error: "no pexels in this e2e run" });

const dec3b = (b: Uint8Array) => new TextDecoder().decode(b);

describe("Phase 3b acceptance — Gate 1 park, image pick, operator-edit survival, real zip", () => {
  it("parks at reviewing, refuses to cross the gate, then approve->render->finalize ships a zip with the picked image's real bytes at a depth-correct path and the operator's edit intact", async () => {
    const { state, admin } = await seedGateAdmin("run-e2e-gate-a", { fan_out_services: true, auto: false });

    let aiCalls = 0;
    const stub = makeGateStubWriter("first-write");
    const countingWriter: AiCall = async (system, user) => {
      aiCalls += 1;
      return stub(system, user);
    };
    const deps: RunStepDeps = { aiCall: countingWriter, now: () => new Date("2026-01-01T00:00:00.000Z"), searchPexels: noPexels };

    let row = state.runs["run-e2e-gate-a"] as unknown as StudioRunRow;

    // prepare
    row = (await runStep(admin, row, deps)).row;
    expect(row.status).toBe("preparing");
    expect(row.content_doc?.pages.map((p) => p.page_id)).toEqual(["index", "svc"]);
    expect(row.content_doc?.pages[1].output).toBe("services/panel-repair.html");

    // write -> parks at the gate (auto is false)
    row = (await runStep(admin, row, deps)).row;
    expect(row.status).toBe("reviewing");
    const callsAtGate = aiCalls;
    expect(callsAtGate).toBeGreaterThan(0);

    // The machine CANNOT cross the gate: nextStep("reviewing") is null, so a
    // further runStep is a pure no-op — no claim, no AI call.
    const stuck = await runStep(admin, row, deps);
    expect(stuck.done).toBe(true);
    expect(stuck.claimed).toBe(true);
    expect(stuck.row.status).toBe("reviewing");
    expect(aiCalls).toBe(callsAtGate); // no new AI call

    // ---- Gate 1: operator picks an image for the STAMPED page's slot -------
    // (depth 1 — "services/panel-repair.html" — the depth-correctness proof)
    const fakeImageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const fakeFetch = async () =>
      new Response(fakeImageBytes.buffer as ArrayBuffer, { status: 200, headers: { "content-type": "image/jpeg" } });

    const rehosted = await rehostFromUrl(
      admin,
      "https://images.pexels.com/fake/large2x.jpg",
      { kind: "stock", subject: "panel repair photo", source: "pexels", pexels_id: 555, width: 1600, height: 1200, photographer: "Test Photographer" },
      fakeFetch,
    );
    expect(rehosted.ok).toBe(true);
    if (!rehosted.ok) throw new Error(rehosted.error);
    const assetId = rehosted.asset.id;
    expect(state.storage[`studio-assets/${assetId}.jpg`]).toEqual(fakeImageBytes);

    const pickedDoc = applyOperatorEdit(row.content_doc!, 1, { slots: { svc_i1: `asset:${assetId}` } });
    expect(contentDocSchema.safeParse(pickedDoc).success).toBe(true);
    {
      const { data: updated } = await admin
        .from("studio_runs")
        .update({ content_doc: pickedDoc, updated_at: "2026-01-01T00:00:01.000Z" })
        .eq("id", row.id)
        .select("*")
        .single();
      row = updated as unknown as StudioRunRow;
    }

    // ---- operator hand-edits the SAME page's text slot ---------------------
    const OPERATOR_TEXT = "Hand-typed by the operator — must survive any re-roll.";
    const editedDoc = applyOperatorEdit(row.content_doc!, 1, { slots: { svc_s1: OPERATOR_TEXT } });
    {
      const { data: updated } = await admin
        .from("studio_runs")
        .update({ content_doc: editedDoc, updated_at: "2026-01-01T00:00:02.000Z" })
        .eq("id", row.id)
        .select("*")
        .single();
      row = updated as unknown as StudioRunRow;
    }
    expect(row.content_doc?.pages[1].slots.svc_s1).toBe(OPERATOR_TEXT);

    // ---- a whole-page re-roll BEFORE approval must NOT clobber the edit ---
    const dossier = buildDossier(GATE_LEAD);
    const rerollWriter = makeGateStubWriter("reroll");
    const reroll = await rerollPage({ aiCall: rerollWriter }, gatePageManifest, dossier, row, 1);
    expect(reroll.ok).toBe(true);
    if (!reroll.ok) throw new Error(reroll.error);

    // Provenance protection: the operator's edit survived the re-roll...
    expect(reroll.doc.pages[1].slots.svc_s1).toBe(OPERATOR_TEXT);
    // ...while the re-roll DID produce fresh AI copy for the title (proving
    // the re-roll actually ran, rather than the assertion above being vacuous).
    expect(reroll.doc.pages[1].title).toBe("reroll title for svc");
    // The image pick (never touched by the Writer at all) survives too.
    expect(reroll.doc.pages[1].slots.svc_i1).toBe(`asset:${assetId}`);

    {
      const { data: updated } = await admin
        .from("studio_runs")
        .update({ content_doc: reroll.doc, updated_at: "2026-01-01T00:00:03.000Z" })
        .eq("id", row.id)
        .select("*")
        .single();
      row = updated as unknown as StudioRunRow;
    }

    // ---- approve: CAS reviewing -> approved (the approve route's own guard) -
    {
      const { data: approved, error } = await admin
        .from("studio_runs")
        .update({ status: "approved", updated_at: "2026-01-01T00:00:04.000Z" })
        .eq("id", row.id)
        .eq("status", "reviewing")
        .select("*")
        .single();
      expect(error).toBeNull();
      row = approved as unknown as StudioRunRow;
    }
    expect(row.status).toBe("approved");

    // render -> finalize -> ready
    row = (await runStep(admin, row, deps)).row;
    expect(row.status).toBe("rendering");
    row = (await runStep(admin, row, deps)).row;
    expect(row.status).toBe("ready");
    expect(row.zip_path).toBeTruthy();

    // ---- the produced zip: real bytes, depth-correct src, operator text ---
    const zipBytes = state.storage[`studio-sites/${row.zip_path}`];
    expect(zipBytes?.length).toBeGreaterThan(0);
    const files = unzipToMap(zipBytes!);

    expect(files[`img/studio/${assetId}.jpg`]).toEqual(fakeImageBytes);

    const svcHtml = dec3b(files["services/panel-repair.html"]);
    // depth-correct: one path segment in "services/panel-repair.html" -> one "../"
    expect(svcHtml).toContain(`src="../img/studio/${assetId}.jpg"`);
    expect(svcHtml).toContain(OPERATOR_TEXT);

    // The unrelated root page kept its own (never-picked) sample image, and
    // its own AI-written copy from the first write — untouched by any of this.
    const indexHtml = dec3b(files["index.html"]);
    expect(indexHtml).toContain("img/hero.jpg");
    expect(indexHtml).toContain("first-write copy for index_s1");
  });
});

describe("Phase 3b acceptance — auto mode never parks", () => {
  it("options.auto:true reaches 'ready' without ever observing 'reviewing', and crosses no gate", async () => {
    const { state, admin } = await seedGateAdmin("run-e2e-gate-b", { fan_out_services: true, auto: true });
    const deps: RunStepDeps = {
      aiCall: makeGateStubWriter("auto"),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      searchPexels: noPexels,
    };

    let row = state.runs["run-e2e-gate-b"] as unknown as StudioRunRow;
    const statuses: string[] = [row.status];
    for (let i = 0; i < 6; i++) {
      const result = await runStep(admin, row, deps);
      row = result.row;
      statuses.push(row.status);
      if (result.done) break;
    }

    expect(statuses).not.toContain("reviewing");
    expect(row.status).toBe("ready");
    expect(row.zip_path).toBeTruthy();

    // Auto mode SKIPS the gate outright: neither of the two events that mark
    // an actual gate crossing (opened at write-completion, closed at approve)
    // ever fires — "gate_skipped_auto" (a distinct, "there was no gate"
    // event) is what's logged instead.
    expect(state.events.some((e) => e.message === "gate_opened")).toBe(false);
    expect(state.events.some((e) => e.message === "gate_closed")).toBe(false);
    expect(state.events.some((e) => e.message === "gate_skipped_auto")).toBe(true);
  });
});

// ===========================================================================
// Phase 4a acceptance: Gate 2 — the annotated, click-to-edit preview and the
// production-build safety guarantee it must never break. Driven against a
// REAL run reached via the engine (auto mode, no DB, no network — same fakes
// as the Phase 3b block above). Proves the whole editable-preview loop end to
// end: every text slot on a page — INCLUDING a repeat row, since repeat
// regions are the bulk of a real site's editable content and a proof that
// skips them proves little — is addressable by its documented
// "{{docIndex}}:{{slotId}}" / "{{docIndex}}:{{repeatId}}#{{rowIndex}}:{{slotId}}"
// key; an operator edit to both shapes round-trips through the preview and a
// revert; and a re-roll that is NOT told to override operator fields leaves
// the still-edited one alone while an AI-owned field the SAME re-roll
// touches visibly changes — so the provenance protection is proven, not
// merely asserted vacuously. Finally locks down the one property none of
// this may ever touch: the production build of the doc used throughout this
// test carries no annotation attributes and renders BYTE-IDENTICAL bytes
// before and after all of the preview/edit/revert/re-roll work above ran in
// the same process — proof that none of it mutated the doc or left behind
// any shared state that could corrupt a deployed site.
// ===========================================================================

describe("Phase 4a acceptance — Gate 2 preview, edit, revert, and re-roll's provenance protection", () => {
  it("annotates every slot (incl. a repeat row), round-trips an operator edit through preview + revert, and a re-roll leaves the still-edited slot alone while AI fields change — production build stays annotation-free and byte-identical throughout", async () => {
    const { template: gate2Tpl } = compileTemplate(fixtureZip("plumberpro"), "plumberpro");

    const state = emptyFakeAdminState();
    const admin = makeFakeAdmin(state);
    await savePackage(admin, "tpl-e2e-gate2", gate2Tpl);
    state.templates["tpl-e2e-gate2"] = { manifest: gate2Tpl.manifest };
    state.leads[CLIENT_LEAD.id as string] = CLIENT_LEAD;

    const runId = "run-e2e-gate2";
    const row0: StudioRunRow = {
      id: runId,
      lead_id: CLIENT_LEAD.id as string,
      template_id: "tpl-e2e-gate2",
      template_version: 1,
      status: "queued",
      options: { auto: true },
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
    };
    state.runs[runId] = row0 as unknown as Record<string, unknown>;

    const gate2Dossier = buildDossier(CLIENT_LEAD);
    const deps: RunStepDeps = {
      aiCall: makeStubWriter(gate2Dossier),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      searchPexels: noPexels,
    };

    // ---- drive the run to "ready" through the real engine, auto mode -------
    let row = row0;
    for (let i = 0; i < 8; i++) {
      const result = await runStep(admin, row, deps);
      row = result.row;
      if (result.done) break;
    }
    expect(row.status).toBe("ready");

    const doc0 = row.content_doc as RunContentDoc;
    const indexDocIndex = doc0.pages.findIndex((p) => p.page_id === "index");
    expect(indexDocIndex).toBeGreaterThanOrEqual(0);
    const indexDef = gate2Tpl.manifest.pages.find((p) => p.id === "index")!;
    const repeatDef = indexDef.repeats[0];
    expect(repeatDef).toBeTruthy();

    // ---- production render, taken BEFORE any preview work in this test ----
    const prodBefore = renderSite(gate2Tpl, doc0);
    expect(prodBefore.ok).toBe(true);

    // ---- build the annotated preview: every slot addressable by its key,
    // including at least one REPEAT ROW key ---------------------------------
    const preview0 = buildPreview(gate2Tpl, doc0, indexDocIndex, runId);
    expect(preview0.ok).toBe(true);
    if (!preview0.ok) throw new Error(`preview refused: ${JSON.stringify(preview0.missing)}`);

    expect(preview0.html).toContain(`${PAGE_ATTR}="${indexDocIndex}"`);
    for (const slot of indexDef.slots) {
      if (slot.attr) {
        // attribute-bound (an <img>'s alt text) — marked with ALT_ATTR, not SLOT_ATTR
        expect(preview0.html).toContain(`${ALT_ATTR}="${indexDocIndex}:${slot.id}"`);
      } else {
        expect(preview0.html).toContain(`${SLOT_ATTR}="${indexDocIndex}:${slot.id}"`);
      }
      if (slot.type === "image") expect(preview0.html).toContain(IMAGE_ATTR);
    }
    const repeatRows = doc0.pages[indexDocIndex].repeats[repeatDef.id];
    expect(repeatRows.length).toBeGreaterThan(0);
    repeatRows.forEach((_row, rowIdx) => {
      for (const slot of repeatDef.slots) {
        expect(preview0.html).toContain(`${SLOT_ATTR}="${indexDocIndex}:${repeatDef.id}#${rowIdx}:${slot.id}"`);
      }
    });

    // ---- operator-edit a plain slot AND a repeat-row slot, through the same
    // applyOperatorEdit path the routes use -----------------------------------
    const plainSlot = indexDef.slots.find((s) => s.type === "text" && !s.attr)!;
    const repeatRowIdx = 0;
    const repeatSlot = repeatDef.slots[0];
    const AI_PLAIN_BEFORE = doc0.pages[indexDocIndex].slots[plainSlot.id];
    const AI_REPEAT_BEFORE = doc0.pages[indexDocIndex].repeats[repeatDef.id][repeatRowIdx][repeatSlot.id];

    const OPERATOR_PLAIN = "Hand-typed by the operator — Gate 2 preview edit.";
    const OPERATOR_REPEAT = "Hand-typed row edit by the operator — Gate 2 preview.";

    const edited = applyOperatorEdit(doc0, indexDocIndex, {
      slots: { [plainSlot.id]: OPERATOR_PLAIN },
      repeats: { [repeatDef.id]: { [String(repeatRowIdx)]: { [repeatSlot.id]: OPERATOR_REPEAT } } },
    });

    const provAfterEdit = getPageProvenance(edited, indexDocIndex);
    expect(provAfterEdit.slots[plainSlot.id].written_by).toBe("operator");
    expect(provAfterEdit.repeats[repeatDef.id][String(repeatRowIdx)][repeatSlot.id].written_by).toBe("operator");

    // rebuild the preview: both new values appear
    const preview1 = buildPreview(gate2Tpl, edited, indexDocIndex, runId);
    expect(preview1.ok).toBe(true);
    if (!preview1.ok) throw new Error(`preview refused: ${JSON.stringify(preview1.missing)}`);
    expect(preview1.html).toContain(OPERATOR_PLAIN);
    expect(preview1.html).toContain(OPERATOR_REPEAT);

    // ---- revert both: the AI values are back, provenance is "ai" again -----
    const revertedPlain = revertField(edited, indexDocIndex, { slotId: plainSlot.id });
    expect(revertedPlain.ok).toBe(true);
    if (!revertedPlain.ok) throw new Error(revertedPlain.error);

    const revertedBoth = revertField(revertedPlain.doc, indexDocIndex, {
      repeat: { repeatId: repeatDef.id, rowIndex: repeatRowIdx, slotId: repeatSlot.id },
    });
    expect(revertedBoth.ok).toBe(true);
    if (!revertedBoth.ok) throw new Error(revertedBoth.error);

    expect(revertedBoth.doc.pages[indexDocIndex].slots[plainSlot.id]).toBe(AI_PLAIN_BEFORE);
    expect(revertedBoth.doc.pages[indexDocIndex].repeats[repeatDef.id][repeatRowIdx][repeatSlot.id]).toBe(AI_REPEAT_BEFORE);
    const provAfterRevert = getPageProvenance(revertedBoth.doc, indexDocIndex);
    expect(provAfterRevert.slots[plainSlot.id].written_by).toBe("ai");
    expect(provAfterRevert.repeats[repeatDef.id][String(repeatRowIdx)][repeatSlot.id].written_by).toBe("ai");

    // ---- re-roll the page with includeOperatorFields:false while ONE slot
    // is STILL operator-edited: only the plain slot was reverted above, so
    // the repeat-row slot going into this re-roll is still "operator" -------
    const rerollWriter = makeRerollStubWriter(gate2Dossier);
    const rerollRow: StudioRunRow = { ...row, status: "reviewing", content_doc: revertedPlain.doc };
    const reroll = await rerollPage(
      { aiCall: rerollWriter },
      gate2Tpl.manifest,
      gate2Dossier,
      rerollRow,
      indexDocIndex,
      { includeOperatorFields: false },
    );
    expect(reroll.ok).toBe(true);
    if (!reroll.ok) throw new Error(reroll.error);

    // The still-operator-owned repeat slot survived the re-roll, untouched...
    expect(reroll.doc.pages[indexDocIndex].repeats[repeatDef.id][repeatRowIdx][repeatSlot.id]).toBe(OPERATOR_REPEAT);
    // ...while the AI-owned plain slot (reverted, so back to "ai") DID get
    // fresh copy from the re-roll — the protection isn't proven vacuously.
    expect(reroll.doc.pages[indexDocIndex].slots[plainSlot.id]).not.toBe(AI_PLAIN_BEFORE);
    expect(reroll.doc.pages[indexDocIndex].slots[plainSlot.id]).toContain("REROLLED");
    expect(reroll.doc.pages[indexDocIndex].title).toContain("REROLLED");

    // ---- the production render of doc0 — untouched by any pure function
    // above, none of which mutate their input — is annotation-free and
    // byte-identical to the render taken before any of this preview work ----
    const prodAfter = renderSite(gate2Tpl, doc0);
    expect(prodAfter.ok).toBe(true);
    if (!prodBefore.ok || !prodAfter.ok) return;
    for (const path of Object.keys(prodBefore.files)) {
      expect(prodAfter.files[path]).toEqual(prodBefore.files[path]);
    }
    for (const [path, bytes] of Object.entries(prodAfter.files)) {
      if (!path.endsWith(".html")) continue;
      const html = dec(bytes);
      expect(html).not.toContain(SLOT_ATTR);
      expect(html).not.toContain(PAGE_ATTR);
      expect(html).not.toContain(IMAGE_ATTR);
      expect(html).not.toContain(ALT_ATTR);
    }
  });
});
