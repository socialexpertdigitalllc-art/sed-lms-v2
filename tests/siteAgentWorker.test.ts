// tests/siteAgentWorker.test.ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { processNextAgentRun, type WorkerDeps } from "@/lib/site-agent/worker";
import type { AgyDriver } from "@/lib/site-agent/agy";
import { zipFromMap } from "@/lib/template-engine/zip";

const enc = (s: string) => new TextEncoder().encode(s);
const SITE = { "index.html": enc("<h1>old</h1>"), "about.html": enc("<p>about</p>") };

/** In-memory stand-in for the service-role client: one runs table honouring
 *  chained .eq filters on update (that is what makes the claim CAS and the
 *  claim_id guard testable), ticket/lead selects, an activity recorder, and a
 *  storage bucket backed by a plain record. */
function makeFakeAdmin(seed: Record<string, Record<string, unknown>>) {
  const runs = { ...seed };
  const storage: Record<string, Uint8Array> = {};
  const activity: { action: string; row: Record<string, unknown> }[] = [];

  const admin = {
    from(table: string) {
      if (table === "app_settings") {
        return { update: () => ({ eq: async () => ({ error: null }) }) };
      }
      if (table === "activity_log") {
        return {
          insert: async (row: Record<string, unknown>) => {
            activity.push({ action: String(row.action), row });
            return { error: null };
          },
        };
      }
      if (table === "lead_tickets") {
        return {
          select: () => ({
            eq: (_c: string, id: string) => ({
              maybeSingle: async () => ({
                data:
                  id === "t-gone"
                    ? null
                    : {
                        id, title: "Fix phone", assigned_to: "dev-1", created_by: "sales-1",
                        lead_id: "lead-1", items: [{ body: "swap number", sort: 0 }],
                      },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "leads") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { business_name: "Acme" }, error: null }) }),
          }),
        };
      }
      if (table !== "site_agent_runs") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          in: (col: string, vals: string[]) => ({
            order: (orderCol: string, opts: { ascending: boolean }) => ({
              limit: async (n: number) => {
                const rows = Object.values(runs)
                  .filter((r) => vals.includes(String(r[col])))
                  .sort((a, b) => String(a[orderCol]).localeCompare(String(b[orderCol])));
                if (opts.ascending === false) rows.reverse();
                return { data: rows.slice(0, n), error: null };
              },
            }),
          }),
        }),
        update(patch: Record<string, unknown>) {
          const filters: [string, unknown][] = [];
          const apply = () => {
            const rows = Object.values(runs).filter((r) => filters.every(([c, v]) => r[c] === v));
            for (const r of rows) Object.assign(r, patch);
            return rows;
          };
          const chain = {
            eq(c: string, v: unknown) { filters.push([c, v]); return chain; },
            select: () => ({
              single: async () => {
                const rows = apply();
                return rows.length === 1
                  ? { data: rows[0], error: null }
                  : { data: null, error: { message: "no rows" } };
              },
              maybeSingle: async () => {
                const rows = apply();
                return { data: rows[0] ?? null, error: null };
              },
            }),
          };
          return chain;
        },
      };
    },
    storage: {
      from: () => ({
        download: async (path: string) =>
          storage[path]
            ? { data: new Blob([storage[path].slice()]), error: null }
            : { data: null, error: { message: "missing" } },
        upload: async (path: string, bytes: Uint8Array | ArrayBuffer) => {
          storage[path] = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
          return { error: null };
        },
        remove: async () => ({ error: null }),
      }),
    },
  };
  return { admin: admin as unknown as SupabaseClient, runs, storage, activity };
}

/** Fake workspace + notify around the fake admin. materialize returns ONE
 *  fixed path and must be called ONCE — the engine passes that cwd to the
 *  driver rather than materializing again. Every workspace call records the
 *  scratch KEY it was given: the engine must use ONE claim-scoped key
 *  (run id + claim prefix) for materialize/collect/cleanup, so a reclaimer
 *  can never wipe a still-live predecessor's dir. Drivers mutate the
 *  in-memory workspace through `mutate` instead of a real fs. */
