import { describe, it, expect, vi } from "vitest";
import { deployRun, type DeployRunDeps } from "@/lib/site-studio/deploy/deployRun";
import { SITES_BUCKET } from "@/lib/site-studio/run/finalize";
import { emptyFakeAdminState, makeFakeAdmin, type FakeAdminState } from "./helpers/fakeStudioAdmin";

const DA_DOMAIN = "da900.is.cc";

function baseRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    lead_id: "lead-1",
    template_id: "tpl-1",
    template_version: 1,
    status: "ready",
    options: {},
    content_doc: null,
    steps: {},
    client_photos: [],
    site_slug: "acme-plumbing-ab12cd",
    zip_path: "run-1/site.zip",
    deployed_url: null,
    error: null,
    paused: false,
    created_by: "user-1",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseLead(overrides: Record<string, unknown> = {}) {
  return {
    id: "lead-1",
    business_name: "Acme Plumbing",
    website_link: null,
    ...overrides,
  };
}

/** Fresh set of injected DirectAdmin fakes for each test — every call is
 *  recorded so tests can assert ORDER (clear-before-upload is the whole
 *  point of the reused path) without any network involved. */
function makeDeps(overrides: Partial<DeployRunDeps> = {}) {
  const calls: string[] = [];
  const deps: DeployRunDeps = {
    daConfigured: vi.fn(() => true),
    daDomain: DA_DOMAIN,
    subdomainExists: vi.fn(async (sub: string) => {
      calls.push(`subdomainExists:${sub}`);
      return false;
    }),
    createSubdomain: vi.fn(async (sub: string) => {
      calls.push(`createSubdomain:${sub}`);
      return { error: false, text: "", details: "", raw: "" };
    }),
    clearDocroot: vi.fn(async (sub: string) => {
      calls.push(`clearDocroot:${sub}`);
      return { ok: true };
    }),
    uploadZipAndExtract: vi.fn(async (sub: string) => {
      calls.push(`upload:${sub}`);
      return { ok: true };
    }),
    docrootFor: vi.fn((sub: string) => `/domains/${sub}.${DA_DOMAIN}/public_html`),
    // No real seconds spent on ensureSubdomain's post-failure re-checks.
    wait: vi.fn(async () => {}),
    ...overrides,
  };
  return { deps, calls };
}

function setup(): { state: FakeAdminState; admin: ReturnType<typeof makeFakeAdmin> } {
  const state = emptyFakeAdminState();
  const admin = makeFakeAdmin(state);
  // Every test's run claims zip_path "run-1/site.zip" — seed the bytes so a
  // successful-path test never fails on a storage miss it isn't testing for.
  state.storage[`${SITES_BUCKET}/run-1/site.zip`] = new Uint8Array([0x50, 0x4b, 3, 4]);
  return { state, admin };
}

