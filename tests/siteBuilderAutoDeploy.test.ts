// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { autoDeployRun } from "@/lib/site-builder/autoDeploy";

/**
 * Auto-deploy: publish a finished run with no operator in the loop.
 *
 * The rules that matter operationally, and are pinned here:
 *   - it may only act on a run sitting in `review` (CAS), so it can never
 *     fight an operator who already approved/deployed by hand;
 *   - a deploy failure must NOT leave the run stranded in `approved` — it
 *     goes back to `review` so the manual Deploy button still works;
 *   - it never throws: generation already succeeded by the time it runs.
 */

const deployMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/site-builder/deploy", () => ({ deployBuilderRun: deployMock }));
vi.mock("@/lib/template-engine/directadmin", () => ({
  daConfigured: () => true,
  createSubdomain: vi.fn(),
  subdomainExists: vi.fn(),
  clearDocroot: vi.fn(),
  uploadZipAndExtract: vi.fn(),
  docrootFor: (s: string) => `/domains/${s}/public_html`,
}));

interface Recorded {
  updates: { patch: Record<string, unknown>; filters: [string, string][] }[];
  inserts: { table: string; row: Record<string, unknown> }[];
}

/** Fake admin whose builder_runs UPDATE honours a status CAS. */
function makeAdmin(runStatus: { value: string }): { admin: SupabaseClient; rec: Recorded } {
  const rec: Recorded = { updates: [], inserts: [] };
  const admin = {
    from(table: string) {
      return {
        insert: async (row: Record<string, unknown>) => {
          rec.inserts.push({ table, row });
          return { error: null };
        },
        update(patch: Record<string, unknown>) {
          const entry = { patch, filters: [] as [string, string][] };
          rec.updates.push(entry);
          const chain = {
            eq(col: string, val: string) {
              entry.filters.push([col, val]);
              return chain;
            },
            select() {
              return {
                single: async () => {
                  const casStatus = entry.filters.find(([c]) => c === "status")?.[1];
                  if (casStatus !== undefined && casStatus !== runStatus.value) {
                    return { data: null, error: { message: "no rows" } };
                  }
                  runStatus.value = String(patch.status ?? runStatus.value);
                  return { data: { id: "run-1" }, error: null };
                },
              };
            },
            // update().eq().eq() with no select (the rollback write)
            then(resolve: (v: unknown) => void) {
              const casStatus = entry.filters.find(([c]) => c === "status")?.[1];
              if (casStatus === undefined || casStatus === runStatus.value) {
                runStatus.value = String(patch.status ?? runStatus.value);
              }
              resolve({ error: null });
            },
          };
          return chain;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { admin, rec };
}

beforeEach(() => {
  deployMock.mockReset();
});

describe("autoDeployRun", () => {
  it("approves a run in review, deploys it, and reports the live url", async () => {
    const status = { value: "review" };
    const { admin, rec } = makeAdmin(status);
    deployMock.mockResolvedValue({ ok: true, url: "https://acme-ab12cd.dmviral.com" });

    const out = await autoDeployRun(admin, "run-1", "user-1");

    expect(out).toEqual({ ok: true, url: "https://acme-ab12cd.dmviral.com" });
    // approved via CAS on status=review
    expect(rec.updates[0].patch.status).toBe("approved");
    expect(rec.updates[0].filters).toContainEqual(["status", "review"]);
    // deploy got the run's creator as the actor, so the audit trail and the
    // notification attribute the publish to the person who asked for it
    expect(deployMock.mock.calls[0][1]).toBe("run-1");
    expect(deployMock.mock.calls[0][3]).toBe("user-1");
    expect(rec.inserts.some((i) => i.row.action === "site_builder.run.approved")).toBe(true);
  });

  it("refuses when the run is no longer in review — an operator already acted", async () => {
    const status = { value: "deployed" };
    const { admin } = makeAdmin(status);

    const out = await autoDeployRun(admin, "run-1", "user-1");

    expect(out.ok).toBe(false);
    expect(deployMock).not.toHaveBeenCalled();
  });

  it("rolls the run back to review when the deploy fails, so manual deploy still works", async () => {
    const status = { value: "review" };
    const { admin, rec } = makeAdmin(status);
    deployMock.mockResolvedValue({ ok: false, status: 502, error: "Could not create subdomain" });

    const out = await autoDeployRun(admin, "run-1", "user-1");

    expect(out).toMatchObject({ ok: false, error: "Could not create subdomain" });
    expect(status.value).toBe("review");
    expect(rec.inserts.some((i) => i.row.action === "site_builder.run.auto_deploy_failed")).toBe(true);
  });

  it("never throws — a deploy that blows up is reported, not propagated", async () => {
    const status = { value: "review" };
    const { admin } = makeAdmin(status);
    deployMock.mockRejectedValue(new Error("DirectAdmin exploded"));

    const out = await autoDeployRun(admin, "run-1", null);

    expect(out).toMatchObject({ ok: false, error: "DirectAdmin exploded" });
  });
});
