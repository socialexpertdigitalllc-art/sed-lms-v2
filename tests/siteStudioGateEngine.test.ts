import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runStep, setRunPaused, type RunStepDeps } from "@/lib/site-studio/run/engine";
import type { AiCall } from "@/lib/site-studio/run/writer";
import type { StudioRunRow } from "@/lib/site-studio/run/types";
import { canCancel } from "@/lib/site-studio/run/types";
import type { CompiledTemplate, TemplateManifest } from "@/lib/site-studio/schema";
import { savePackage } from "@/lib/site-studio/service/templates";
import { emptyFakeAdminState, makeFakeAdmin, type FakeAdminState } from "./helpers/fakeStudioAdmin";

const NOW = () => new Date("2026-01-01T00:00:00.000Z");

/** Same generic stub Writer used throughout the 3a engine suite: reads every
 *  text-slot id and every repeat block straight out of its own prompt, so no
 *  network is ever involved and no repeat region is ever under-filled. */
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

const onePageManifest: TemplateManifest = {
  engine: 3, name: "gate-engine-test", version: 1,
  identity: {},
  theme: { mode: "none", roles: {} },
  nav: [],
  pages: [{
    id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Home",
    slots: [
      { id: "index_s1", type: "text", sample: "Welcome", max_chars: 60, html: false },
      { id: "index_i1", type: "image", sample: "img/hero.jpg", html: false },
    ],
    repeats: [],
  }],
};

const onePageCompiled: CompiledTemplate = {
  manifest: onePageManifest,
  pages: {
    "index.html": `<html><head><title>{{title}}</title></head><body><h1>{{slot:index_s1}}</h1><img src="{{img:index_i1}}"></body></html>`,
  },
  fragments: {},
  assets: {},
};

async function seedOnePageAdmin(): Promise<{ state: FakeAdminState; admin: ReturnType<typeof makeFakeAdmin> }> {
  const state = emptyFakeAdminState();
  const admin = makeFakeAdmin(state);
  await savePackage(admin, "tpl-gate", onePageCompiled);
  state.templates["tpl-gate"] = { manifest: onePageManifest };
  state.leads["lead-gate"] = { id: "lead-gate", business_name: "Gatekeeper Co" };
  state.runs["run1"] = freshRow() as unknown as Record<string, unknown>;
  return { state, admin };
}

function freshRow(overrides: Partial<StudioRunRow> = {}): StudioRunRow {
  return {
    id: "run1",
    lead_id: "lead-gate",
    template_id: "tpl-gate",
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
    paused: false,
    created_by: null,
    created_at: NOW().toISOString(),
    updated_at: NOW().toISOString(),
    ...overrides,
  };
}

const twoPageManifest: TemplateManifest = {
  engine: 3, name: "gate-engine-idempotency-test", version: 1,
  identity: {},
  theme: { mode: "none", roles: {} },
  nav: [],
  pages: [
    {
      id: "index", file: "index.html", kind: "home", stampable: false,
      title_sample: "Home",
      slots: [
        { id: "index_s1", type: "text", sample: "Welcome", max_chars: 60, html: false },
        { id: "index_i1", type: "image", sample: "img/team-photo.jpg", html: false },
      ],
      repeats: [],
    },
    {
      id: "about", file: "about.html", kind: "about", stampable: false,
      title_sample: "About",
      slots: [
        { id: "about_s1", type: "text", sample: "Our story", max_chars: 60, html: false },
        { id: "about_i1", type: "image", sample: "img/office.jpg", html: false },
      ],
      repeats: [],
    },
  ],
};

const twoPageCompiled: CompiledTemplate = {
  manifest: twoPageManifest,
  pages: {
    "index.html": `<html><head><title>{{title}}</title></head><body><h1>{{slot:index_s1}}</h1><img src="{{img:index_i1}}"></body></html>`,
    "about.html": `<html><head><title>{{title}}</title></head><body><p>{{slot:about_s1}}</p><img src="{{img:about_i1}}"></body></html>`,
  },
  fragments: {},
  assets: {},
};

