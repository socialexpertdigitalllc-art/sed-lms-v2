// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";

/**
 * /api/leads/[id]/logo/*: the people who may edit the lead's logo link may
 * generate one (leads.edit + their lead, all leads, or the closer acting for
 * its agent); one round at a time per lead; per-person and company limits;
 * Accept uploads to the image host and fills logo_link.
 */

const state = vi.hoisted(() => ({
  user: { id: "U1" } as { id: string } | null,
  perms: new Set<string>(["leads.edit"]),
  closer: false,
  minimax: true,
  db: null as unknown as MemoryDb,
  after: [] as (() => unknown)[],
  upload: { directUrl: "https://i.ibb.co/abc/abc-roofing-llc-logo.png", hostId: "h1", provider: "imgbb", attempts: [], lastError: null } as Record<string, unknown>,
  stored: Buffer.alloc(0) as Buffer,
}));
const mocks = vi.hoisted(() => ({ run: vi.fn(async () => {}), chain: vi.fn() }));

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => state.after.push(fn) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db.client }));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => state.perms }));
vi.mock("@/lib/teams/closers", () => ({
  canActForAgent: async () => state.closer,
  actingAs: (actor: string, agent: string | null) => (agent && agent !== actor ? { as: "closer", on_behalf_of: agent, performed_by: actor } : null),
}));
vi.mock("@/lib/logos/deps", async () => {
  const { LogoError } = await import("@/lib/logos/store");
  return {
    minimaxSpec: async () => {
      if (!state.minimax) throw new LogoError("MiniMax isn't set up — an admin needs to add its API key under Admin → AI providers.", 503);
      return { endpoint: "https://api.minimax.io/v1/chat/completions", apiKey: "k" };
    },
    productionLogoDeps: () => ({ deps: true }),
    logoStorage: () => ({ get: async () => state.stored }),
  };
});
vi.mock("@/lib/logos/runner", () => ({ runLogoGeneration: mocks.run }));
vi.mock("@/lib/photo-capture/hosts/chain", () => ({ runUploadChain: mocks.chain }));
vi.mock("@/lib/photo-capture/hosts/config", () => ({ listImageHosts: async () => [], imageHostStateStore: () => ({}) }));

import { GET, POST } from "@/app/api/leads/[id]/logo/route";
import { GET as GET_ONE } from "@/app/api/leads/[id]/logo/[genId]/route";
import { POST as CANCEL } from "@/app/api/leads/[id]/logo/[genId]/cancel/route";
import { POST as ACCEPT } from "@/app/api/leads/[id]/logo/[genId]/accept/route";
import { LOGO_TABLE, LOGO_HOURLY_LIMIT } from "@/lib/logos/store";

const GEN = "11111111-1111-4111-8111-111111111111";
const lead = { id: "L1", business_name: "ABC Roofing LLC", logo_link: null as string | null, agent_id: "U1", services: ["Roofing"], category: "Roofing", about_business: null, color_scheme: "navy, orange", deleted_at: null };
const cand = (index: number, score: number) => ({
  index, concept: 0, seed: 7, round: 1, prompt: "p", path: `lead-logos/L1/${GEN}/${index + 1}.png`, url: `https://cdn/${index + 1}.png`, width: 900, height: 300, aspect: 3,
  horizontal: true, transparent: true, background: "removed", colors: { present: [], missing: [], offPalette: 0, dominant: [] }, check: { verdict: "exact", read: "ABC ROOFING", extra: [], issues: [], quality: 8 }, score,
});
const readyGen = (over: Record<string, unknown> = {}) => ({
  id: GEN, lead_id: "L1", user_id: "U1", mode: "new", parent_id: null, parent_index: null, instructions: null, logo_text: "ABC Roofing", status: "ready", stage: null,
  concepts: [{ title: "Roof", idea: "i", symbol: "s", typography: "t", layout: "icon-left", colorUse: "c" }], candidates: [cand(0, 100), cand(1, 160)], notes: [], images_drawn: 2,
  error: null, accepted_index: null, accepted_url: null, accepted_at: null, heartbeat_at: new Date().toISOString(), finished_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over,
});

const ctx = { params: Promise.resolve({ id: "L1" }) };
const genCtx = { params: Promise.resolve({ id: "L1", genId: GEN }) };
const post = (body: unknown) => new Request("http://x/api/leads/L1/logo", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  state.user = { id: "U1" };
  state.perms = new Set(["leads.edit"]);
  state.closer = false;
  state.minimax = true;
  state.after = [];
  state.db = memorySupabase({ leads: [{ ...lead }], [LOGO_TABLE]: [], activity_log: [] }, { [LOGO_TABLE]: () => ({ id: crypto.randomUUID(), candidates: [], concepts: [], notes: [], images_drawn: 0, accepted_index: null }) });
  mocks.run.mockClear();
  mocks.chain.mockReset();
  mocks.chain.mockImplementation(async () => state.upload);
});

