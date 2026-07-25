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
