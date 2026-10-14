// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

/**
 * The template preview ("Preview in new tab" on the templates board and the
 * lead form's picker) is sandboxed like the run previews, so its CSS and JS
 * requests carry no cookie either — they authenticate with the signed segment
 * the session request is redirected to.
 */

const guardHolder: { result: { userId: string } | { error: 401 | 403 } } = { result: { userId: "u-sales" } };
vi.mock("@/lib/site-studio/service/guard", () => ({
  guardAny: async () => guardHolder.result,
  guardError: (status: 401 | 403) =>
    NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const enc = new TextEncoder();
vi.mock("@/lib/site-builder/templates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/site-builder/templates")>()),
  loadTemplateBundle: async () => ({
    pages: {
      "index.html": '<html><head></head><body><link rel="stylesheet" href="/style.css"><a href="#quote">Quote</a></body></html>',
    },
    pageFiles: ["index.html"],
    assets: { "style.css": enc.encode("body{color:red}"), "components.js": enc.encode("renderHeader()") },
    assetFiles: ["style.css", "components.js"],
  }),
}));

import { GET } from "@/app/api/site-builder/templates/[id]/preview/[[...path]]/route";

const ctx = (path?: string[]) => ({ params: Promise.resolve({ id: "tpl-1", path }) });

beforeEach(() => {
  guardHolder.result = { userId: "u-sales" };
  process.env.PREVIEW_TOKEN_SECRET = "test-preview-secret";
});
afterEach(() => {
  delete process.env.PREVIEW_TOKEN_SECRET;
});

describe("GET /api/site-builder/templates/[id]/preview — signed addresses", () => {
  it("'Preview in new tab' lands on the signed entry page, whose assets load with no session", async () => {
    const first = await GET(new Request("http://x/api/site-builder/templates/tpl-1/preview"), ctx(undefined));
    expect(first.status).toBe(302);
    const location = first.headers.get("Location")!;
    expect(location).toMatch(/^\/api\/site-builder\/templates\/tpl-1\/preview\/~[^/]+\/index\.html$/);
    const signed = location.split("/preview/")[1].split("/")[0];

    guardHolder.result = { error: 401 };
    const page = await GET(new Request(`http://x${location}`), ctx([signed, "index.html"]));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(`<base href="/api/site-builder/templates/tpl-1/preview/${signed}/index.html">`);
    expect(html).toContain(`href="/api/site-builder/templates/tpl-1/preview/${signed}/style.css"`);
    // A same-page anchor stays an anchor: <base> is the page's own address.
    expect(html).toContain('href="#quote"');

    const css = await GET(new Request("http://x/"), ctx([signed, "style.css"]));
    expect(css.status).toBe(200);
    expect(await css.text()).toBe("body{color:red}");
    const js = await GET(new Request("http://x/"), ctx([signed, "components.js"]));
    expect(await js.text()).toBe("renderHeader()");
  });

  it("without a session or a valid token, nothing is served", async () => {
    guardHolder.result = { error: 401 };
    const res = await GET(new Request("http://x/"), ctx(["~1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "style.css"]));
    expect(res.status).toBe(401);
  });
});
