// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { zipFromMap } from "@/lib/site-studio/zip";

/**
 * Direct-import tests for the preview catch-all and download routes — the
 * two GET endpoints the operator reported as 404ing. They exercise the REAL
 * handlers with real zip bytes and only mock the two seams every route in
 * this codebase mocks (admin client, auth guard): if these pass, the
 * handlers and their param conventions are correct, and a 404 in the app
 * is environmental (a dev server running stale route state), not code.
 */

const adminHolder: { admin: unknown } = { admin: null };

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminHolder.admin,
}));

vi.mock("@/lib/site-studio/service/guard", () => ({
  guard: async () => ({ userId: "user-1" }),
  guardError: (status: 401 | 403) =>
    NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status }),
}));

import { GET as previewGet } from "@/app/api/site-builder/runs/[id]/preview/[[...path]]/route";
import { GET as downloadGet } from "@/app/api/site-builder/runs/[id]/download/route";

const enc = new TextEncoder();

const TEMPLATE_ZIP = zipFromMap({
  "index.html": enc.encode("<html><body>template home</body></html>"),
  "about.html": enc.encode("<html><body>template about</body></html>"),
  "style.css": enc.encode("body{color:red}"),
  "components.js": enc.encode("// template demo components"),
});

const SITE_ZIP = zipFromMap({
  "index.html": enc.encode("<html><body>generated home</body></html>"),
  "style.css": enc.encode("body{color:red}"),
});

const RUN_ROW = {
  id: "run-1",
  template_id: "tpl-1",
  output_path: "run-1/site.zip",
  leads: { business_name: "Acme Plumbing" },
  pages: {
    "components.js": { status: "ok", kind: "component", name: "Shared components", html: "// REWRITTEN components" },
    "index.html": {
      status: "ok",
      kind: "existing",
      html: `<!doctype html><html><head><title>t</title></head><body><link href="/style.css"><a href="about.html">About</a></body></html>`,
    },
    "about.html": { status: "failed", kind: "existing", error: "boom" },
  },
};

function makeAdmin() {
  return {
    from(table: string) {
      if (table !== "builder_runs") throw new Error(`unexpected table "${table}"`);
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: RUN_ROW, error: null }),
          }),
        }),
      };
    },
    storage: {
      from(bucket: string) {
        return {
          download: async (path: string) => {
            if (bucket === "builder-templates" && path === "tpl-1/source.zip") {
              return { data: { arrayBuffer: async () => TEMPLATE_ZIP.buffer }, error: null };
            }
            if (bucket === "builder-sites" && path === "run-1/site.zip") {
              return { data: { arrayBuffer: async () => SITE_ZIP.buffer }, error: null };
            }
            return { data: null, error: { message: `no object ${bucket}/${path}` } };
          },
        };
      },
    },
  };
}

beforeEach(() => {
  adminHolder.admin = makeAdmin();
});

const ctx = (path?: string[]) => ({ params: Promise.resolve({ id: "run-1", path }) });

describe("GET /api/site-builder/runs/[id]/preview/[[...path]]", () => {
  it("bare /preview serves the entry page as html with a base tag and rewritten refs", async () => {
    const res = await previewGet(new Request("http://test.local/api/site-builder/runs/run-1/preview"), ctx(undefined));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain(`<base href="/api/site-builder/runs/run-1/preview/">`);
    // root-absolute known ref routed back through the preview, and an
    // inter-page link routed the same way so whole-site navigation holds
    expect(body).toContain(`href="/api/site-builder/runs/run-1/preview/style.css"`);
    expect(body).toContain(`href="/api/site-builder/runs/run-1/preview/about.html"`);
    expect(body).toContain("<title>t</title>");
  });

  it("/preview/index.html serves that page; scripts allowed but origin sandboxed", async () => {
    const res = await previewGet(
      new Request("http://test.local/api/site-builder/runs/run-1/preview/index.html"),
      ctx(["index.html"]),
    );
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
  });

  it("/preview/style.css streams the template asset with its content type", async () => {
    const res = await previewGet(
      new Request("http://test.local/api/site-builder/runs/run-1/preview/style.css"),
      ctx(["style.css"]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
    expect(await res.text()).toBe("body{color:red}");
  });

  it("/preview/components.js serves the run's REWRITTEN components, shadowing the template's copy", async () => {
    const res = await previewGet(
      new Request("http://test.local/api/site-builder/runs/run-1/preview/components.js"),
      ctx(["components.js"]),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("// REWRITTEN components");
  });

  it("?raw=1 returns the exact generated source as text/plain", async () => {
    const res = await previewGet(
      new Request("http://test.local/api/site-builder/runs/run-1/preview/index.html?raw=1"),
      ctx(["index.html"]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toBe(RUN_ROW.pages["index.html"].html);
    expect(body).not.toContain("<base ");
  });

  it("a failed page 409s with its error instead of serving anything", async () => {
    const res = await previewGet(
      new Request("http://test.local/api/site-builder/runs/run-1/preview/about.html"),
      ctx(["about.html"]),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("boom");
  });

  it("a traversal path is refused, not resolved", async () => {
    const res = await previewGet(
      new Request("http://test.local/api/site-builder/runs/run-1/preview/../secrets"),
      ctx(["..", "secrets"]),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/site-builder/runs/[id]/download", () => {
  it("streams the stored zip as an attachment named after the business", async () => {
    const res = await downloadGet(new Request("http://test.local/api/site-builder/runs/run-1/download"), {
      params: Promise.resolve({ id: "run-1" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="acme-plumbing-site.zip"');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(SITE_ZIP.length);
  });
});