async function seedTwoPageAdmin(): Promise<{ state: FakeAdminState; admin: ReturnType<typeof makeFakeAdmin> }> {
  const state = emptyFakeAdminState();
  const admin = makeFakeAdmin(state);
  await savePackage(admin, "tpl-gate-2", twoPageCompiled);
  state.templates["tpl-gate-2"] = { manifest: twoPageManifest };
  state.leads["lead-gate-2"] = { id: "lead-gate-2", business_name: "Two Page Co" };
  state.runs["run2"] = {
    ...freshRow(),
    id: "run2", lead_id: "lead-gate-2", template_id: "tpl-gate-2",
  } as unknown as Record<string, unknown>;
  return { state, admin };
}

const noPexels = async () => ({ ok: false as const, error: "no pexels in this test" });

const galleryManifest: TemplateManifest = {
  engine: 3, name: "gate-engine-gallery-test", version: 1,
  identity: {},
  theme: { mode: "none", roles: {} },
  nav: [],
  pages: [
    {
      id: "index", file: "index.html", kind: "home", stampable: false,
      title_sample: "Home",
      slots: [
        { id: "index_s1", type: "text", sample: "Welcome", max_chars: 60, html: false },
        { id: "index_i1", type: "image", sample: "img/hero.jpg", html: false },
      ],
      repeats: [],
    },
    {
      id: "gallery", file: "gallery.html", kind: "gallery", stampable: false,
      title_sample: "Gallery",
      slots: [
        { id: "gal_i1", type: "image", sample: "img/gal1.jpg", html: false },
        { id: "gal_i2", type: "image", sample: "img/gal2.jpg", html: false },
      ],
      repeats: [],
    },
  ],
};

const galleryCompiled: CompiledTemplate = {
  manifest: galleryManifest,
  pages: {
    "index.html": `<html><head><title>{{title}}</title></head><body><h1>{{slot:index_s1}}</h1><img src="{{img:index_i1}}"></body></html>`,
    "gallery.html": `<html><head><title>{{title}}</title></head><body><img src="{{img:gal_i1}}"><img src="{{img:gal_i2}}"></body></html>`,
  },
  fragments: {},
  assets: {},
};

async function seedGalleryAdmin(clientPhotos: string[]): Promise<{ state: FakeAdminState; admin: ReturnType<typeof makeFakeAdmin> }> {
  const state = emptyFakeAdminState();
  const admin = makeFakeAdmin(state);
  await savePackage(admin, "tpl-gallery", galleryCompiled);
  state.templates["tpl-gallery"] = { manifest: galleryManifest };
  state.leads["lead-gallery"] = { id: "lead-gallery", business_name: "Gallery Co", image_links: clientPhotos };
  state.runs["run-gallery"] = {
    ...freshRow(),
    id: "run-gallery", lead_id: "lead-gallery", template_id: "tpl-gallery",
  } as unknown as Record<string, unknown>;
  return { state, admin };
}

const jpegResponse = (bytes = new Uint8Array([1, 2, 3])) =>
  new Response(bytes.slice().buffer as ArrayBuffer, { status: 200, headers: { "content-type": "image/jpeg" } });

