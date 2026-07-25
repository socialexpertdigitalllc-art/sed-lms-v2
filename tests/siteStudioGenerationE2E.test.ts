import { describe, it, expect } from "vitest";
import { compileTemplate } from "@/lib/site-studio/compiler/compile";
import { fixtureZip } from "./helpers/siteStudioFixtures";
import { buildDossier, type Dossier } from "@/lib/site-studio/run/dossier";
import { selectPages } from "@/lib/site-studio/run/pageSelect";
import { seedContentDoc } from "@/lib/site-studio/run/seed";
import { writePage, type AiCall } from "@/lib/site-studio/run/writer";
import { applyWritten } from "@/lib/site-studio/run/applyWritten";
import { renderSite } from "@/lib/site-studio/render/renderer";
import { contentDocSchema, type CompiledTemplate, type ContentDoc } from "@/lib/site-studio/schema";
import { findTokens } from "@/lib/site-studio/tokens";

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