function makeHarness(fake: ReturnType<typeof makeFakeAdmin>) {
  let files: Record<string, Uint8Array> = {};
  const wsKeys: string[] = [];
  const materialize = vi.fn(async (map: Record<string, Uint8Array>, key: string) => {
    wsKeys.push(key);
    files = { ...map };
    return "C:/scratch/agent-run";
  });
  const notify = vi.fn(async () => {});
  const mutate = (fn: (f: Record<string, Uint8Array>) => void) => fn(files);
  const deps = (driver: AgyDriver): WorkerDeps => ({
    admin: fake.admin,
    driver,
    workspace: {
      materialize,
      collect: async (key: string) => { wsKeys.push(key); return files; },
      cleanup: async (key: string) => { wsKeys.push(key); },
    },
    notify,
    now: () => new Date("2026-09-01T12:00:00Z"),
  });
  return { deps, notify, materialize, mutate, wsKeys };
}

/** For tests where the engine must fail BEFORE ever driving agy. */
const neverDriver: AgyDriver = async () => {
  throw new Error("driver must not run");
};

function seedRun(over: Record<string, unknown> = {}) {
  return {
    "run-1": {
      id: "run-1", ticket_id: "t-1", lead_id: "lead-1", site_host: "acme.dmviral.com",
      status: "queued", claim_id: null, conversation_id: null, instructions: null,
      files: {}, updated_at: "2026-09-01T11:59:00Z", created_at: "2026-09-01T11:58:00Z",
      ...over,
    },
  };
}

