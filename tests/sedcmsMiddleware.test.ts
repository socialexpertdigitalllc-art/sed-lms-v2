// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * The SED CMS calls /api/internal/sedcms/* server to server, with no LMS
 * session: each request proves itself with its HMAC signature instead. The
 * session middleware must let exactly that prefix through — a 307 to /login
 * there silently breaks every CMS publish, and no route test can catch it
 * (they import the handlers directly). The real middleware runs here with a
 * signed-out session.
 */

// hoisted above the imports by Vitest
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: null }) } }),
}));

async function signedOut(path: string, method = "POST") {
  return updateSession(new NextRequest(`https://lms.sedsolutions.online${path}`, { method }));
}

const isLoginRedirect = (res: Response) => res.status === 307 && new URL(res.headers.get("location") ?? "", "https://x").pathname === "/login";

describe("the session middleware and the CMS's internal paths", () => {
  it("lets every internal SED CMS path through without a session", async () => {
    for (const path of [
      "/api/internal/sedcms/leads/x/apply",
      "/api/internal/sedcms/leads/0b6c1f0e-8a4e-4c55-9d1a-3f2e5a7b9c10/summary",
      "/api/internal/sedcms/leads/0b6c1f0e-8a4e-4c55-9d1a-3f2e5a7b9c10/live-files",
      "/api/internal/sedcms/leads/0b6c1f0e-8a4e-4c55-9d1a-3f2e5a7b9c10/checksums",
      "/api/internal/sedcms/leads/0b6c1f0e-8a4e-4c55-9d1a-3f2e5a7b9c10/tickets",
    ]) {
      const res = await signedOut(path);
      expect(isLoginRedirect(res), path).toBe(false);
      expect(res.status, path).toBe(200);
    }
  });

  it("still sends everything else to /login, neighbours of the prefix included", async () => {
    for (const path of [
      "/api/internal/other",
      "/api/internal/sedcms",
      "/api/internal/sedcmsx/leads/x/apply",
      "/api/internal/SEDCMS/leads/x/apply",
      "/api/internal/sedcms-other/x",
      "/api/sedcms/open",
      "/dashboard",
    ]) {
      const res = await signedOut(path);
      expect(isLoginRedirect(res), path).toBe(true);
    }
  });

  it("a dot-segment can't walk out of the prefix (the URL is normalized before the check)", async () => {
    expect(isLoginRedirect(await signedOut("/api/internal/sedcms/../../../dashboard"))).toBe(true);
    expect(isLoginRedirect(await signedOut("/api/internal/sedcms/%2e%2e/%2e%2e/%2e%2e/dashboard"))).toBe(true);
  });

  it("names the plan's prefix exactly once, as a prefix match", () => {
    const src = readFileSync("lib/supabase/middleware.ts", "utf8");
    const hits = src.split('path.startsWith("/api/internal/sedcms/")').length - 1;
    expect(hits).toBe(1);
    expect(src.split("/api/internal/").length - 1).toBe(1);
  });
});
