// tests/siteAgentActions.test.ts
// @vitest-environment node
// Task 10 — the approve / revise / discard action routes. Deliberately a
// SEPARATE file from siteAgentRoutes.test.ts: these routes sit entirely
// behind agentRunAccess (whose real behavior is pinned over there), so the
// gate is mocked here and the mock surface stays small.
import { describe, it, expect, vi, beforeEach } from "vitest";

const accessState = vi.hoisted(() => ({
  errorStatus: null as 401 | 403 | 404 | null,
  run: {} as Record<string, unknown>,
}));
vi.mock("@/lib/site-agent/access", async () => {
  const { NextResponse } = await import("next/server");
  return {
    agentRunAccess: async () => {
      if (accessState.errorStatus) {
        return {
          error: NextResponse.json({ error: "Forbidden" }, { status: accessState.errorStatus }),
          status: accessState.errorStatus,
        };
      }
      return { run: accessState.run, userId: "dev-1", perms: new Set(["tickets.resolve"]) };
    },
  };
});

const deployMock = vi.hoisted(() => ({
  snapshotSite: vi.fn(),
  overrideLiveSite: vi.fn(),
  prepareSiteZip: vi.fn(),
  /** cross-mock journal — pins snapshot-BEFORE-override ordering */
  order: [] as string[],
}));
vi.mock("@/lib/site-studio/deploy/snapshots", () => ({ snapshotSite: deployMock.snapshotSite }));
vi.mock("@/lib/site-studio/deploy/liveFiles", () => ({
  overrideLiveSite: deployMock.overrideLiveSite,
  prepareSiteZip: deployMock.prepareSiteZip,
}));

// CAS-honoring fake admin: an update on site_agent_runs applies against dbRun
// only when EVERY .eq() filter matches the row as it stands NOW — so the
// review→deploying→deployed/back-to-review transitions and their guards
// behave like the real database (a second claim matches zero rows).
const adminState = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  type Result = { data: unknown; error: { message: string } | null };
  type Chain = {
    select: (...a: unknown[]) => Chain;
    eq: (f: string, v: unknown) => Chain;
    update: (values: Row) => Chain;
    insert: (values: Row) => Chain;
    maybeSingle: () => Promise<Result>;
    then: <T>(resolve: (v: Result) => T, reject?: (e: unknown) => T) => Promise<T>;
  };
  const state = {
    dbRun: null as Row | null,
    downloadBlob: null as { arrayBuffer(): Promise<ArrayBuffer> } | null,
    downloads: [] as string[],
    removes: [] as string[][],
    inserts: [] as { table: string; values: Row }[],
    updates: [] as { table: string; values: Row; filters: [string, unknown][] }[],
    client: null as unknown,
    reset() {
      state.dbRun = null;
      state.downloadBlob = { arrayBuffer: async () => new Uint8Array([80, 75, 3, 4]).buffer as ArrayBuffer };
      state.downloads = []; state.removes = []; state.inserts = []; state.updates = [];
    },
  };
  function query(table: string): Chain {
    const filters: [string, unknown][] = [];
    let updateValues: Row | null = null;
    const applyCas = (): { data: { id: unknown } | null } => {
      const row = state.dbRun;
      if (!row || !filters.every(([f, v]) => row[f] === v)) return { data: null };
      Object.assign(row, updateValues);
      return { data: { id: row.id } };
    };
    const record = () => { if (updateValues) state.updates.push({ table, values: updateValues, filters }); };
    const q: Chain = {
      select: () => q,
      eq: (f, v) => { filters.push([f, v]); return q; },
      update: (values) => { updateValues = values; return q; },
      insert: (values) => { state.inserts.push({ table, values }); return q; },
      maybeSingle: async () => {
        if (table === "site_agent_runs" && updateValues) {
          const r = applyCas();
          record();
          return { ...r, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve, reject) => {
        if (updateValues && table === "site_agent_runs") applyCas();
        record();
        return Promise.resolve({ data: null, error: null } as Result).then(resolve, reject);
      },
    };
    return q;
  }
  state.client = {
    from: (table: string) => query(table),
    storage: {
      from: () => ({
        download: async (path: string) => {
          state.downloads.push(path);
          return { data: state.downloadBlob, error: state.downloadBlob ? null : { message: "not found" } };
        },
        remove: (paths: string[]) => { state.removes.push(paths); return Promise.resolve({ data: null, error: null }); },
      }),
    },
  };
  return state;
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminState.client }));

import { POST as approvePOST } from "@/app/api/site-agent/runs/[id]/approve/route";
import { POST as revisePOST } from "@/app/api/site-agent/runs/[id]/revise/route";
import { POST as discardPOST } from "@/app/api/site-agent/runs/[id]/discard/route";