describe("who may generate", () => {
  it("needs leads.edit, and the lead must be theirs (or all leads, or the closer acting for its agent)", async () => {
    state.user = null;
    expect((await POST(post({ mode: "new" }), ctx)).status).toBe(401);
    state.user = { id: "U1" };
    state.perms = new Set();
    expect((await POST(post({ mode: "new" }), ctx)).status).toBe(403);
    state.perms = new Set(["leads.edit"]);
    state.db.tables.leads[0].agent_id = "SOMEONE";
    expect((await POST(post({ mode: "new" }), ctx)).status).toBe(403);
    state.closer = true;
    expect((await POST(post({ mode: "new" }), ctx)).status).toBe(201);
  });

  it("a deleted lead is not found", async () => {
    state.db.tables.leads[0].deleted_at = "2026-10-01T00:00:00Z";
    expect((await GET(new Request("http://x"), ctx)).status).toBe(404);
  });
});

describe("POST /logo — start a round", () => {
  it("starts it (the words default to the name without LLC) and runs it after the response", async () => {
    const res = await POST(post({ mode: "new" }), ctx);
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j).toMatchObject({ created: true, generation: { status: "running", stage: "concepts", logoText: "ABC Roofing", mode: "new" } });
    expect(state.db.tables[LOGO_TABLE]).toHaveLength(1);
    expect(state.after).toHaveLength(1);
    await state.after[0]();
    expect(mocks.run).toHaveBeenCalledWith(j.generation.id, { deps: true });
  });

  it("one at a time per lead: a second press shows the running one", async () => {
    await POST(post({ mode: "new" }), ctx);
    const again = await POST(post({ mode: "idea", instructions: "a shield" }), ctx);
    expect(again.status).toBe(200);
    expect((await again.json()).created).toBe(false);
    expect(state.db.tables[LOGO_TABLE]).toHaveLength(1);
    expect(state.after).toHaveLength(1);
  });

  it("a round that died with the server doesn't block a new one", async () => {
    state.db.tables[LOGO_TABLE].push(readyGen({ status: "running", heartbeat_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" }));
    const res = await POST(post({ mode: "new" }), ctx);
    expect(res.status).toBe(201);
    expect(state.db.tables[LOGO_TABLE].find((r) => r.id === GEN)).toMatchObject({ status: "failed", error: expect.stringMatching(/server restarted/) });
  });

  it("refine needs a design that exists and words saying what to change", async () => {
    state.db.tables[LOGO_TABLE].push(readyGen());
    expect((await POST(post({ mode: "refine", parentId: GEN, parentIndex: 1 }), ctx)).status).toBe(422);
    expect((await POST(post({ mode: "refine", parentId: GEN, parentIndex: 9, instructions: "simpler" }), ctx)).status).toBe(404);
    const ok = await POST(post({ mode: "refine", parentId: GEN, parentIndex: 1, instructions: "simpler", logoText: "ABC" }), ctx);
    expect(ok.status).toBe(201);
    expect((await ok.json()).generation).toMatchObject({ mode: "refine", parentId: GEN, parentIndex: 1, instructions: "simpler", logoText: "ABC" });
  });

  it("MiniMax not set up → a clear 503 before anything is stored", async () => {
    state.minimax = false;
    const res = await POST(post({ mode: "new" }), ctx);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/Admin → AI providers/);
    expect(state.db.tables[LOGO_TABLE]).toHaveLength(0);
  });

  it("per-person hourly limit, and the company's daily allowance", async () => {
    const at = new Date().toISOString();
    state.db.tables[LOGO_TABLE] = Array.from({ length: LOGO_HOURLY_LIMIT }, (_, i) => readyGen({ id: `x${i}`, lead_id: `other${i}`, created_at: at, images_drawn: 0 }));
    const limited = await POST(post({ mode: "new" }), ctx);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toMatch(/last hour/);

    state.db.tables[LOGO_TABLE] = [readyGen({ id: "y", lead_id: "other", user_id: "U2", created_at: at, images_drawn: 97 })];
    const spent = await POST(post({ mode: "new" }), ctx);
    expect(spent.status).toBe(429);
    expect((await spent.json()).error).toMatch(/allowance is used up \(100 designs/);
  });

  it("a migration not applied yet says so", async () => {
    const real = state.db.client.from.bind(state.db.client);
    state.db.client.from = ((t: string) => {
      if (t !== LOGO_TABLE) return real(t);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "lt", "gte", "update", "order", "limit"]) b[m] = () => b;
      b.maybeSingle = async () => ({ data: null, error: { message: 'relation "public.lead_logo_generations" does not exist' } });
      b.then = (r: (v: unknown) => unknown) => r({ data: null, error: { message: 'relation "public.lead_logo_generations" does not exist' } });
      return b;
    }) as typeof state.db.client.from;
    const res = await GET(new Request("http://x"), ctx);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/migration 0093/);
  });
});