describe("Gate 1 — prepare fills the gallery from the lead's own photos (Task 2, Phase 4c)", () => {
  it("rehosts each client photo (kind:'client', this lead, source:'client_link') and writes asset:{id} into gallery-kind image slots, in order", async () => {
    const photos = ["https://client.example/photo-1.jpg", "https://client.example/photo-2.jpg"];
    const { state, admin } = await seedGalleryAdmin(photos);
    const row = state.runs["run-gallery"] as unknown as StudioRunRow;
    const fetchImpl = async () => jpegResponse();

    const result = await runStep(admin, row, { aiCall: genericAiCall, now: NOW, fetchImpl });
    const prepared = result.row;

    expect(prepared.status).toBe("preparing");
    const galleryPage = prepared.content_doc!.pages.find((p) => p.page_id === "gallery")!;
    expect(galleryPage.slots.gal_i1).toMatch(/^asset:/);
    expect(galleryPage.slots.gal_i2).toMatch(/^asset:/);
    expect(galleryPage.slots.gal_i1).not.toBe(galleryPage.slots.gal_i2);

    const asset1Id = galleryPage.slots.gal_i1.replace("asset:", "");
    const asset2Id = galleryPage.slots.gal_i2.replace("asset:", "");
    const asset1 = state.studio_assets[asset1Id] as Record<string, unknown>;
    const asset2 = state.studio_assets[asset2Id] as Record<string, unknown>;
    expect(asset1.kind).toBe("client");
    expect(asset1.lead_id).toBe("lead-gallery");
    expect(asset1.source).toBe("client_link");
    expect(asset2.kind).toBe("client");

    // Non-gallery page's image slot is untouched by this fill.
    const indexPage = prepared.content_doc!.pages.find((p) => p.page_id === "index")!;
    expect(indexPage.slots.index_i1).toBe("img/hero.jpg");
  });

  it("stamps a placed slot's provenance 'operator', so a later re-roll can't overwrite it", async () => {
    const photos = ["https://client.example/photo-1.jpg"];
    const { state, admin } = await seedGalleryAdmin(photos);
    const row = state.runs["run-gallery"] as unknown as StudioRunRow;
    const fetchImpl = async () => jpegResponse();

    const result = await runStep(admin, row, { aiCall: genericAiCall, now: NOW, fetchImpl });
    const provenance = (result.row.content_doc as unknown as { provenance: { slots: Record<string, { written_by: string }> }[] }).provenance;
    const galleryIndex = result.row.content_doc!.pages.findIndex((p) => p.page_id === "gallery");
    expect(provenance[galleryIndex].slots.gal_i1.written_by).toBe("operator");
  });

  it("a slot with no corresponding photo (more slots than photos) keeps the template's own sample image", async () => {
    const photos = ["https://client.example/photo-1.jpg"]; // only one photo, two gallery slots
    const { state, admin } = await seedGalleryAdmin(photos);
    const row = state.runs["run-gallery"] as unknown as StudioRunRow;
    const fetchImpl = async () => jpegResponse();

    const result = await runStep(admin, row, { aiCall: genericAiCall, now: NOW, fetchImpl });
    const galleryPage = result.row.content_doc!.pages.find((p) => p.page_id === "gallery")!;
    expect(galleryPage.slots.gal_i1).toMatch(/^asset:/);
    expect(galleryPage.slots.gal_i2).toBe("img/gal2.jpg"); // unchanged — no second photo to place
  });

  it("a photo that fails to rehost is skipped, warned by name, and does NOT fail the run", async () => {
    const photos = ["https://client.example/broken.jpg", "https://client.example/photo-2.jpg"];
    const { state, admin } = await seedGalleryAdmin(photos);
    const row = state.runs["run-gallery"] as unknown as StudioRunRow;
    let call = 0;
    const fetchImpl = async () => {
      call++;
      if (call === 1) return new Response(null, { status: 500 });
      return jpegResponse();
    };

    const result = await runStep(admin, row, { aiCall: genericAiCall, now: NOW, fetchImpl });
    expect(result.row.status).toBe("preparing"); // never fails the run
    const galleryPage = result.row.content_doc!.pages.find((p) => p.page_id === "gallery")!;
    expect(galleryPage.slots.gal_i1).toBe("img/gal1.jpg"); // failed photo left the sample in place
    expect(galleryPage.slots.gal_i2).toMatch(/^asset:/); // the second photo still placed

    const warnEvent = state.events.find(
      (e) => e.step === "prepare" && e.level === "warn" && String(e.message).includes("https://client.example/broken.jpg"),
    );
    expect(warnEvent).toBeTruthy();
  });

  it("no gallery-kind page: photos are left for the picker, and a warn records that they weren't placed", async () => {
    const photos = ["https://client.example/photo-1.jpg"];
    const state = emptyFakeAdminState();
    const admin = makeFakeAdmin(state);
    await savePackage(admin, "tpl-gate", onePageCompiled); // no gallery page in this fixture
    state.templates["tpl-gate"] = { manifest: onePageManifest };
    state.leads["lead-gate"] = { id: "lead-gate", business_name: "Gatekeeper Co", image_links: photos };
    state.runs["run1"] = freshRow() as unknown as Record<string, unknown>;

    const fetchImpl = async () => jpegResponse();
    const result = await runStep(admin, state.runs["run1"] as unknown as StudioRunRow, { aiCall: genericAiCall, now: NOW, fetchImpl });

    expect(result.row.status).toBe("preparing");
    const indexPage = result.row.content_doc!.pages.find((p) => p.page_id === "index")!;
    expect(indexPage.slots.index_i1).toBe("img/hero.jpg"); // untouched

    const warnEvent = state.events.find(
      (e) => e.step === "prepare" && e.level === "warn" && String(e.message).toLowerCase().includes("gallery"),
    );
    expect(warnEvent).toBeTruthy();
  });

  it("no client photos at all: gallery slots simply keep their sample images, no warn logged", async () => {
    const { state, admin } = await seedGalleryAdmin([]);
    const row = state.runs["run-gallery"] as unknown as StudioRunRow;
    const fetchImpl = async () => jpegResponse();

    const result = await runStep(admin, row, { aiCall: genericAiCall, now: NOW, fetchImpl });
    const galleryPage = result.row.content_doc!.pages.find((p) => p.page_id === "gallery")!;
    expect(galleryPage.slots.gal_i1).toBe("img/gal1.jpg");
    expect(galleryPage.slots.gal_i2).toBe("img/gal2.jpg");
    expect(state.events.some((e) => e.step === "prepare" && e.level === "warn")).toBe(false);
  });
});

