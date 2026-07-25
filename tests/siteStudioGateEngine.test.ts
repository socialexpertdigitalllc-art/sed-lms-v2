import { describe, it, expect } from "vitest";
import { runStep, type RunStepDeps } from "@/lib/site-studio/run/engine";
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