const ctx = (id = "run-1") => ({ params: Promise.resolve({ id }) });
const post = (body?: unknown) =>
  body === undefined
    ? new Request("http://x", { method: "POST" })
    : new Request("http://x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

/** Seed the SAME row into the gate's answer and the fake DB. */
function seedRun(status: string, extra: Record<string, unknown> = {}) {
  const run = {
    id: "run-1", ticket_id: "t-1", lead_id: "lead-1", site_host: "acme.dmviral.com",
    status, claim_id: "claim-1", files: {}, created_by: "dev-1", ...extra,
  };
  accessState.run = run;
  adminState.dbRun = { ...run };
}

beforeEach(() => {
  accessState.errorStatus = null;
  adminState.reset();
  deployMock.order.length = 0;
  deployMock.snapshotSite.mockReset().mockImplementation(async () => {
    deployMock.order.push("snapshot");
    return { ok: true, path: "snapshots/acme.dmviral.com/x.zip", bytes: 10 };
  });
  deployMock.overrideLiveSite.mockReset().mockImplementation(async () => {
    deployMock.order.push("override");
    return { ok: true, host: "acme.dmviral.com", source: "staging", files: 3, sub: "acme" };
  });
  deployMock.prepareSiteZip.mockReset().mockReturnValue({ ok: true, zip: new Uint8Array([80, 75]), files: 3 });
  seedRun("review");
});

describe("POST /api/site-agent/runs/[id]/approve", () => {
  it("deploys a reviewed run: CAS claim, snapshot BEFORE override, proof + history rows, board stamp", async () => {
    const res = await approvePOST(post(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, url: "https://acme.dmviral.com" });

    // CAS review→deploying observed, then the row settles deployed, error cleared
    const cas = adminState.updates[0];
    expect(cas.table).toBe("site_agent_runs");
    expect(cas.values).toMatchObject({ status: "deploying" });
    expect(cas.filters).toContainEqual(["status", "review"]);
    expect(adminState.dbRun).toMatchObject({ status: "deployed", error: null });

    // rollback point is taken before anything on the hosting is replaced
    expect(deployMock.order).toEqual(["snapshot", "override"]);
    expect(adminState.downloads[0]).toBe("run-1/result.zip");

    // ticket proof (the pair the ticket screen queries) + our own history row
    const proof = adminState.inserts.find((i) => i.values.action === "studio.site.files_overridden");
    expect(proof?.values).toMatchObject({ entity_type: "ticket", entity_id: "t-1" });
    expect((proof?.values.new_value as Record<string, unknown>).via).toBe("site_agent");
    expect(adminState.inserts.some((i) => i.values.action === "site_agent.run.deployed")).toBe(true);

    // board stamp mirrors the manual override tail EXACTLY: match by
    // subdomain when present, and only rows whose status is "live"
    const stamp = adminState.updates.find((u) => u.table === "studio_deployments");
    expect(stamp?.values).toMatchObject({ deployed_by: "dev-1" });
    expect(stamp?.filters).toEqual([["subdomain", "acme"], ["status", "live"]]);
  });

  it("409s a run that is not awaiting review, without touching the hosting", async () => {
    seedRun("queued");
    const res = await approvePOST(post(), ctx());
    expect(res.status).toBe(409);
    expect(deployMock.snapshotSite).not.toHaveBeenCalled();
    expect(deployMock.overrideLiveSite).not.toHaveBeenCalled();
    expect(adminState.dbRun?.status).toBe("queued");
  });

  it("500s when the result zip is missing and rolls the run back to review with the error", async () => {
    adminState.downloadBlob = null;
    const res = await approvePOST(post(), ctx());
    expect(res.status).toBe(500);
    expect(adminState.dbRun?.status).toBe("review");
    expect(String(adminState.dbRun?.error)).toMatch(/missing/i);
    expect(deployMock.overrideLiveSite).not.toHaveBeenCalled();
  });

  it("422s when the zip fails validation, rolling back to review", async () => {
    deployMock.prepareSiteZip.mockReturnValue({ ok: false, message: "the zip has no index.html at its root" });
    const res = await approvePOST(post(), ctx());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/no index\.html/);
    expect(adminState.dbRun?.status).toBe("review");
    expect(deployMock.overrideLiveSite).not.toHaveBeenCalled();
  });

  it("relays an override failure's status, rolls back to review, and never flips deployed", async () => {
    deployMock.overrideLiveSite.mockImplementation(async () => {
      deployMock.order.push("override");
      return { ok: false, status: 502, error: "Upload failed at extract: boom" };
    });
    const res = await approvePOST(post(), ctx());
    expect(res.status).toBe(502);
    expect(deployMock.snapshotSite).toHaveBeenCalled();
    expect(adminState.dbRun).toMatchObject({ status: "review", error: "Upload failed at extract: boom" });
    expect(adminState.updates.some((u) => u.values.status === "deployed")).toBe(false);
    expect(adminState.inserts).toHaveLength(0);
  });

  it("a ticketless run deploys without the ticket-proof row but keeps its own history row", async () => {
    seedRun("review", { ticket_id: null });
    const res = await approvePOST(post(), ctx());
    expect(res.status).toBe(200);
    expect(adminState.inserts.some((i) => i.values.action === "studio.site.files_overridden")).toBe(false);
    const own = adminState.inserts.find((i) => i.values.action === "site_agent.run.deployed");
    expect(own?.values).toMatchObject({ entity_id: null });
  });

  it("a failed snapshot warns but never blocks the deploy", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    deployMock.snapshotSite.mockResolvedValue({ ok: false, message: "DA archive timed out" });
    const res = await approvePOST(post(), ctx());
    expect(res.status).toBe(200);
    expect(adminState.dbRun?.status).toBe("deployed");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("POST /api/site-agent/runs/[id]/revise", () => {
  it("requeues a reviewed run with the developer's instructions (log truncated to 500)", async () => {
    const long = "x".repeat(600);
    const res = await revisePOST(post({ instructions: long }), ctx());
    expect(res.status).toBe(200);
    expect(adminState.dbRun).toMatchObject({ status: "queued", instructions: long, error: null });
    const log = adminState.inserts.find((i) => i.values.action === "site_agent.run.revised");
    expect(log?.values).toMatchObject({ entity_type: "ticket", entity_id: "t-1" });
    expect((log?.values.new_value as { instructions: string }).instructions).toHaveLength(500);
  });

  it("422s empty, whitespace-only, and missing instructions without touching the run", async () => {
    for (const body of [{ instructions: "" }, { instructions: "   " }, undefined]) {
      const res = await revisePOST(post(body), ctx());
      expect(res.status).toBe(422);
    }
    expect(adminState.updates).toHaveLength(0);
    expect(adminState.dbRun?.status).toBe("review");
  });

  it("409s when the run is not awaiting review", async () => {
    seedRun("running");
    const res = await revisePOST(post({ instructions: "tweak the hero" }), ctx());
    expect(res.status).toBe(409);
    expect(adminState.dbRun?.status).toBe("running");
    expect(adminState.inserts).toHaveLength(0);
  });

  it("keeps conversation_id on the row — follow-ups continue the SAME agy conversation", async () => {
    seedRun("review", { conversation_id: "conv-9" });
    const res = await revisePOST(post({ instructions: "tweak the hero" }), ctx());
    expect(res.status).toBe(200);
    expect(adminState.dbRun).toMatchObject({ status: "queued", conversation_id: "conv-9" });
  });
});

describe("POST /api/site-agent/runs/[id]/discard", () => {
  it("discards a reviewed run: claim nulled, result zip removed, history row", async () => {
    const res = await discardPOST(post(), ctx());
    expect(res.status).toBe(200);
    expect(adminState.dbRun).toMatchObject({ status: "discarded", claim_id: null });
    expect(adminState.removes[0]).toEqual(["run-1/result.zip"]);
    const log = adminState.inserts.find((i) => i.values.action === "site_agent.run.discarded");
    expect((log?.values.new_value as { from: string }).from).toBe("review");
  });

  it("cancels a RUNNING run by nulling claim_id — the worker's ownership guard (LOAD-BEARING)", async () => {
    seedRun("running", { claim_id: "claim-9" });
    const res = await discardPOST(post(), ctx());
    expect(res.status).toBe(200);
    // The worker.ts contract: a status flip alone would NOT break the worker's
    // guarded writes — the guard filters on claim_id, so it MUST become null.
    const upd = adminState.updates.find((u) => u.table === "site_agent_runs");
    expect(upd?.values).toMatchObject({ status: "discarded", claim_id: null });
    expect(adminState.dbRun?.claim_id).toBeNull();
    const log = adminState.inserts.find((i) => i.values.action === "site_agent.run.discarded");
    expect((log?.values.new_value as { from: string }).from).toBe("running");
  });

  it("409s a terminal run (deployed) without writing anything", async () => {
    seedRun("deployed");
    const res = await discardPOST(post(), ctx());
    expect(res.status).toBe(409);
    expect(adminState.updates).toHaveLength(0);
    expect(adminState.removes).toHaveLength(0);
    expect(adminState.inserts).toHaveLength(0);
  });

  it("409s a FRESH deploying run — a live deploy must finish, not be yanked", async () => {
    seedRun("deploying", { updated_at: new Date().toISOString() });
    const res = await discardPOST(post(), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/in progress/i);
    expect(adminState.updates).toHaveLength(0);
  });

  it("discards a STALE deploying run — the wedged-approve escape hatch", async () => {
    seedRun("deploying", { updated_at: new Date(Date.now() - 11 * 60_000).toISOString() });
    const res = await discardPOST(post(), ctx());
    expect(res.status).toBe(200);
    expect(adminState.dbRun).toMatchObject({ status: "discarded", claim_id: null });
    const log = adminState.inserts.find((i) => i.values.action === "site_agent.run.discarded");
    expect((log?.values.new_value as { from: string }).from).toBe("deploying");
  });
});

describe("the shared access gate fronts all three routes", () => {
  it("propagates the gate's error response verbatim", async () => {
    accessState.errorStatus = 403;
    expect((await approvePOST(post(), ctx())).status).toBe(403);
    expect((await revisePOST(post({ instructions: "x" }), ctx())).status).toBe(403);
    expect((await discardPOST(post(), ctx())).status).toBe(403);
    expect(adminState.updates).toHaveLength(0);
    expect(deployMock.overrideLiveSite).not.toHaveBeenCalled();
  });
});
