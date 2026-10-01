// tests/siteAgentWorker.test.ts
// @vitest-environment node
import { describe, it, expect, vi, onTestFinished } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { processNextAgentRun, type WorkerDeps } from "@/lib/site-agent/worker";
import type { AgyDriver } from "@/lib/site-agent/agy";
import {
  AGY_MAX_ATTEMPTS, AGY_RETRY_DELAYS_MS, AGY_TIMEOUT_MS, type AgyModel,
} from "@/lib/site-agent/types";
import { zipFromMap } from "@/lib/template-engine/zip";

const enc = (s: string) => new TextEncoder().encode(s);
const SITE = { "index.html": enc("<h1>old</h1>"), "about.html": enc("<p>about</p>") };

/** In-memory stand-in for the service-role client: one runs table honouring
 *  chained .eq filters on update (that is what makes the claim CAS and the
 *  claim_id guard testable), ticket/lead selects, an app_settings singleton
 *  (heartbeat + published model list), an activity recorder, and a storage
 *  bucket backed by a plain record. */
function makeFakeAdmin(
  seed: Record<string, Record<string, unknown>>,
  settingsSeed: Record<string, unknown> = {},
) {
  const runs = { ...seed };
  const settings: Record<string, unknown> = { singleton: true, ...settingsSeed };
  const storage: Record<string, Uint8Array> = {};
  const activity: { action: string; row: Record<string, unknown> }[] = [];

  const admin = {
    from(table: string) {
      if (table === "app_settings") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { agent_worker_models: settings.agent_worker_models ?? null },
                error: null,
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              Object.assign(settings, patch);
              return { error: null };
            },
          }),
        };
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
                        lead_id: "lead-1",
                        items: [
                          { id: "item-1", body: "swap number", sort: 0, is_done: false },
                          { id: "item-2", body: "fix footer email", sort: 1, is_done: false },
                          // Done in an earlier run/toggle — a WHOLE-ticket run
                          // must not re-request it (matches the dialog's
                          // undone-only preview and F3's bookkeeping).
                          { id: "item-3", body: "update hours", sort: 2, is_done: true },
                        ],
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
  return { admin: admin as unknown as SupabaseClient, runs, settings, storage, activity };
}

/** Fake workspace + notify around the fake admin. materialize returns ONE
 *  fixed path and must be called ONCE — the engine passes that cwd to the
 *  driver rather than materializing again. Every workspace call records the
 *  scratch KEY it was given: the engine must use ONE claim-scoped key
 *  (run id + claim prefix) for materialize/collect/cleanup, so a reclaimer
 *  can never wipe a still-live predecessor's dir. Drivers mutate the
 *  in-memory workspace through `mutate` instead of a real fs. */
function makeHarness(
  fake: ReturnType<typeof makeFakeAdmin>,
  listModelsImpl?: () => Promise<AgyModel[]>,
) {
  let files: Record<string, Uint8Array> = {};
  const wsKeys: string[] = [];
  const materialize = vi.fn(async (map: Record<string, Uint8Array>, key: string) => {
    wsKeys.push(key);
    files = { ...map };
    return "C:/scratch/agent-run";
  });
  const notify = vi.fn(async () => {});
  const listModels = vi.fn(listModelsImpl ?? (async () => [] as AgyModel[]));
  // Retry back-off pauses resolve at once — tests assert the requested delays.
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
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
    listModels,
    now: () => new Date("2026-09-01T12:00:00Z"),
    sleep,
  });
  return { deps, notify, materialize, listModels, mutate, wsKeys, sleep };
}

/** agy's real wording when Google's API drops the stream mid-turn (seen on
 *  2026-09-02, 09-11 and four runs in a row on 2026-10-01). */
const STREAM_CUT = "The stream was interrupted. Please continue the task you were working on.";

function errorResult(error: string) {
  return {
    kind: "result" as const, status: "ERROR" as const, response: "", error,
    usage: null, numTurns: 1, durationSeconds: 2,
  };
}