describe("Gate 1 — write completion parks the machine at 'reviewing'", () => {
  it("all pages written + images sourced -> status 'reviewing'; a further step is a safe no-op (the machine cannot cross the gate)", async () => {
    const { state, admin } = await seedOnePageAdmin();
    let row = state.runs["run1"] as unknown as StudioRunRow;
    const deps: RunStepDeps = { aiCall: genericAiCall, now: NOW, searchPexels: noPexels };

    row = (await runStep(admin, row, deps)).row; // prepare
    expect(row.status).toBe("preparing");

    row = (await runStep(admin, row, deps)).row; // write
    expect(row.status).toBe("reviewing");
    expect(row.steps.images?.slots["0:index_i1"]).toBeTruthy();
    expect(state.events.some((e) => e.message === "gate_opened")).toBe(true);

    const stuck = await runStep(admin, row, deps);
    expect(stuck.done).toBe(true);
    expect(stuck.claimed).toBe(true);
    expect(stuck.row.status).toBe("reviewing"); // unchanged — nextStep("reviewing") is null
  });
});

describe("Gate 1 — options.auto skips the park", () => {
  it("reaches 'approved' directly (no gate_opened event) and the next step renders", async () => {
    const { state, admin } = await seedOnePageAdmin();
    let row = state.runs["run1"] as unknown as StudioRunRow;
    row.options = { auto: true };
    const deps: RunStepDeps = { aiCall: genericAiCall, now: NOW, searchPexels: noPexels };

    row = (await runStep(admin, row, deps)).row; // prepare
    row = (await runStep(admin, row, deps)).row; // write
    expect(row.status).toBe("approved");
    expect(state.events.some((e) => e.message === "gate_skipped_auto")).toBe(true);
    expect(state.events.some((e) => e.message === "gate_opened")).toBe(false);

    const rendered = await runStep(admin, row, deps);
    expect(rendered.row.status).toBe("rendering");
  });
});

describe("Gate 1 — image sourcing is an enhancement, never a cause of run failure", () => {
  it("a total Pexels failure still reaches 'reviewing' with every slot key present and exactly one warn logged", async () => {
    const { state, admin } = await seedOnePageAdmin();
    let row = state.runs["run1"] as unknown as StudioRunRow;
    let searchCalls = 0;
    const failingSearch = async () => {
      searchCalls++;
      return { ok: false as const, error: "pexels is down" };
    };
    const deps: RunStepDeps = { aiCall: genericAiCall, now: NOW, searchPexels: failingSearch };

    row = (await runStep(admin, row, deps)).row; // prepare
    row = (await runStep(admin, row, deps)).row; // write

    expect(row.status).toBe("reviewing");
    expect(searchCalls).toBeGreaterThan(0);
    expect(row.steps.images?.slots["0:index_i1"]).toBeTruthy();
    expect(row.steps.images!.slots["0:index_i1"].candidates).toEqual([]);
    const warnEvents = state.events.filter(
      (e) => e.step === "write" && e.level === "warn" && String(e.message).toLowerCase().includes("pexels"),
    );
    expect(warnEvents).toHaveLength(1);
  });

  it("with no searchPexels configured at all, sourcing degrades to empty candidates rather than throwing", async () => {
    const { state, admin } = await seedOnePageAdmin();
    let row = state.runs["run1"] as unknown as StudioRunRow;
    const deps: RunStepDeps = { aiCall: genericAiCall, now: NOW }; // no searchPexels supplied

    row = (await runStep(admin, row, deps)).row; // prepare
    row = (await runStep(admin, row, deps)).row; // write

    expect(row.status).toBe("reviewing");
    expect(row.steps.images?.slots["0:index_i1"].candidates).toEqual([]);
    expect(state.events.some((e) => e.step === "write" && e.level === "error")).toBe(false);
  });
});