describe("GET — the rounds, the brief, today's allowance", () => {
  it("newest first, best design first, no storage paths; the colours by name", async () => {
    state.db.tables[LOGO_TABLE].push(readyGen());
    const j = await (await GET(new Request("http://x"), ctx)).json();
    expect(j.generations[0].candidates.map((c: { index: number }) => c.index)).toEqual([1, 0]);
    expect(JSON.stringify(j)).not.toMatch(/lead-logos\//);
    expect(j.brief).toMatchObject({ logoText: "ABC Roofing", colors: [{ name: "navy blue" }, { name: "bright orange" }] });
    expect(j.budget).toEqual({ used: 2, limit: 100 });
    expect((await (await GET_ONE(new Request("http://x"), genCtx)).json()).generation.id).toBe(GEN);
  });
});

describe("cancel", () => {
  it("stops a running round; a finished one is left as it is", async () => {
    state.db.tables[LOGO_TABLE].push(readyGen({ status: "running" }));
    expect((await (await CANCEL(new Request("http://x", { method: "POST" }), genCtx)).json()).generation.status).toBe("cancelled");
    state.db.tables[LOGO_TABLE][0].status = "ready";
    expect((await (await CANCEL(new Request("http://x", { method: "POST" }), genCtx)).json()).generation.status).toBe("ready");
  });
});

describe("accept", () => {
  const accept = (body: unknown) => ACCEPT(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), genCtx);

  beforeEach(async () => {
    state.stored = await sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 30, g: 58, b: 138, alpha: 0.5 } } }).png().toBuffer();
  });

  it("uploads the PNG to the image host and puts the direct link in the logo field", async () => {
    state.db.tables[LOGO_TABLE].push(readyGen());
    const res = await accept({ index: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://i.ibb.co/abc/abc-roofing-llc-logo.png", host: "imgbb" });
    const [source] = mocks.chain.mock.calls[0];
    expect(source).toMatchObject({ filename: "abc-roofing-llc-logo.png", contentType: "image/png", url: state.stored.toString("base64") });
    expect(await source.fetchBytes()).toEqual(state.stored);
    expect(state.db.tables.leads[0].logo_link).toBe("https://i.ibb.co/abc/abc-roofing-llc-logo.png");
    expect(state.db.tables[LOGO_TABLE][0]).toMatchObject({ accepted_index: 1, accepted_url: "https://i.ibb.co/abc/abc-roofing-llc-logo.png" });
    expect(state.db.tables.activity_log[0]).toMatchObject({
      action: "lead.updated", entity_id: "L1", old_value: { logo_link: null },
      new_value: { logo_link: "https://i.ibb.co/abc/abc-roofing-llc-logo.png", via: "logo_generator", design: 2, host: "imgbb" },
    });
  });

  it("'On white' uploads the logo flattened onto white", async () => {
    state.db.tables[LOGO_TABLE].push(readyGen());
    await accept({ index: 0, background: "white" });
    const { data, info } = await sharp(mocks.chain.mock.calls[0][0].fetchBytes ? await mocks.chain.mock.calls[0][0].fetchBytes() : Buffer.alloc(0)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(40);
    expect(data[3]).toBe(255);
  });

  it("every host refused → 502 with the reason; the logo field is untouched", async () => {
    state.db.tables[LOGO_TABLE].push(readyGen());
    mocks.chain.mockImplementation(async () => ({ directUrl: null, hostId: null, provider: null, attempts: [], lastError: "No image host is configured" }));
    const res = await accept({ index: 0 });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/No image host is configured.*Admin → Image hosts/);
    expect(state.db.tables.leads[0].logo_link).toBeNull();
  });

  it("a design that doesn't exist → 404", async () => {
    state.db.tables[LOGO_TABLE].push(readyGen());
    expect((await accept({ index: 7 })).status).toBe(404);
    expect((await accept({})).status).toBe(422);
  });
});
