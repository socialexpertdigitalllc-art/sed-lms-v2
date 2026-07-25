import { describe, it, expect } from "vitest";
import { runStep, type RunStepDeps } from "@/lib/site-studio/run/engine";
import type { AiCall } from "@/lib/site-studio/run/writer";
import type { StudioRunRow } from "@/lib/site-studio/run/types";
import type { CompiledTemplate, TemplateManifest } from "@/lib/site-studio/schema";
import { contentDocSchema } from "@/lib/site-studio/schema";
import { compileTemplate } from "@/lib/site-studio/compiler/compile";
import { savePackage } from "@/lib/site-studio/service/templates";
import { unzipToMap } from "@/lib/site-studio/zip";
import { fixtureZip } from "./helpers/siteStudioFixtures";
import { emptyFakeAdminState, makeFakeAdmin, type FakeAdminState } from "./helpers/fakeStudioAdmin";

const NOW = () => new Date("2026-01-01T00:00:00.000Z");
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

function freshRow(overrides: Partial<StudioRunRow> = {}): StudioRunRow {
  return {
    id: "run1",
    lead_id: "lead1",
    template_id: "tpl1",
    template_version: 1,
    status: "queued",
    options: {},
    content_doc: null,
    steps: {},
    client_photos: [],
    site_slug: null,
    zip_path: null,
    deployed_url: null,
    error: null,
    created_by: null,
    created_at: NOW().toISOString(),
    updated_at: NOW().toISOString(),
    ...overrides,
  };
}

/** A stub Writer AiCall that reads the page's own prompt back — no network,
 *  and (per the coordinator's note) always supplies rows for every repeat
 *  the page declares, so a happy-path run never trips the renderer's
 *  min-rows refusal. */