describe("deployRun", () => {
  it("refuses when the run is not ready", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun({ status: "rendering" });
    state.leads["lead-1"] = baseLead();
    const { deps } = makeDeps();
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/rendering/i);
  });

  it("refuses a ready run with no zip_path", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun({ zip_path: null });
    state.leads["lead-1"] = baseLead();
    const { deps } = makeDeps();
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/zip/i);
  });

  it("refuses with a clear message when daConfigured() is false", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun();
    state.leads["lead-1"] = baseLead();
    const { deps } = makeDeps({ daConfigured: vi.fn(() => false) });
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/not configured/i);
  });

  it("a fresh deploy creates the subdomain first, does not clear (nothing to clear), then uploads", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun();
    state.leads["lead-1"] = baseLead();
    const { deps, calls } = makeDeps();
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reused).toBe(false);
    expect(outcome.sub).toBe("acme-plumbing-ab12cd");
    expect(calls).toEqual([
      "subdomainExists:acme-plumbing-ab12cd",
      "createSubdomain:acme-plumbing-ab12cd",
      "upload:acme-plumbing-ab12cd",
    ]);
  });

  it("reused: true (redeploy onto the lead's existing subdomain, still present on DA) calls clearDocroot BEFORE upload, and never creates", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun();
    state.leads["lead-1"] = baseLead({ website_link: `https://acme-plumbing.${DA_DOMAIN}/` });
    // FIX 6: the reused path now confirms via subdomainExists rather than
    // assuming — the common case is it's still there, so createSubdomain
    // must never be called.
    const { deps, calls } = makeDeps({
      subdomainExists: vi.fn(async (sub: string) => {
        calls.push(`subdomainExists:${sub}`);
        return true;
      }),
    });
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reused).toBe(true);
    expect(outcome.sub).toBe("acme-plumbing");
    expect(calls).toEqual(["subdomainExists:acme-plumbing", "clearDocroot:acme-plumbing", "upload:acme-plumbing"]);
    expect(deps.createSubdomain).not.toHaveBeenCalled();
    expect(calls.indexOf("clearDocroot:acme-plumbing")).toBeLessThan(calls.indexOf("upload:acme-plumbing"));
  });

  it("reused: true but the subdomain vanished out-of-band (FIX 6) recreates it instead of failing, and skips clearDocroot", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun();
    state.leads["lead-1"] = baseLead({ website_link: `https://acme-plumbing.${DA_DOMAIN}/` });
    const { deps, calls } = makeDeps({
      subdomainExists: vi.fn(async (sub: string) => {
        calls.push(`subdomainExists:${sub}`);
        return false; // gone — removed out of band
      }),
    });
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reused).toBe(true);
    expect(deps.createSubdomain).toHaveBeenCalledWith("acme-plumbing");
    expect(calls).toEqual(["subdomainExists:acme-plumbing", "createSubdomain:acme-plumbing", "upload:acme-plumbing"]);
    expect(deps.clearDocroot).not.toHaveBeenCalled(); // nothing to clear on a freshly (re)created sub
  });

  it("subdomainExists true + not reused: does NOT create, still clears and uploads (idempotent redeploy)", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun();
    state.leads["lead-1"] = baseLead(); // no website_link -> not reused
    const { deps, calls } = makeDeps({
      subdomainExists: vi.fn(async (sub: string) => {
        calls.push(`subdomainExists:${sub}`);
        return true;
      }),
    });
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reused).toBe(false);
    expect(deps.createSubdomain).not.toHaveBeenCalled();
    expect(calls).toEqual([
      "subdomainExists:acme-plumbing-ab12cd",
      "clearDocroot:acme-plumbing-ab12cd",
      "upload:acme-plumbing-ab12cd",
    ]);
  });

  it("writes a studio_deployments row (origin:studio, status:live, subdomain/docroot/url/run_id/lead_id)", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun();
    state.leads["lead-1"] = baseLead();
    const { deps } = makeDeps();
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(true);
    const rows = Object.values(state.studio_deployments);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      origin: "studio",
      status: "live",
      subdomain: "acme-plumbing-ab12cd",
      docroot: "/domains/acme-plumbing-ab12cd.da900.is.cc/public_html",
      url: "https://acme-plumbing-ab12cd.da900.is.cc",
      run_id: "run-1",
      lead_id: "lead-1",
    });
  });

  it("upserts on the subdomain unique index: a redeploy UPDATES the existing row rather than erroring", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun();
    state.leads["lead-1"] = baseLead({ website_link: `https://acme-plumbing.${DA_DOMAIN}/` });
    const { deps } = makeDeps();

    const first = await deployRun(admin, "run-1", deps, "user-1");
    expect(first.ok).toBe(true);
    const secondDeps = makeDeps().deps;
    const second = await deployRun(admin, "run-1", secondDeps, "user-1");
    expect(second.ok).toBe(true);

    const rows = Object.values(state.studio_deployments);
    expect(rows).toHaveLength(1); // updated in place, not a second row
    expect(rows[0].status).toBe("live");
  });

  it("cross-lead guard: refuses when the subdomain's studio_deployments row is LIVE under a different lead", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun({ lead_id: "lead-2" });
    state.leads["lead-2"] = baseLead({ id: "lead-2", business_name: "Acme Plumbing Two" });
    // A DIFFERENT lead already owns this exact subdomain, live.
    state.studio_deployments["dep-1"] = {
      id: "dep-1",
      lead_id: "lead-1",
      run_id: "run-0",
      subdomain: "acme-plumbing-ab12cd",
      docroot: "/domains/acme-plumbing-ab12cd.da900.is.cc/public_html",
      url: "https://acme-plumbing-ab12cd.da900.is.cc",
      status: "live",
      origin: "studio",
    };
    const { deps, calls } = makeDeps();
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/lead-1/); // names the conflicting owner
    expect(outcome.error).toMatch(/acme-plumbing-ab12cd/);
    // must refuse BEFORE touching DirectAdmin at all
    expect(calls).toEqual([]);
    expect(deps.createSubdomain).not.toHaveBeenCalled();
    expect(deps.uploadZipAndExtract).not.toHaveBeenCalled();
  });

  it("does NOT refuse when the conflicting row for the same subdomain is taken_down or failed (history, not a live conflict)", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun({ lead_id: "lead-2" });
    state.leads["lead-2"] = baseLead({ id: "lead-2", business_name: "Acme Plumbing Two" });
    state.studio_deployments["dep-1"] = {
      id: "dep-1",
      lead_id: "lead-1",
      run_id: "run-0",
      subdomain: "acme-plumbing-ab12cd",
      docroot: "x",
      url: "y",
      status: "taken_down",
      origin: "studio",
    };
    const { deps } = makeDeps();
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(true);
  });

  it("does NOT refuse when the existing live row for this subdomain belongs to the SAME lead (its own redeploy)", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun();
    state.leads["lead-1"] = baseLead();
    state.studio_deployments["dep-1"] = {
      id: "dep-1",
      lead_id: "lead-1",
      run_id: "run-0",
      subdomain: "acme-plumbing-ab12cd",
      docroot: "x",
      url: "y",
      status: "live",
      origin: "studio",
    };
    const { deps } = makeDeps({ subdomainExists: vi.fn(async () => true) });
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(true);
  });

  it("sets studio_runs.deployed_url and the lead's website_link, and appends an activity_log entry", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun();
    state.leads["lead-1"] = baseLead();
    const { deps } = makeDeps();
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(state.runs["run-1"].deployed_url).toBe(outcome.url);
    expect(state.runs["run-1"].status).toBe("ready"); // no "deployed" status in the machine
    expect(state.leads["lead-1"].website_link).toBe(outcome.url);
    expect(state.activity_log).toHaveLength(1);
    expect(state.activity_log[0]).toMatchObject({ entity_id: "run-1", entity_type: "studio_run" });
  });

  it("a failed upload marks studio_deployments failed, leaves the run undeployed, and surfaces the error", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun();
    state.leads["lead-1"] = baseLead();
    const { deps } = makeDeps({
      uploadZipAndExtract: vi.fn(async () => ({ ok: false, failedStep: "upload" as const, message: "disk full" })),
    });
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/disk full/);
    expect(state.runs["run-1"].deployed_url).toBeNull();
    const rows = Object.values(state.studio_deployments);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
    expect(state.leads["lead-1"].website_link).toBeNull();
  });

  it("subdomain creation failure (not an 'already exists' race) refuses without uploading", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun();
    state.leads["lead-1"] = baseLead();
    const { deps } = makeDeps({
      createSubdomain: vi.fn(async () => ({ error: true, text: "quota exceeded", details: "", raw: "" })),
    });
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/quota exceeded/);
    expect(deps.uploadZipAndExtract).not.toHaveBeenCalled();
  });

  it("treats an 'already exists' createSubdomain race as success and still deploys", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun();
    state.leads["lead-1"] = baseLead();
    const { deps } = makeDeps({
      createSubdomain: vi.fn(async () => ({ error: true, text: "subdomain already exists", details: "", raw: "" })),
    });
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(true);
  });

  it("never throws — an unexpected exception from a dep is caught and surfaced as a failed outcome", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun();
    state.leads["lead-1"] = baseLead();
    const { deps } = makeDeps({
      uploadZipAndExtract: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await expect(deployRun(admin, "run-1", deps, "user-1")).resolves.toMatchObject({ ok: false });
  });

  it("refuses when the run has no lead_id", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun({ lead_id: null });
    const { deps } = makeDeps();
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(false);
  });

  it("refuses when the run does not exist", async () => {
    const { admin } = setup();
    const { deps } = makeDeps();
    const outcome = await deployRun(admin, "does-not-exist", deps, "user-1");
    expect(outcome.ok).toBe(false);
  });

  // FIX 1 (CRITICAL, review): a redeploy must never clear the live docroot
  // before it holds the bytes it's about to upload — otherwise a storage
  // failure after the clear leaves the client's real site wiped at its real
  // URL with nothing to replace it.
  it("FIX 1: a storage download failure on a REUSED (existing, live) deploy never calls clearDocroot — the live site is untouched", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun();
    state.leads["lead-1"] = baseLead({ website_link: `https://acme-plumbing.${DA_DOMAIN}/` });
    state.downloadShouldFail = () => "storage is down";
    const { deps } = makeDeps({ subdomainExists: vi.fn(async () => true) });
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/zip/i);
    expect(deps.clearDocroot).not.toHaveBeenCalled();
    expect(deps.uploadZipAndExtract).not.toHaveBeenCalled();
    // still recorded as a failed attempt, so the operator sees it happened
    const rows = Object.values(state.studio_deployments);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
  });

  // FIX 3 (IMPORTANT, review): a NULL lead_id on the existing live row must
  // ALSO block — it's an orphaned or unlinked (v2_import) row, not "nobody's
  // site", and the safe default is to refuse rather than risk clobbering a
  // possibly-live client site.
  it("FIX 3: refuses when the existing live row for this subdomain has a NULL lead_id (orphaned/unlinked)", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun({ lead_id: "lead-2" });
    state.leads["lead-2"] = baseLead({ id: "lead-2", business_name: "Acme Plumbing Two" });
    state.studio_deployments["dep-1"] = {
      id: "dep-1",
      lead_id: null,
      run_id: null,
      subdomain: "acme-plumbing-ab12cd",
      docroot: "x",
      url: "y",
      status: "live",
      origin: "v2_import",
    };
    const { deps, calls } = makeDeps();
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/deployments board/i);
    expect(calls).toEqual([]); // refused before any DirectAdmin call
  });

  // FIX 2 (CRITICAL, review): a lead whose website_link drifted from its true
  // live subdomain (so this deploy resolves to a DIFFERENT sub) must retire
  // the OLD live row before writing the new one, so the partial unique index
  // `studio_deployments_one_live_per_lead` never sees two live rows for one
  // lead — proven here via the fake's own modeling of that constraint.
  it("FIX 2: a drifted website_link (redeploy resolves to a NEW subdomain) closes out the lead's old live row — exactly one live row remains", async () => {
    const { state, admin } = setup();
    // The lead's true live site is sub-A, but website_link now points
    // somewhere unrelated (drifted) — so resolution falls through to the
    // run's OWN site_slug, landing on a DIFFERENT subdomain (sub-B).
    state.runs["run-1"] = baseRun({ site_slug: "acme-plumbing-sub-b" });
    state.leads["lead-1"] = baseLead({ website_link: "https://www.acmeplumbing-their-own-domain.com/" });
    state.studio_deployments["dep-a"] = {
      id: "dep-a",
      lead_id: "lead-1",
      run_id: "run-0",
      subdomain: "acme-plumbing-sub-a",
      docroot: "/domains/acme-plumbing-sub-a.da900.is.cc/public_html",
      url: "https://acme-plumbing-sub-a.da900.is.cc",
      status: "live",
      origin: "studio",
    };
    const { deps } = makeDeps();
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sub).toBe("acme-plumbing-sub-b");

    const rows = Object.values(state.studio_deployments);
    const live = rows.filter((r) => r.status === "live");
    expect(live).toHaveLength(1); // the invariant: exactly one live row for this lead
    expect(live[0].subdomain).toBe("acme-plumbing-sub-b");

    const closedOut = rows.find((r) => r.subdomain === "acme-plumbing-sub-a")!;
    expect(closedOut.status).toBe("taken_down");
    expect(closedOut.taken_down_at).toBeTruthy();
  });

  it("FIX 2 (fake modeling): the fake's studio_deployments upsert itself rejects a second live row for the same lead_id", async () => {
    const { state, admin } = setup();
    state.studio_deployments["dep-a"] = {
      id: "dep-a",
      lead_id: "lead-1",
      subdomain: "sub-a",
      docroot: "x",
      url: "y",
      status: "live",
      origin: "studio",
    };
    const { error } = await admin
      .from("studio_deployments")
      .upsert(
        { lead_id: "lead-1", subdomain: "sub-b", docroot: "x", url: "y", status: "live", origin: "studio" },
        { onConflict: "subdomain" },
      )
      .select()
      .single();
    expect(error).toBeTruthy();
    expect(String((error as { message?: string }).message)).toMatch(/one_live_per_lead|unique/i);
    expect(state.studio_deployments["dep-a"].status).toBe("live"); // untouched by the rejected write
  });

  // FIX 4 (IMPORTANT, review): a clearDocroot failure must be surfaced to the
  // operator, not silently discarded — the live site may now mix two builds.
  it("FIX 4: a clearDocroot failure is surfaced on the outcome as clearWarning, but the deploy still completes", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun();
    state.leads["lead-1"] = baseLead({ website_link: `https://acme-plumbing.${DA_DOMAIN}/` });
    const { deps } = makeDeps({
      subdomainExists: vi.fn(async () => true),
      clearDocroot: vi.fn(async () => ({ ok: false, message: "permission denied" })),
    });
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.clearWarning).toMatch(/permission denied/);
    expect(deps.uploadZipAndExtract).toHaveBeenCalled(); // clear failure is non-fatal, matching v2
    void state;
  });

  // FIX 5 (IMPORTANT, review): two deploy calls for the same run must not
  // race clearDocroot+upload against the same docroot. Rather than a real
  // Promise.all race — this codebase's own engine tests explicitly avoid
  // that as flaky under full-suite scheduling (see
  // siteStudioEngine.test.ts's "concurrent calls" describe block) — this
  // deterministically reproduces the ACTUAL race outcome: the run's
  // `updated_at` changes between deployRun's initial read and its own claim
  // attempt, exactly as a second caller's claim committing in between would
  // cause. The claim is a CAS on `updated_at` (same shape as engine.ts's
  // `claimRun`), so this is a faithful, non-flaky proof of the mechanism.
  it("FIX 5: refuses with 'already running' when the run's updated_at moved between read and claim (a concurrent deploy won the race)", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = baseRun();
    state.leads["lead-1"] = baseLead();

    // Patch the studio_runs SELECT this run's own deployRun call uses: right
    // after it reads the row (but before it can act on it), simulate a
    // concurrent caller's claim having already landed by bumping
    // `updated_at` in the underlying state — the same effect a real second
    // `deployRun` call winning the claim race would have. Loosely typed
    // (`any`) deliberately: this is a one-off test-only instrumentation of
    // the fake's chain shape, not a contract worth fighting Supabase's deep
    // generics for.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawAdmin = admin as any;
    const realFrom = rawAdmin.from.bind(rawAdmin);
    let patched = false;
    rawAdmin.from = (table: string) => {
      const real = realFrom(table);
      if (table !== "studio_runs" || patched) return real;
      return {
        ...real,
        select: (cols?: string) => {
          const chain = real.select(cols);
          return {
            ...chain,
            eq: (col: string, val: unknown) => {
              const inner = chain.eq(col, val);
              return {
                ...inner,
                single: async () => {
                  const result = await inner.single();
                  if (!patched) {
                    patched = true;
                    state.runs["run-1"] = {
                      ...state.runs["run-1"],
                      updated_at: new Date(Date.parse(state.runs["run-1"].updated_at as string) + 1000).toISOString(),
                    };
                  }
                  return result;
                },
              };
            },
          };
        },
      };
    };

    const { deps } = makeDeps();
    const outcome = await deployRun(admin, "run-1", deps, "user-1");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/already running/i);
    expect(deps.uploadZipAndExtract).not.toHaveBeenCalled();
    expect(deps.clearDocroot).not.toHaveBeenCalled();
    expect(deps.subdomainExists).not.toHaveBeenCalled(); // refused before ever reaching subdomain resolution
  });
});
