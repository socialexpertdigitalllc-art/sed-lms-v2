// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  PREVIEW_TOKEN_WINDOW_MS,
  mintPreviewToken,
  planPreviewPage,
  previewRedirect,
  signedPreviewRoot,
  splitPreviewToken,
  verifyPreviewToken,
} from "@/lib/preview/signedPreview";
import { SIGNED_PREVIEW_PATH } from "@/lib/preview/signedPath";

/**
 * The sandboxed previews send no cookie with their own requests (opaque
 * origin, SameSite=Lax session cookie), so their CSS/JS authenticate with a
 * signed path segment instead — the 2026-10-14 "preview shows only HTML" fix.
 */

const saved = { secret: process.env.PREVIEW_TOKEN_SECRET, service: process.env.SUPABASE_SERVICE_ROLE_KEY };
beforeEach(() => {
  process.env.PREVIEW_TOKEN_SECRET = "test-preview-secret";
});
afterEach(() => {
  for (const [k, v] of [["PREVIEW_TOKEN_SECRET", saved.secret], ["SUPABASE_SERVICE_ROLE_KEY", saved.service]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const T0 = Date.UTC(2026, 9, 14, 12, 0, 0);

describe("preview tokens", () => {
  it("verify for their own scope only, and survive at least one full window", () => {
    const token = mintPreviewToken("site-agent-run:r1", T0)!;
    expect(token).toMatch(/^[0-9a-z]+\.[A-Za-z0-9_-]{32}$/);
    expect(verifyPreviewToken("site-agent-run:r1", token, T0)).toBe(true);
    expect(verifyPreviewToken("site-agent-run:r1", token, T0 + PREVIEW_TOKEN_WINDOW_MS)).toBe(true);
    expect(verifyPreviewToken("site-agent-run:r2", token, T0)).toBe(false);
    expect(verifyPreviewToken("site-builder-run:r1", token, T0)).toBe(false);
  });

  it("expire within two windows", () => {
    const token = mintPreviewToken("s", T0)!;
    expect(verifyPreviewToken("s", token, T0 + 2 * PREVIEW_TOKEN_WINDOW_MS)).toBe(false);
  });

  it("stay the same within a window, so a preview's address doesn't change under the viewer", () => {
    const start = Math.floor(T0 / PREVIEW_TOKEN_WINDOW_MS) * PREVIEW_TOKEN_WINDOW_MS;
    expect(mintPreviewToken("s", start)).toBe(mintPreviewToken("s", start + PREVIEW_TOKEN_WINDOW_MS - 1));
    expect(mintPreviewToken("s", start)).not.toBe(mintPreviewToken("s", start + PREVIEW_TOKEN_WINDOW_MS));
  });

  it("refuse tampering: another signature, a stretched expiry, junk", () => {
    const token = mintPreviewToken("s", T0)!;
    const [exp, sig] = token.split(".");
    const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    expect(verifyPreviewToken("s", `${exp}.${flipped}`, T0)).toBe(false);
    const later = (parseInt(exp, 36) + PREVIEW_TOKEN_WINDOW_MS).toString(36);
    expect(verifyPreviewToken("s", `${later}.${sig}`, T0)).toBe(false);
    for (const junk of ["", ".", "abc", `${exp}.`, `${exp}.${sig}.x`, `${exp}.${sig}/x`]) {
      expect(verifyPreviewToken("s", junk, T0)).toBe(false);
    }
  });

  it("an expiry this server would never mint is refused even with a valid signature", () => {
    // Signed with the real key, but dated a year out.
    process.env.PREVIEW_TOKEN_SECRET = "k";
    const far = mintPreviewToken("s", T0 + 365 * 24 * 3600_000)!;
    expect(verifyPreviewToken("s", far, T0)).toBe(false);
  });

  it("depend on the server secret: another secret's token fails, and no secret means no tokens", () => {
    const token = mintPreviewToken("s", T0)!;
    process.env.PREVIEW_TOKEN_SECRET = "a-different-secret";
    expect(verifyPreviewToken("s", token, T0)).toBe(false);
    delete process.env.PREVIEW_TOKEN_SECRET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(mintPreviewToken("s", T0)).toBeNull();
    expect(verifyPreviewToken("s", token, T0)).toBe(false);
  });

  it("fall back to the service key when no dedicated secret is set", () => {
    delete process.env.PREVIEW_TOKEN_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    const token = mintPreviewToken("s", T0)!;
    expect(verifyPreviewToken("s", token, T0)).toBe(true);
  });
});

describe("signed paths", () => {
  it("split a leading ~token segment off the route's path", () => {
    expect(splitPreviewToken(["~abc.def", "css", "x.css"])).toEqual({ token: "abc.def", rest: ["css", "x.css"] });
    expect(splitPreviewToken(["css", "x.css"])).toEqual({ token: null, rest: ["css", "x.css"] });
    expect(splitPreviewToken([])).toEqual({ token: null, rest: [] });
    expect(signedPreviewRoot("/api/site-agent/runs/r1/preview/", "abc.def")).toBe("/api/site-agent/runs/r1/preview/~abc.def/");
  });

  it("the middleware lets exactly the signed preview addresses through", () => {
    for (const p of [
      "/api/site-agent/runs/r1/preview/~abc.def",
      "/api/site-agent/runs/r1/preview/~abc.def/index.html",
      "/api/site-builder/runs/r1/preview/~abc.def/css/style.css",
      "/api/site-builder/templates/t1/preview/~abc.def/about.html",
    ]) expect(SIGNED_PREVIEW_PATH.test(p), p).toBe(true);
    for (const p of [
      "/api/site-agent/runs/r1/preview",
      "/api/site-agent/runs/r1/preview/index.html",
      "/api/site-agent/runs/r1/files/~abc.def/index.html",
      "/api/site-agent/runs/r1/approve",
      "/api/site-studio/runs/r1/preview/~abc.def",
      "/dashboard/~abc.def",
    ]) expect(SIGNED_PREVIEW_PATH.test(p), p).toBe(false);
  });

  it("redirects relatively, uncached", () => {
    const res = previewRedirect("/api/site-agent/runs/r1/preview/~t/index.html");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/api/site-agent/runs/r1/preview/~t/index.html");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("planPreviewPage", () => {
  const root = "/api/site-agent/runs/r1/preview/";
  const base = { root, scope: "site-agent-run:r1", search: "" };

  it("a session request is sent to the page's signed address, keeping its query", () => {
    const plan = planPreviewPage({ ...base, token: null, requested: "about.html", encodedTarget: "about.html", search: "?v=2" });
    expect(plan).toEqual({ redirect: expect.stringMatching(/^\/api\/site-agent\/runs\/r1\/preview\/~[^/]+\/about\.html\?v=2$/) });
  });

  it("the bare entry address goes to the entry file, so the page's address and <base> agree", () => {
    const token = mintPreviewToken("site-agent-run:r1")!;
    expect(planPreviewPage({ ...base, token, requested: "", encodedTarget: "index.html" })).toEqual({
      redirect: `${root}~${token}/index.html`,
    });
  });

  it("a signed page is served with its own address as <base> and the signed root for absolute refs", () => {
    const token = mintPreviewToken("site-agent-run:r1")!;
    expect(planPreviewPage({ ...base, token, requested: "blog/a b.html", encodedTarget: "blog/a%20b.html", search: "?v=1&x=2" })).toEqual({
      base: `${root}~${token}/blog/a%20b.html?v=1&amp;x=2`,
      assetRoot: `${root}~${token}/`,
    });
  });

  it("without a signing secret it serves through the session, exactly as before", () => {
    delete process.env.PREVIEW_TOKEN_SECRET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(planPreviewPage({ ...base, token: null, requested: "", encodedTarget: "index.html" })).toEqual({
      base: root,
      assetRoot: root,
    });
  });
});