describe("Gate 1 — image sourcing is idempotent across a crash-retry", () => {
  it("a write retry (one page failed, the other already written) does not re-query already-sourced slots", async () => {
    const { state, admin } = await seedTwoPageAdmin();
    let row = state.runs["run2"] as unknown as StudioRunRow;

    const searchCalls: string[] = [];
    const searchPexels = async (query: string) => {
      searchCalls.push(query);
      return { ok: false as const, error: "n/a" };
    };

    row = (await runStep(admin, row, { aiCall: genericAiCall, now: NOW, searchPexels })).row; // prepare

    const flaky: AiCall = async (system, user) => {
      if (user.includes("PAGE: about")) return { text: "not json, sorry" };
      return genericAiCall(system, user);
    };
    row = (await runStep(admin, row, { aiCall: flaky, searchPexels })).row; // write attempt 1: "about" fails
    expect(row.status).toBe("preparing"); // not all pages written yet -> no gate park
    expect(row.steps.images?.slots["0:index_i1"]).toBeTruthy();
    expect(row.steps.images?.slots["1:about_i1"]).toBeTruthy();
    const callsAfterFirstAttempt = searchCalls.length;
    expect(callsAfterFirstAttempt).toBeGreaterThan(0);

    row = (await runStep(admin, row, { aiCall: genericAiCall, searchPexels })).row; // write attempt 2: "about" succeeds
    expect(row.status).toBe("reviewing");
    // the crash-retry re-ran the write step, but images were already
    // sourced on the first attempt — no NEW Pexels queries were issued.
    expect(searchCalls.length).toBe(callsAfterFirstAttempt);
  });
});

describe("Gate 1 — pause short-circuits before any claim or AI call", () => {
  it("paused:true returns {done:false, paused:true} immediately: no claim, no AI call", async () => {
    const { state, admin } = await seedOnePageAdmin();
    const row = state.runs["run1"] as unknown as StudioRunRow;
    row.paused = true;
    const untouchedUpdatedAt = row.updated_at;

    let calls = 0;
    const spy: AiCall = async (s, u) => { calls++; return genericAiCall(s, u); };

    const result = await runStep(admin, row, { aiCall: spy, now: NOW });
    expect(result.done).toBe(false);
    expect(result.paused).toBe(true);
    expect(result.claimed).toBe(false);
    expect(calls).toBe(0);
    expect((state.runs["run1"] as unknown as StudioRunRow).updated_at).toBe(untouchedUpdatedAt);
  });
});

describe("setRunPaused — bumps updated_at (contract: claimRun's CAS depends on this)", () => {
  it("pausing changes updated_at, so a stale-read step cannot win a claim after the pause", async () => {
    const { state, admin } = await seedOnePageAdmin();
    const row = state.runs["run1"] as unknown as StudioRunRow;
    const before = row.updated_at;

    const paused = await setRunPaused(admin, row, true);
    expect(paused.paused).toBe(true);
    expect(paused.updated_at).not.toBe(before);

    const resumed = await setRunPaused(admin, paused, false);
    expect(resumed.paused).toBe(false);
    expect(resumed.updated_at).not.toBe(paused.updated_at);
  });
});

