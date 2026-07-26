import { describe, it, expect } from "vitest";
import { untrustedContentHeaders } from "@/lib/site-studio/service/guard";

/**
 * These assertions guard the ONLY enforcement point for the untrusted-content
 * security property: /preview and /original serve attacker-authored template
 * HTML/JS/SVG same-origin with the authenticated LMS session. If a future edit
 * weakens the sandbox, an uploaded <script> runs with the viewing operator's
 * cookies — so each directive below is load-bearing, not stylistic.
 */
describe("untrustedContentHeaders", () => {
  const h = untrustedContentHeaders("text/html; charset=utf-8") as Record<string, string>;

  it("passes the content type through", () => {
    expect(h["Content-Type"]).toBe("text/html; charset=utf-8");
  });

  it("sandboxes the response with no script or same-origin privileges", () => {
    const csp = h["Content-Security-Policy"];
    expect(csp).toBeTruthy();
    // bare `sandbox` — the browser-level scripting kill switch
    expect(csp.split(";").map((d) => d.trim())).toContain("sandbox");
    // the two tokens that would re-enable an uploaded script to attack the LMS
    expect(csp).not.toContain("allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    // nothing loads by default
    expect(csp).toContain("default-src 'none'");
  });

  it("blocks content-type sniffing", () => {
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("allows the Phase 2b review drawer to iframe it, but nobody else", () => {
    // SAMEORIGIN (not DENY) is deliberate: the review drawer embeds /preview.
    // The sandbox CSP above is what keeps the embedded content inert.
    expect(h["X-Frame-Options"]).toBe("SAMEORIGIN");
  });

  it("never caches untrusted content", () => {
    expect(h["Cache-Control"]).toContain("private");
    expect(h["Cache-Control"]).toContain("must-revalidate");
  });
});

/**
 * FIX 1 (Phase 4a review): the run-preview route
 * (`app/api/site-studio/runs/[id]/preview/route.ts`, page mode) passes
 * `{ allowSameOrigin: true }` so its response agrees with `RunPreview.tsx`'s
 * iframe `sandbox="allow-same-origin"` attribute — without this, the bare
 * `sandbox` CSP forces an opaque origin regardless of the iframe attribute,
 * and `frame.contentDocument` is `null` in every real browser (jsdom does not
 * enforce CSP, so `tests/siteStudioPreviewUi.test.tsx` never catches this).
 * This guards the header string that specific route actually sends.
 */
describe("untrustedContentHeaders({ allowSameOrigin: true }) — the run-preview opt-in", () => {
  const h = untrustedContentHeaders("text/html", { allowSameOrigin: true }) as Record<string, string>;
  const csp = h["Content-Security-Policy"];
  const directives = csp.split(";").map((d) => d.trim());

  it("grants allow-same-origin so the iframe's contentDocument is reachable", () => {
    expect(directives).toContain("sandbox allow-same-origin");
  });

  it("still blocks script execution — allow-scripts is never granted", () => {
    expect(csp).not.toContain("allow-scripts");
  });

  it("leaves every other directive exactly as the strict default", () => {
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("style-src 'unsafe-inline' 'self'");
    expect(csp).toContain("font-src 'self' data:");
  });

  it("does not affect other callers that omit the option (template preview/original stay strict)", () => {
    const strict = untrustedContentHeaders("text/html") as Record<string, string>;
    expect(strict["Content-Security-Policy"].split(";").map((d) => d.trim())).toContain("sandbox");
    expect(strict["Content-Security-Policy"]).not.toContain("allow-same-origin");
  });
});