function successResult(response: string) {
  return {
    kind: "result" as const, status: "SUCCESS" as const, response, error: null,
    usage: null, numTurns: 1, durationSeconds: 2,
  };
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
      onEvent({ kind: "step", stepType: "tool_call", state: "DONE", index: 1, toolName: null, toolParams: null, textDelta: null });
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

  it("the tail carries the final message ONCE when result.response echoes the last text delta", async () => {
    // agy's result.response duplicates the closing agent_response text_delta
    // verbatim (both real success captures) — the tail must not say it twice.
    const fake = makeFakeAdmin(seedRun());
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);

    const out = await processNextAgentRun(h.deps(async (_opts, onEvent) => {
      onEvent({ kind: "init", conversationId: "conv-1", permissionMode: "always-proceed" });
      onEvent({ kind: "step", stepType: "agent_response", state: "DONE", index: 1, toolName: null, toolParams: null, textDelta: "All done.\n" });
      h.mutate((f) => { f["index.html"] = enc("<h1>new</h1>"); });
      const result = {
        kind: "result" as const, status: "SUCCESS" as const, response: "All done.", error: null,
        usage: null, numTurns: 1, durationSeconds: 2,
      };
      onEvent(result);
      return { exitCode: 0, result, conversationId: "conv-1", killed: false };
    }));

    expect(out).toMatchObject({ picked: true, runId: "run-1", outcome: "review" });
    const tail = String(fake.runs["run-1"].output_tail ?? "");
    expect(tail).toContain("All done.");
    expect(tail.split("All done.").length - 1).toBe(1);
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
    // Quota is not a blip — asking again would only burn the time budget.
    expect(h.sleep).not.toHaveBeenCalled();
  });

  // ---- transient upstream errors: resume instead of throwing the work away ----

  it("a stream cut mid-turn RESUMES the same conversation in the same folder and reaches review", async () => {
    const fake = makeFakeAdmin(seedRun());
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);
    const calls: { prompt: string; conversationId: string | null | undefined; cwd: string; model: string | null | undefined }[] = [];

    const out = await processNextAgentRun(h.deps(async (opts, onEvent) => {
      calls.push({ prompt: opts.prompt, conversationId: opts.conversationId, cwd: opts.cwd, model: opts.model });
      if (calls.length === 1) {
        onEvent({ kind: "init", conversationId: "conv-1", permissionMode: "always-proceed" });
        h.mutate((f) => { f["index.html"] = enc("<h1>new</h1>"); });
        const result = errorResult(STREAM_CUT);
        onEvent(result);
        return { exitCode: 1, result, conversationId: "conv-1", killed: false };
      }
      onEvent({ kind: "init", conversationId: "conv-1", permissionMode: "always-proceed" });
      const result = successResult("Swapped the phone number in index.html.");
      onEvent(result);
      return { exitCode: 0, result, conversationId: "conv-1", killed: false };
    }));

    expect(out).toMatchObject({ picked: true, runId: "run-1", outcome: "review" });
    expect(calls).toHaveLength(2);
    // The second call continues the conversation agy started — same folder,
    // same model — with a short resume note, not the whole ticket again.
    expect(calls[1].conversationId).toBe("conv-1");
    expect(calls[1].cwd).toBe(calls[0].cwd);
    expect(calls[1].model).toBe(calls[0].model);
    expect(calls[1].prompt).toMatch(/cut off/i);
    expect(calls[1].prompt).toContain("C:/scratch/agent-run");
    expect(calls[1].prompt).not.toContain("swap number");
    // The edit made BEFORE the cut survives into the review.
    expect(h.materialize).toHaveBeenCalledTimes(1);
    expect((fake.runs["run-1"].files as Record<string, unknown>)["index.html"]).toMatchObject({ action: "edit" });
    expect(fake.runs["run-1"]).toMatchObject({
      status: "review", conversation_id: "conv-1", summary: "Swapped the phone number in index.html.",
    });
    expect(h.sleep).toHaveBeenCalledTimes(1);
    expect(String(fake.runs["run-1"].output_tail)).toMatch(/picking the task back up/i);
    expect(fake.activity.some((a) => a.action === "site_agent.run.failed")).toBe(false);
  });

  it("an error BEFORE the agent started (sign-in refresh timeout) repeats the ORIGINAL call", async () => {
    // 2026-10-01: agy's keyring token refresh timed out at launch, so the turn
    // never began — there is nothing to resume, the same request is re-sent.
    const fake = makeFakeAdmin(seedRun());
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);
    const calls: { prompt: string; conversationId: string | null | undefined }[] = [];

    const out = await processNextAgentRun(h.deps(async (opts, onEvent) => {
      calls.push({ prompt: opts.prompt, conversationId: opts.conversationId });
      if (calls.length === 1) {
        const result = errorResult("authentication failed or timed out");
        onEvent(result);
        return { exitCode: 1, result, conversationId: null, killed: false };
      }
      h.mutate((f) => { f["index.html"] = enc("<h1>new</h1>"); });
      const result = successResult("done");
      onEvent(result);
      return { exitCode: 0, result, conversationId: "conv-2", killed: false };
    }));

    expect(out).toMatchObject({ picked: true, outcome: "review" });
    expect(calls).toHaveLength(2);
    expect(calls[1].prompt).toBe(calls[0].prompt);
    expect(calls[1].conversationId ?? null).toBeNull();
  });

  it("a revise whose follow-up never started re-sends the FOLLOW-UP, not a bare 'continue'", async () => {
    // Resuming would make the agent believe the earlier, finished turn is the
    // task — the developer's follow-up would be silently lost.
    const fake = makeFakeAdmin(seedRun({ conversation_id: "conv-1", instructions: "make it bold" }));
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    fake.storage["run-1/result.zip"] = zipFromMap({ ...SITE, "index.html": enc("<h1>new</h1>") });
    const h = makeHarness(fake);
    const prompts: string[] = [];

    const out = await processNextAgentRun(h.deps(async (opts, onEvent) => {
      prompts.push(opts.prompt);
      expect(opts.conversationId).toBe("conv-1");
      if (prompts.length === 1) {
        const result = errorResult("API error (attempt 1): request failed: read tcp: wsarecv: connection timed out");
        onEvent(result);
        return { exitCode: 1, result, conversationId: "conv-1", killed: false };
      }
      h.mutate((f) => { f["index.html"] = enc("<h1><b>new</b></h1>"); });
      const result = successResult("bolded");
      onEvent(result);
      return { exitCode: 0, result, conversationId: "conv-1", killed: false };
    }));

    expect(out).toMatchObject({ picked: true, outcome: "review" });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toBe(prompts[0]);
    expect(prompts[1]).toContain("make it bold");
  });

  it("keeps failing → gives up after the attempt cap with agy's own message and backs off between tries", async () => {
    const fake = makeFakeAdmin(seedRun());
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);
    let n = 0;

    const out = await processNextAgentRun(h.deps(async (_opts, onEvent) => {
      n++;
      onEvent({ kind: "init", conversationId: "conv-1", permissionMode: "always-proceed" });
      const result = errorResult(STREAM_CUT);
      onEvent(result);
      return { exitCode: 1, result, conversationId: "conv-1", killed: false };
    }));

    expect(out).toMatchObject({ picked: true, outcome: "failed" });
    expect(n).toBe(AGY_MAX_ATTEMPTS);
    expect(h.sleep.mock.calls.map((c) => c[0])).toEqual(AGY_RETRY_DELAYS_MS.slice(0, AGY_MAX_ATTEMPTS - 1));
    expect(fake.runs["run-1"].error).toContain("The stream was interrupted");
    expect(fake.runs["run-1"].error).toMatch(new RegExp(`${AGY_MAX_ATTEMPTS} tries`));
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it("a discard landing during a failed attempt stops the retries — superseded, no second call", async () => {
    const fake = makeFakeAdmin(seedRun());
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);
    let n = 0;

    const out = await processNextAgentRun(h.deps(async (_opts, onEvent) => {
      n++;
      onEvent({ kind: "init", conversationId: "conv-1", permissionMode: "always-proceed" });
      Object.assign(fake.runs["run-1"], { status: "discarded", claim_id: null });
      const result = errorResult(STREAM_CUT);
      onEvent(result);
      return { exitCode: 1, result, conversationId: "conv-1", killed: false };
    }));

    expect(out).toMatchObject({ picked: true, outcome: "superseded" });
    expect(n).toBe(1);
    expect(fake.runs["run-1"].status).toBe("discarded");
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("every attempt shares ONE time budget — no try may exceed what is left of the 15-minute cap", async () => {
    const fake = makeFakeAdmin(seedRun());
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);
    const budgets: number[] = [];
    // The back-off pause must come out of the same budget: let the fake sleep
    // move the wall clock (timers stay real so the keepalive is untouched).
    vi.useFakeTimers({ toFake: ["Date"] });
    h.sleep.mockImplementation(async (ms: number) => { vi.setSystemTime(Date.now() + ms); });
    onTestFinished(() => { vi.useRealTimers(); });

    await processNextAgentRun(h.deps(async (opts, onEvent) => {
      budgets.push(opts.timeoutMs);
      if (budgets.length === 1) {
        onEvent({ kind: "init", conversationId: "conv-1", permissionMode: "always-proceed" });
        const result = errorResult(STREAM_CUT);
        onEvent(result);
        return { exitCode: 1, result, conversationId: "conv-1", killed: false };
      }
      h.mutate((f) => { f["index.html"] = enc("<h1>new</h1>"); });
      const result = successResult("done");
      onEvent(result);
      return { exitCode: 0, result, conversationId: "conv-1", killed: false };
    }));

    expect(budgets).toHaveLength(2);
    expect(budgets[0]).toBeLessThanOrEqual(AGY_TIMEOUT_MS);
    expect(budgets[1]).toBeLessThanOrEqual(budgets[0] - AGY_RETRY_DELAYS_MS[0]);
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

  // ---- v2: run scope (item_ids), task_text, model ----

  /** Success driver that records the opts it was given and makes one edit. */
  function capturingDriver(h: ReturnType<typeof makeHarness>, seen: { prompt?: string; model?: string | null }): AgyDriver {
    return async (opts, onEvent) => {
      seen.prompt = opts.prompt;
      seen.model = opts.model ?? null;
      h.mutate((f) => { f["index.html"] = enc("<h1>new</h1>"); });
      const result = {
        kind: "result" as const, status: "SUCCESS" as const, response: "done", error: null,
        usage: null, numTurns: 1, durationSeconds: 2,
      };
      onEvent(result);
      return { exitCode: 0, result, conversationId: "c", killed: false };
    };
  }

  it("a whole-ticket run (null item_ids) composes from UNDONE items only", async () => {
    const fake = makeFakeAdmin(seedRun());
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);
    let prompt = "";
    const out = await processNextAgentRun(
      h.deps(async (opts, onEvent) => {
        prompt = opts.prompt;
        const result = { kind: "result" as const, status: "SUCCESS" as const, response: "done", error: null, usage: null, numTurns: 1, durationSeconds: 2 };
        h.mutate((f) => { f["index.html"] = enc("<h1>new</h1>"); });
        onEvent(result);
        return { exitCode: 0, result, conversationId: "c", killed: false };
      }),
    );
    expect(out).toMatchObject({ outcome: "review" });
    expect(prompt).toContain("swap number");
    expect(prompt).toContain("fix footer email");
    expect(prompt).not.toContain("update hours"); // is_done: true — excluded
  });

  it("item_ids scopes the prompt to the selected ticket items only", async () => {
    const fake = makeFakeAdmin(seedRun({ item_ids: ["item-2"] }));
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);
    const seen: { prompt?: string; model?: string | null } = {};

    const out = await processNextAgentRun(h.deps(capturingDriver(h, seen)));
    expect(out).toMatchObject({ picked: true, outcome: "review" });
    expect(seen.prompt).toContain("fix footer email");
    expect(seen.prompt).not.toContain("swap number");
    expect(seen.prompt).not.toContain("update hours");
  });

  it("task_text feeds the prompt VERBATIM instead of the composed title/items; model defaults to null", async () => {
    const fake = makeFakeAdmin(seedRun({ task_text: "Make the hero banner green, nothing else." }));
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);
    const seen: { prompt?: string; model?: string | null } = {};

    const out = await processNextAgentRun(h.deps(capturingDriver(h, seen)));
    expect(out).toMatchObject({ picked: true, outcome: "review" });
    expect(seen.prompt).toContain("Make the hero banner green, nothing else.");
    expect(seen.prompt).not.toContain("Fix phone");
    expect(seen.prompt).not.toContain("swap number");
    // No model on the run → no model handed to the driver.
    expect(seen.model).toBeNull();
  });

  it("a TICKETLESS run (null ticket_id + task_text) drives the agent and flips to review", async () => {
    // v2 F5: the lead screen's "AI edit site" creates runs with no ticket at
    // all — the task_text IS the request. The worker must not mistake it for
    // a purge orphan.
    const fake = makeFakeAdmin(seedRun({ ticket_id: null, task_text: "Change the hero headline to Hello." }));
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);
    const seen: { prompt?: string; model?: string | null } = {};

    const out = await processNextAgentRun(h.deps(capturingDriver(h, seen)));
    expect(out).toMatchObject({ picked: true, outcome: "review" });
    expect(fake.runs["run-1"]).toMatchObject({ status: "review" });
    expect(seen.prompt).toContain("Change the hero headline to Hello.");
    expect(seen.prompt).toContain("Acme");
    // No ticket → no ticket audience; the creator watches the panel. The
    // ticket-targeted "ready" bell must not fire (it would link /tickets/null).
    expect(h.notify).not.toHaveBeenCalled();
    // The audit row anchors to the LEAD, matching the lead routes' convention.
    const done = fake.activity.find((a) => a.action === "site_agent.run.completed");
    expect(done?.row).toMatchObject({ entity_type: "lead", entity_id: "lead-1" });
  });

  it("a null-ticket run with NO task text still fails gracefully (purge orphan)", async () => {
    const fake = makeFakeAdmin(seedRun({ ticket_id: null, task_text: "   " }));
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);
    const out = await processNextAgentRun(h.deps(neverDriver));
    expect(out).toMatchObject({ picked: true, outcome: "failed" });
    expect(fake.runs["run-1"].error).toMatch(/nothing to do/i);
    const failed = fake.activity.find((a) => a.action === "site_agent.run.failed");
    expect(failed?.row).toMatchObject({ entity_type: "lead", entity_id: "lead-1" });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("a ticketless run that ERRORS fails without a ticket bell", async () => {
    const fake = makeFakeAdmin(seedRun({ ticket_id: null, task_text: "Do the thing." }));
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
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("the run's model is handed to the driver", async () => {
    const fake = makeFakeAdmin(seedRun({ model: "claude-sonnet-4-6" }));
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);
    const seen: { prompt?: string; model?: string | null } = {};

    const out = await processNextAgentRun(h.deps(capturingDriver(h, seen)));
    expect(out).toMatchObject({ picked: true, outcome: "review" });
    expect(seen.model).toBe("claude-sonnet-4-6");
  });

  // ---- v2: models publish (app_settings.agent_worker_models) ----

  it("publishes the fetched model list when app_settings has none — after a processed run", async () => {
    const fake = makeFakeAdmin(seedRun());
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake, async () => [
      { id: "m-1", label: "Model One" }, { id: "m-2", label: "Model Two" },
    ]);
    const seen: { prompt?: string; model?: string | null } = {};

    const out = await processNextAgentRun(h.deps(capturingDriver(h, seen)));
    expect(out).toMatchObject({ picked: true, outcome: "review" });
    expect(h.listModels).toHaveBeenCalledTimes(1);
    expect(fake.settings.agent_worker_models).toEqual({
      fetched_at: "2026-09-01T12:00:00.000Z",
      models: [{ id: "m-1", label: "Model One" }, { id: "m-2", label: "Model Two" }],
    });
  });

  it("a fresh published list skips the fetch entirely", async () => {
    const fresh = { fetched_at: "2026-09-01T12:00:00Z", models: [{ id: "m-1", label: "One" }] };
    const fake = makeFakeAdmin({}, { agent_worker_models: fresh });
    const h = makeHarness(fake, async () => [{ id: "m-2", label: "Two" }]);

    const out = await processNextAgentRun(h.deps(neverDriver));
    expect(out).toEqual({ picked: false });
    expect(h.listModels).not.toHaveBeenCalled();
    expect(fake.settings.agent_worker_models).toEqual(fresh);
  });

  it("a stale published list (11 min) is refetched and rewritten", async () => {
    const fake = makeFakeAdmin({}, {
      agent_worker_models: { fetched_at: "2026-09-01T11:49:00Z", models: [{ id: "m-old", label: "Old" }] },
    });
    const h = makeHarness(fake, async () => [{ id: "m-new", label: "New" }]);

    await processNextAgentRun(h.deps(neverDriver));
    expect(h.listModels).toHaveBeenCalledTimes(1);
    expect(fake.settings.agent_worker_models).toEqual({
      fetched_at: "2026-09-01T12:00:00.000Z",
      models: [{ id: "m-new", label: "New" }],
    });
  });

  it("an EMPTY model list writes NOTHING — a transient agy failure keeps the old list", async () => {
    const stale = { fetched_at: "2026-09-01T11:49:00Z", models: [{ id: "m-old", label: "Old" }] };
    const fake = makeFakeAdmin({}, { agent_worker_models: stale });
    const h = makeHarness(fake); // default listModels → []

    await processNextAgentRun(h.deps(neverDriver));
    expect(h.listModels).toHaveBeenCalledTimes(1);
    expect(fake.settings.agent_worker_models).toEqual(stale);
  });

  it("a throwing listModels never affects the run outcome", async () => {
    const fake = makeFakeAdmin(seedRun());
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake, async () => { throw new Error("agy exploded"); });
    const seen: { prompt?: string; model?: string | null } = {};

    const out = await processNextAgentRun(h.deps(capturingDriver(h, seen)));
    expect(out).toMatchObject({ picked: true, runId: "run-1", outcome: "review" });
    expect(fake.runs["run-1"].status).toBe("review");
  });

  it("publishes models even when no run was picked", async () => {
    const fake = makeFakeAdmin({});
    const h = makeHarness(fake, async () => [{ id: "m-1", label: "One" }]);

    const out = await processNextAgentRun(h.deps(neverDriver));
    expect(out).toEqual({ picked: false });
    expect(fake.settings.agent_worker_models).toEqual({
      fetched_at: "2026-09-01T12:00:00.000Z",
      models: [{ id: "m-1", label: "One" }],
    });
  });

  // ---- v2: tail dedupe is scoped to the result echo only ----

  it("keeps two identical tool lines separated by a silenced event — dedupe is result-only", async () => {
    const fake = makeFakeAdmin(seedRun());
    fake.storage["run-1/original.zip"] = zipFromMap(SITE);
    const h = makeHarness(fake);

    const out = await processNextAgentRun(h.deps(async (_opts, onEvent) => {
      const tool = {
        kind: "step" as const, stepType: "tool_call", state: "ACTIVE", index: 1,
        toolName: "write_file", toolParams: "index.html", textDelta: null,
      };
      onEvent(tool); // ▸ write_file (index.html)
      onEvent({ ...tool, state: "DONE" }); // silenced (ACTIVE already announced)
      onEvent({ ...tool, index: 2 }); // the agent genuinely retries the same call
      h.mutate((f) => { f["index.html"] = enc("<h1>new</h1>"); });
      const result = {
        kind: "result" as const, status: "SUCCESS" as const, response: "done", error: null,
        usage: null, numTurns: 1, durationSeconds: 2,
      };
      onEvent(result);
      return { exitCode: 0, result, conversationId: "c", killed: false };
    }));

    expect(out).toMatchObject({ picked: true, outcome: "review" });
    const tail = String(fake.runs["run-1"].output_tail ?? "");
    expect(tail.split("▸ write_file (index.html)").length - 1).toBe(2);
  });
});
