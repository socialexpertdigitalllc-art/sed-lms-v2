// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { ensureSubdomain, type EnsureSubdomainDeps } from "@/lib/site-studio/deploy/ensureSubdomain";

/**
 * The DirectAdmin subdomain-provisioning step, isolated.
 *
 * It exists because of a real production failure (2026-08-27 and 2026-08-31):
 * DA's `CMD_API_SUBDOMAINS action=create` provisions the vhost AND issues the
 * certificate before it answers — 30-60s on this server, per the client's own
 * note — so our 30s call timeout aborted the request while DA went on to
 * create the subdomain anyway. Auto-deploy then reported "Could not create
 * subdomain: This operation was aborted", rolled the run back to review, and
 * left an orphan subdomain behind. The next (manual) deploy rolled a fresh
 * random slug, so nobody ever noticed the litter.
 *
 * The rule pinned here: a create that REPORTS failure has not necessarily
 * failed. Re-check before believing it.
 */

function makeDeps(overrides: Partial<EnsureSubdomainDeps> = {}): EnsureSubdomainDeps {
  return {
    subdomainExists: vi.fn(async () => false),
    createSubdomain: vi.fn(async () => ({ error: false, text: "", details: "" })),
    // Tests never wait for real seconds; the production default does.
    wait: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("ensureSubdomain", () => {
  it("does not create a subdomain that already exists", async () => {
    const deps = makeDeps({ subdomainExists: vi.fn(async () => true) });
    const out = await ensureSubdomain(deps, "acme-ab12cd");

    expect(out).toEqual({ ok: true, existed: true });
    expect(deps.createSubdomain).not.toHaveBeenCalled();
  });

  it("creates a missing subdomain and reports it as new", async () => {
    const deps = makeDeps();
    const out = await ensureSubdomain(deps, "acme-ab12cd");

    expect(out).toEqual({ ok: true, existed: false });
    expect(deps.createSubdomain).toHaveBeenCalledWith("acme-ab12cd");
  });

  it("treats DA's 'already exists' error as success (a race, not a failure)", async () => {
    const deps = makeDeps({
      createSubdomain: vi.fn(async () => ({ error: true, text: "Error", details: "That domain already exists" })),
    });
    const out = await ensureSubdomain(deps, "acme-ab12cd");

    expect(out).toEqual({ ok: true, existed: true });
  });

  it("REGRESSION: a timed-out create that actually landed is not a failure", async () => {
    // Exactly the production shape: our client aborts at the timeout, DA
    // finishes provisioning a moment later, and the subdomain is there.
    const exists = vi.fn(async () => false);
    exists.mockResolvedValueOnce(false); // the pre-create check
    exists.mockResolvedValueOnce(true); // the post-failure re-check
    const deps = makeDeps({
      subdomainExists: exists,
      createSubdomain: vi.fn(async () => ({ error: true, text: "This operation was aborted", details: "" })),
    });

    const out = await ensureSubdomain(deps, "acme-ab12cd");

    expect(out).toEqual({ ok: true, existed: true });
    // Deploying onto it must clear the docroot first, so it reports as
    // pre-existing rather than freshly ours.
    expect(deps.createSubdomain).toHaveBeenCalledTimes(1);
  });

  it("waits between re-checks — DA can finish provisioning after it stops answering", async () => {
    const exists = vi.fn(async () => false);
    exists.mockResolvedValueOnce(false); // pre-create
    exists.mockResolvedValueOnce(false); // re-check 1
    exists.mockResolvedValueOnce(true); // re-check 2
    const wait = vi.fn((ms: number) => Promise.resolve(void ms));
    const deps = makeDeps({
      subdomainExists: exists,
      createSubdomain: vi.fn(async () => ({ error: true, text: "This operation was aborted", details: "" })),
      wait,
    });

    const out = await ensureSubdomain(deps, "acme-ab12cd");

    expect(out).toEqual({ ok: true, existed: true });
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait.mock.calls.every((call) => call[0] > 0)).toBe(true);
  });

  it("gives up with DA's own message when the subdomain really never appears", async () => {
    const deps = makeDeps({
      createSubdomain: vi.fn(async () => ({ error: true, text: "Error", details: "You have reached your limit" })),
    });

    const out = await ensureSubdomain(deps, "acme-ab12cd");

    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("You have reached your limit");
  });

  it("never throws — a raising DA client is a refusal, not an exception", async () => {
    const deps = makeDeps({
      createSubdomain: vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    });

    const out = await ensureSubdomain(deps, "acme-ab12cd");

    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("ECONNRESET");
  });
});