describe("processNextAgentRun", () => {
  it("claims a queued run, drives agy in the one materialized cwd, harvests, uploads result.zip, flips to review", async () => {
    const fake = makeFakeAdmin(seedRun());
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);
    let driverCwd = "";

    const out = await processNextAgentRun(h.deps(async (opts, onEvent) => {
      driverCwd = opts.cwd;
      onEvent({ kind: "init", conversationId: "conv-1", permissionMode: "always-proceed" });
      onEvent({ kind: "step", stepType: "tool_call", state: "DONE", index: 1 });
      h.mutate((f) => { f["index.html"] = enc("<h1>new</h1>"); });
      const result = {
        kind: "result" as const, status: "SUCCESS" as const, response: "done", error: null,
        usage: { total_tokens: 100 }, numTurns: 1, durationSeconds: 5,
      };
      onEvent(result);
      return { exitCode: 0, result, conversationId: "conv-1", killed: false };
    }));

    expect(out).toMatchObject({ picked: true, runId: "run-1", outcome: "review" });
    expect(fake.runs["run-1"]).toMatchObject({ status: "review", conversation_id: "conv-1", summary: "done" });
    expect((fake.runs["run-1"].files as Record<string, unknown>)["index.html"]).toMatchObject({ action: "edit" });
    expect(fake.storage["run-1/result.zip"]).toBeInstanceOf(Uint8Array);
    expect(h.notify).toHaveBeenCalledWith("site_agent_run_ready", expect.anything(), expect.anything());
    // ONE scratch dir: the engine materializes once and hands that path to agy.
    expect(h.materialize).toHaveBeenCalledTimes(1);
    expect(driverCwd).toBe("C:/scratch/agent-run");
    // Claim-scoped workspace key: materialize, collect, and cleanup all used
    // the SAME key, namespaced by run id + claim — never the bare run id.
    expect(h.wsKeys).toHaveLength(3);
    expect(new Set(h.wsKeys).size).toBe(1);
    expect(h.wsKeys[0]).toMatch(/^run-1-/);
    expect(fake.activity.some((a) => a.action === "site_agent.run.completed")).toBe(true);
  });

  it("does nothing when no run is eligible", async () => {
    const fake = makeFakeAdmin({});
    const h = makeHarness(fake);
    const out = await processNextAgentRun(h.deps(neverDriver));
    expect(out).toEqual({ picked: false });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("an agent ERROR fails the run with agy's own message", async () => {
    const fake = makeFakeAdmin(seedRun());
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);

    const out = await processNextAgentRun(h.deps(async (_opts, onEvent) => {
      const result = {
        kind: "result" as const, status: "ERROR" as const, response: "", error: "quota exhausted",
        usage: null, numTurns: 1, durationSeconds: 2,
      };
      onEvent(result);
      return { exitCode: 1, result, conversationId: null, killed: false };
    }));

    expect(out).toMatchObject({ picked: true, outcome: "failed" });
    expect(fake.runs["run-1"]).toMatchObject({ status: "failed", error: expect.stringContaining("quota exhausted") });
    expect(h.notify).toHaveBeenCalledWith("site_agent_run_failed", expect.anything(), expect.anything());
    expect(fake.activity.some((a) => a.action === "site_agent.run.failed")).toBe(true);
  });

  it("a run whose ticket was purged fails gracefully", async () => {
    const fake = makeFakeAdmin(seedRun({ ticket_id: "t-gone" }));
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);
    const out = await processNextAgentRun(h.deps(neverDriver));
    expect(out).toMatchObject({ picked: true, outcome: "failed" });
    expect(fake.runs["run-1"].error).toMatch(/ticket/i);
  });

  it("no-change output fails the run (nothing to review)", async () => {
    const fake = makeFakeAdmin(seedRun());
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);

    const out = await processNextAgentRun(h.deps(async (_opts, onEvent) => {
      const result = {
        kind: "result" as const, status: "SUCCESS" as const, response: "nothing needed", error: null,
        usage: null, numTurns: 1, durationSeconds: 2,
      };
      onEvent(result);
      return { exitCode: 0, result, conversationId: "c", killed: false };
    }));

    expect(out).toMatchObject({ picked: true, outcome: "failed" });
    expect(fake.runs["run-1"].error).toMatch(/no changes/i);
  });

  it("a revise run (conversation_id + existing result.zip) continues from the RESULT, diffs against ORIGINAL", async () => {
    const fake = makeFakeAdmin(seedRun({ conversation_id: "conv-1", instructions: "make it bold" }));
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    fake.storage["run-1/result.zip"] = zipFromMap({ ...SITE, "index.html": enc("<h1>new</h1>") });
    const h = makeHarness(fake);
    let seededIndexHtml = "";

    const out = await processNextAgentRun(h.deps(async (opts, onEvent) => {
      expect(opts.conversationId).toBe("conv-1");
      h.mutate((f) => {
        seededIndexHtml = new TextDecoder().decode(f["index.html"]);
        f["index.html"] = enc("<h1><b>new</b></h1>");
      });
      const result = {
        kind: "result" as const, status: "SUCCESS" as const, response: "bolded", error: null,
        usage: null, numTurns: 1, durationSeconds: 2,
      };
      onEvent(result);
      return { exitCode: 0, result, conversationId: "conv-1", killed: false };
    }));

    expect(out).toMatchObject({ picked: true, outcome: "review" });
    // The workspace the agent saw was seeded from result.zip, not original.zip…
    expect(seededIndexHtml).toBe("<h1>new</h1>");
    // …but the change list stays diffed against ORIGINAL — cumulative.
    expect((fake.runs["run-1"].files as Record<string, unknown>)["index.html"]).toMatchObject({ action: "edit" });
  });

  it("a discard mid-run loses the claim: result discarded, row untouched, no notify", async () => {
    const fake = makeFakeAdmin(seedRun());
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);

    const out = await processNextAgentRun(h.deps(async (_opts, onEvent) => {
      onEvent({ kind: "init", conversationId: "conv-1", permissionMode: "always-proceed" });
      h.mutate((f) => { f["index.html"] = enc("<h1>new</h1>"); });
      // The dashboard discards the run behind the worker's back: status flips
      // and the claim token is cleared, so every later guarded write must miss.
      Object.assign(fake.runs["run-1"], { status: "discarded", claim_id: null });
      const result = {
        kind: "result" as const, status: "SUCCESS" as const, response: "done", error: null,
        usage: { total_tokens: 100 }, numTurns: 1, durationSeconds: 5,
      };
      onEvent(result);
      return { exitCode: 0, result, conversationId: "conv-1", killed: false };
    }));

    expect(out).toMatchObject({ picked: true, runId: "run-1", outcome: "superseded" });
    // The engine never overwrote the discard (upload may have happened; the ROW may not move).
    expect(fake.runs["run-1"].status).toBe("discarded");
    expect(h.notify).not.toHaveBeenCalled();
    // …and no failure was recorded either: a discarded run is nobody's failure.
    expect(fake.activity.some((a) => a.action === "site_agent.run.failed")).toBe(false);
  });

  it("reclaims a running run whose row went quiet past the stale window (dead worker)", async () => {
    // 21 minutes since updated_at (injected now is 12:00) — past the 20m wall.
    const fake = makeFakeAdmin(seedRun({ status: "running", claim_id: "old-claim", updated_at: "2026-09-01T11:39:00Z" }));
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);

    const out = await processNextAgentRun(h.deps(async (_opts, onEvent) => {
      h.mutate((f) => { f["index.html"] = enc("<h1>new</h1>"); });
      const result = {
        kind: "result" as const, status: "SUCCESS" as const, response: "done", error: null,
        usage: null, numTurns: 1, durationSeconds: 5,
      };
      onEvent(result);
      return { exitCode: 0, result, conversationId: "conv-2", killed: false };
    }));

    expect(out).toMatchObject({ picked: true, runId: "run-1", outcome: "review" });
    expect(fake.runs["run-1"].status).toBe("review");
  });

  it("does NOT reclaim a fresh running run — a live worker owns it", async () => {
    const fake = makeFakeAdmin(seedRun({ status: "running", claim_id: "live-claim", updated_at: "2026-09-01T11:59:00Z" }));
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);
    const out = await processNextAgentRun(h.deps(neverDriver));
    expect(out).toEqual({ picked: false });
    expect(fake.runs["run-1"]).toMatchObject({ status: "running", claim_id: "live-claim" });
  });

  it("a killed driver (time cap) fails the run", async () => {
    const fake = makeFakeAdmin(seedRun());
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);
    const out = await processNextAgentRun(
      h.deps(async () => ({ exitCode: null, result: null, conversationId: null, killed: true })),
    );
    expect(out).toMatchObject({ picked: true, outcome: "failed" });
    expect(fake.runs["run-1"].error).toMatch(/time cap/i);
  });

  it("a driver with no result event fails with the sign-in/log hint", async () => {
    const fake = makeFakeAdmin(seedRun());
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);
    const out = await processNextAgentRun(
      h.deps(async () => ({ exitCode: 1, result: null, conversationId: null, killed: false })),
    );
    expect(out).toMatchObject({ picked: true, outcome: "failed" });
    expect(fake.runs["run-1"].error).toMatch(/sign-in|log on the worker box/i);
  });

  it("a spawn-level failure RELEASES the run for a healthy worker instead of eating it", async () => {
    const fake = makeFakeAdmin(seedRun());
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);
    const out = await processNextAgentRun(
      h.deps(async () => ({ exitCode: null, result: null, conversationId: null, killed: false, spawnError: "spawn agy ENOENT" })),
    );
    expect(out).toMatchObject({ picked: true, outcome: "superseded" });
    expect(fake.runs["run-1"]).toMatchObject({ status: "queued", claim_id: null });
    expect(fake.runs["run-1"].error ?? null).toBeNull();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("a missing original.zip fails the run before the driver ever starts", async () => {
    const fake = makeFakeAdmin(seedRun()); // storage left empty
    const h = makeHarness(fake);
    const out = await processNextAgentRun(h.deps(neverDriver));
    expect(out).toMatchObject({ picked: true, outcome: "failed" });
    expect(fake.runs["run-1"].error).toMatch(/original\.zip/);
  });
});