describe("Gate 1 — cancel from the gate", () => {
  it("canCancel allows leaving 'reviewing'; once cancelled the engine treats it as terminal, a safe no-op", async () => {
    const { state, admin } = await seedOnePageAdmin();
    let row = state.runs["run1"] as unknown as StudioRunRow;
    const deps: RunStepDeps = { aiCall: genericAiCall, now: NOW, searchPexels: noPexels };

    row = (await runStep(admin, row, deps)).row; // prepare
    row = (await runStep(admin, row, deps)).row; // write -> reviewing
    expect(row.status).toBe("reviewing");
    expect(canCancel(row.status)).toBe(true);

    // Simulate the control route (Task 9, out of scope for the engine):
    // sets status "cancelled" directly.
    state.runs["run1"] = { ...(state.runs["run1"] as Record<string, unknown>), status: "cancelled" };
    row = state.runs["run1"] as unknown as StudioRunRow;

    let calls = 0;
    const spy: AiCall = async (s, u) => { calls++; return genericAiCall(s, u); };
    const result = await runStep(admin, row, { aiCall: spy });
    expect(result.done).toBe(true);
    expect(result.claimed).toBe(true);
    expect(result.row.status).toBe("cancelled");
    expect(calls).toBe(0);
  });
});

describe("persistRun's terminal guard — a mid-step cancel is never resurrected by that step's own persist", () => {
  it("a cancel that lands while finalize's zip upload is in flight is NOT overwritten back to 'ready'", async () => {
    const { state, admin: baseAdmin } = await seedOnePageAdmin();
    let row = state.runs["run1"] as unknown as StudioRunRow;
    const deps: RunStepDeps = { aiCall: genericAiCall, now: NOW, searchPexels: noPexels };

    row = (await runStep(baseAdmin, row, deps)).row; // prepare
    row = (await runStep(baseAdmin, row, deps)).row; // write -> reviewing
    state.runs["run1"] = { ...(state.runs["run1"] as Record<string, unknown>), status: "approved" };
    row = state.runs["run1"] as unknown as StudioRunRow;
    row = (await runStep(baseAdmin, row, deps)).row; // render -> rendering
    expect(row.status).toBe("rendering");

    // Wrap storage.upload so the INSTANT finalize starts uploading the zip
    // (mid-step, after claimRun already succeeded for this call), a
    // concurrent cancel lands — exactly the "control route cancels while
    // finalize is mid-upload" scenario Fix 3 closes. claimRun's own CAS
    // cannot see this: it already ran, before this race, for this call.
    const racyAdmin = {
      ...baseAdmin,
      storage: {
        from: (bucket: string) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const real = (baseAdmin as any).storage.from(bucket);
          if (bucket !== "studio-sites") return real;
          return {
            ...real,
            upload: async (...args: unknown[]) => {
              state.runs["run1"] = {
                ...(state.runs["run1"] as Record<string, unknown>),
                status: "cancelled",
                updated_at: new Date(Date.now() + 1).toISOString(),
              };
              return real.upload(...args);
            },
          };
        },
      },
    } as unknown as SupabaseClient;

    const result = await runStep(racyAdmin, row, deps); // finalize
    expect(result.claimed).toBe(true); // this call DID win its own claim, before the race
    expect(result.row.status).toBe("cancelled"); // NOT resurrected to "ready"
    expect((state.runs["run1"] as unknown as StudioRunRow).status).toBe("cancelled");

    const abandonEvent = state.events.find(
      (e) => e.step === "finalize" && e.level === "warn" && String(e.message).includes("Abandoned"),
    );
    expect(abandonEvent).toBeTruthy();
  });
});

describe("Gate 1 — full pipeline: park, operator approve, render, finalize (3a behaviours re-asserted)", () => {
  it("after the gate, an approve (simulating the approve route) still lets render/finalize complete with a real zip", async () => {
    const { state, admin } = await seedOnePageAdmin();
    let row = state.runs["run1"] as unknown as StudioRunRow;
    const deps: RunStepDeps = { aiCall: genericAiCall, now: NOW, searchPexels: noPexels };

    row = (await runStep(admin, row, deps)).row; // prepare
    row = (await runStep(admin, row, deps)).row; // write -> reviewing
    expect(row.status).toBe("reviewing");

    // Simulate the approve route: CAS from "reviewing" to "approved".
    state.runs["run1"] = { ...(state.runs["run1"] as Record<string, unknown>), status: "approved" };
    row = state.runs["run1"] as unknown as StudioRunRow;

    row = (await runStep(admin, row, deps)).row; // render
    expect(row.status).toBe("rendering");
    row = (await runStep(admin, row, deps)).row; // finalize
    expect(row.status).toBe("ready");
    expect(row.zip_path).toBe("run1/site.zip");
    expect(state.storage["studio-sites/run1/site.zip"]?.length).toBeGreaterThan(0);
  });
});