const genericAiCall: AiCall = async (_system, user) => {
  const slots: Record<string, string> = {};
  for (const m of user.matchAll(/^- (\S+).*\| sample: "/gm)) slots[m[1]] = `Custom copy for ${m[1]}`;

  const repeats: Record<string, Record<string, string>[]> = {};
  for (const m of user.matchAll(/^- (\S+): write (\d+) row\(s\), fields: (.+)$/gm)) {
    const [, repId, countStr, fieldsStr] = m;
    const count = Number(countStr);
    const fields = fieldsStr.split(",").map((f) => f.trim());
    repeats[repId] = Array.from({ length: count }, (_, i) =>
      Object.fromEntries(fields.map((f) => [f, `Row ${i + 1} ${f}`])),
    );
  }

  const titleMatch = user.match(/PAGE: (\S+)/);
  return { text: JSON.stringify({ title: `Title for ${titleMatch?.[1] ?? "page"}`, slots, repeats }) };
};

// ---------------------------------------------------------------- fixtures

const twoPageManifest: TemplateManifest = {
  engine: 3, name: "engine-test", version: 1,
  identity: {},
  theme: { mode: "none", roles: {} },
  nav: [],
  pages: [
    {
      id: "index", file: "index.html", kind: "home", stampable: false,
      title_sample: "{{id:business_name}} | Home",
      slots: [
        { id: "index_s1", type: "text", sample: "Welcome", max_chars: 60, html: false },
        { id: "index_i1", type: "image", sample: "img/hero.jpg", html: false },
      ],
      repeats: [],
    },
    {
      id: "about", file: "about.html", kind: "about", stampable: false,
      title_sample: "About | {{id:business_name}}",
      slots: [{ id: "about_s1", type: "text", sample: "Our story", max_chars: 60, html: false }],
      repeats: [],
    },
  ],
};

const twoPageCompiled: CompiledTemplate = {
  manifest: twoPageManifest,
  pages: {
    "index.html": `<html><head><title>{{title}}</title></head><body><h1>{{slot:index_s1}}</h1><img src="{{img:index_i1}}"><p>{{id:business_name}}</p></body></html>`,
    "about.html": `<html><head><title>{{title}}</title></head><body><p>{{slot:about_s1}}</p></body></html>`,
  },
  fragments: {},
  assets: {},
};

async function seedTwoPageAdmin(): Promise<{ state: FakeAdminState; admin: ReturnType<typeof makeFakeAdmin> }> {
  const state = emptyFakeAdminState();
  const admin = makeFakeAdmin(state);
  await savePackage(admin, "tpl1", twoPageCompiled);
  state.templates["tpl1"] = { manifest: twoPageManifest };
  state.leads["lead1"] = { id: "lead1", business_name: "Acme Co", business_phone: "(303) 555-1234" };
  state.runs["run1"] = freshRow() as unknown as Record<string, unknown>;
  return { state, admin };
}

// ------------------------------------------------------------------ tests

describe("runStep — the chain advances one status per call", () => {
  it("walks queued -> preparing -> writing -> rendering -> ready -> done", async () => {
    const { state, admin } = await seedTwoPageAdmin();
    let row = state.runs["run1"] as unknown as StudioRunRow;
    const deps: RunStepDeps = { aiCall: genericAiCall, now: NOW };

    const r1 = await runStep(admin, row, deps);
    expect(r1.done).toBe(false);
    expect(r1.row.status).toBe("preparing");
    expect(r1.row.content_doc).toBeTruthy();
    expect(r1.row.site_slug).toMatch(/^acme-co-[0-9a-z]{6}$/);
    row = r1.row;

    const r2 = await runStep(admin, row, deps);
    expect(r2.row.status).toBe("writing"); // both pages written in one parallel call
    row = r2.row;

    const r3 = await runStep(admin, row, deps);
    expect(r3.row.status).toBe("rendering");
    row = r3.row;

    const r4 = await runStep(admin, row, deps);
    expect(r4.row.status).toBe("ready");
    expect(r4.row.zip_path).toBe("run1/site.zip");
    row = r4.row;

    const r5 = await runStep(admin, row, deps);
    expect(r5.done).toBe(true);
    expect(r5.row.status).toBe("ready");

    expect(state.events.length).toBeGreaterThanOrEqual(4);
    expect(state.storage["studio-sites/run1/site.zip"]?.length).toBeGreaterThan(0);
  });
});

describe("runStep — write: per-page isolation and retry-only-failed", () => {
  it("a failed page does not block the run, and re-running write retries only that page", async () => {
    const { state, admin } = await seedTwoPageAdmin();
    let row = state.runs["run1"] as unknown as StudioRunRow;

    const prep = await runStep(admin, row, { aiCall: genericAiCall, now: NOW });
    row = prep.row;
    expect(row.status).toBe("preparing");

    const calls: string[] = [];
    const flakyAiCall: AiCall = async (system, user) => {
      calls.push(user.match(/PAGE: (\S+)/)?.[1] ?? "?");
      if (user.includes("PAGE: about")) return { text: "not json, sorry" };
      return genericAiCall(system, user);
    };

    const w1 = await runStep(admin, row, { aiCall: flakyAiCall });
    // write is incomplete (about failed) — status must stay exactly where it
    // was, so a re-call routes back to "write" instead of advancing to render
    // with a half-written doc.
    expect(w1.row.status).toBe(row.status);
    expect(w1.row.status).not.toBe("writing");
    const pages1 = w1.row.steps.write!.pages;
    expect(pages1["0"].status).toBe("written"); // index
    expect(pages1["1"].status).toBe("failed"); // about
    expect(pages1["1"].error).toMatch(/json/i);
    expect(calls).toEqual(["index", "about"]);
    row = w1.row;

    calls.length = 0;
    const fixedAiCall: AiCall = async (system, user) => {
      calls.push(user.match(/PAGE: (\S+)/)?.[1] ?? "?");
      return genericAiCall(system, user);
    };
    const w2 = await runStep(admin, row, { aiCall: fixedAiCall });

    // ONLY the previously-failed page is re-called; the already-written page
    // is left completely alone.
    expect(calls).toEqual(["about"]);
    expect(w2.row.status).toBe("writing");
    expect(w2.row.content_doc!.pages[1].slots.about_s1).toBe("Custom copy for about_s1");
    expect(w2.row.steps.write!.pages["0"].attempts).toBe(1);
    expect(w2.row.steps.write!.pages["1"].attempts).toBe(2);
  });
});

describe("runStep — render: a refusal fails the run with the missing list", () => {
  it("sets status failed and names the missing repeat rows", async () => {
    const repeatManifest: TemplateManifest = {
      engine: 3, name: "engine-test-repeats", version: 1,
      identity: {},
      theme: { mode: "none", roles: {} },
      nav: [],
      pages: [
        {
          id: "about", file: "about.html", kind: "about", stampable: false, title_sample: "About",
          slots: [],
          repeats: [{
            id: "about_r1", fragment: "about_r1", min: 1, max: 5,
            slots: [{ id: "about_r1_s1", type: "text", sample: "Card", max_chars: 40, html: false }],
            samples: [{ about_r1_s1: "Sample" }],
          }],
        },
      ],
    };
    const compiled: CompiledTemplate = {
      manifest: repeatManifest,
      pages: { "about.html": `<html><body><div><!--@repeat:about_r1--></div></body></html>` },
      fragments: { about_r1: `<div>{{slot:about_r1_s1}}</div>` },
      assets: {},
    };

    const state = emptyFakeAdminState();
    const admin = makeFakeAdmin(state);
    await savePackage(admin, "tpl2", compiled);
    state.templates["tpl2"] = { manifest: repeatManifest };
    state.leads["lead2"] = { id: "lead2", business_name: "Acme" };

    // Bypass prepare/write: construct a row already past write, with the
    // repeat region left under-filled, to exercise render's own defensive
    // check (rather than write's, which is covered above) in isolation.
    const row = freshRow({
      id: "run2", lead_id: "lead2", template_id: "tpl2",
      status: "writing",
      content_doc: { identity: {}, theme: {}, pages: [{ page_id: "about", title: "About", slots: {}, repeats: {} }] },
    });
    state.runs["run2"] = row as unknown as Record<string, unknown>;

    const result = await runStep(admin, row, { aiCall: genericAiCall, now: NOW });
    expect(result.done).toBe(false);
    expect(result.row.status).toBe("failed");
    expect(result.row.error).toContain("about_r1");
    expect(state.events.some((e) => e.level === "error" && e.step === "render")).toBe(true);
  });
});

describe("runStep — prepare fails fast on an identity key the lead can't supply", () => {
  it("refuses before any AI call is made, naming what's missing in plain terms", async () => {
    const compiled = compileTemplate(fixtureZip("plumberpro"), "plumberpro").template;
    const state = emptyFakeAdminState();
    const admin = makeFakeAdmin(state);
    await savePackage(admin, "tpl-pp", compiled);
    state.templates["tpl-pp"] = { manifest: compiled.manifest };
    // sparse: name + phone only — no email, no map link (plumberpro's
    // fixture references {{id:email}}, {{id:email_href}} and {{id:map_embed}}).
    state.leads["lead-sparse"] = { id: "lead-sparse", business_name: "Sparse Plumbing", business_phone: "(512) 555-0000" };
    state.runs["run-sparse"] = freshRow({ id: "run-sparse", lead_id: "lead-sparse", template_id: "tpl-pp" }) as unknown as Record<string, unknown>;

    const calls: string[] = [];
    const spyAiCall: AiCall = async (_s, u) => {
      calls.push(u);
      return { text: "{}" };
    };

    const row = state.runs["run-sparse"] as unknown as StudioRunRow;
    const result = await runStep(admin, row, { aiCall: spyAiCall, now: NOW });

    expect(result.row.status).toBe("failed");
    expect(result.row.error).toMatch(/email/i);
    expect(result.row.error).toMatch(/map/i);
    expect(calls).toHaveLength(0); // the whole point: no AI call was ever made
    expect(state.events.some((e) => e.step === "prepare" && e.level === "error")).toBe(true);
  });
});

describe("runStep — full happy path", () => {
  it("reaches ready with a non-empty, real client site zip (plumberpro fixture)", async () => {
    const compiled = compileTemplate(fixtureZip("plumberpro"), "plumberpro").template;
    const state = emptyFakeAdminState();
    const admin = makeFakeAdmin(state);
    await savePackage(admin, "tpl-pp2", compiled);
    state.templates["tpl-pp2"] = { manifest: compiled.manifest };
    state.leads["lead-complete"] = {
      id: "lead-complete",
      business_name: "Reliable Plumbing Co",
      business_phone: "(512) 555-1212",
      business_email: "hello@reliableplumbing.com",
      map_embed_link: "https://www.google.com/maps/embed?pb=xyz",
      services: ["Drain Cleaning", "Water Heaters"],
      service_areas: ["Austin"],
      client_experience: 15,
      about_business: "Family owned since 2010.",
    };
    state.runs["run-complete"] = freshRow({ id: "run-complete", lead_id: "lead-complete", template_id: "tpl-pp2" }) as unknown as Record<string, unknown>;

    let row = state.runs["run-complete"] as unknown as StudioRunRow;
    const deps: RunStepDeps = { aiCall: genericAiCall, now: NOW };
    for (let i = 0; i < 10; i++) {
      const result = await runStep(admin, row, deps);
      row = result.row;
      if (result.done) break;
    }

    expect(row.status).toBe("ready");
    expect(row.zip_path).toBe("run-complete/site.zip");
    expect(() => contentDocSchema.parse(row.content_doc)).not.toThrow();

    const zipBytes = state.storage[`studio-sites/${row.zip_path}`];
    expect(zipBytes).toBeTruthy();
    expect(zipBytes!.length).toBeGreaterThan(0);

    const files = unzipToMap(zipBytes!);
    const index = dec(files["index.html"]);
    expect(index).toContain("Reliable Plumbing Co");
    expect(index).not.toContain("PlumberPro");
    expect(index).not.toMatch(/\{\{|<!--@/);
  });
});
