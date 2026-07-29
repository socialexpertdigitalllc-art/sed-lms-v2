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

/**
 * `runSite` is the one seam the POST tests stub: it is the AI-calling engine,
 * and these tests are about the ROUTE's claim/persist/terminal bookkeeping.
 * Everything else stays REAL — notably `loadTemplateBundle`, which reads only
 * from the storage stub below (`builder-templates/tpl-1/source.zip`); stubbing
 * it instead would break the preview GET tests, which need the real bundle.
 *
 * The factory only CLOSES OVER `runSiteMock` (it returns a wrapper that reads
 * it at call time). A factory that touched the mock directly would hit its
 * TDZ, since the hoisted route import below runs before this file's consts.
 */
const runSiteMock = vi.fn();
vi.mock("@/lib/site-builder/run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/site-builder/run")>()),
  runSite: (args: unknown) => runSiteMock(args),
}));

import { GET as previewGet } from "@/app/api/site-builder/runs/[id]/preview/[[...path]]/route";
import { GET as downloadGet } from "@/app/api/site-builder/runs/[id]/download/route";
import { POST as generatePost } from "@/app/api/site-builder/runs/[id]/generate/route";

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
          upload: async () => ({ error: null }),
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

type Row = Record<string, unknown>;

/**
 * A writable fake of the tables the POST routes touch.
 *
 * `.eq()` filters are HONOURED on update — that is the whole point. The
 * mechanism under test is "a superseded attempt's write matches zero rows", so
 * a fake that applied updates regardless of filters would report success for
 * exactly the bug these tests exist to catch.
 */
function makeWritableAdmin(
  rows: Row[],
  leads: Row[] = [{ id: "lead-1", business_name: "Acme", specify_pages: ["Home"] }],
) {
  const state = { runs: rows.map((r) => ({ ...r })), leads, activity: [] as Row[] };

  const from = (table: string) => {
    if (table === "activity_log") {
      return {
        insert: async (payload: Row) => {
          state.activity.push(payload);
          return { error: null };
        },
      };
    }

    const source = table === "builder_runs" ? state.runs : table === "leads" ? state.leads : null;
    if (!source) throw new Error(`unexpected table "${table}"`);

    const filters: [string, unknown][] = [];
    let patch: Row | null = null;
    const apply = () => {
      const hits = source.filter((r) => filters.every(([c, v]) => r[c] === v));
      if (patch) for (const r of hits) Object.assign(r, patch);
      return hits;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = {
      select: () => api,
      update: (p: Row) => {
        patch = p;
        return api;
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return api;
      },
      is: () => api,
      single: async () => {
        const hits = apply();
        return hits.length === 1 ? { data: { ...hits[0] }, error: null } : { data: null, error: { message: "no rows" } };
      },
      maybeSingle: async () => {
        const hits = apply();
        return { data: hits.length ? { ...hits[0] } : null, error: null };
      },
      // An update with no .select() is awaited directly (the progress chain and
      // the catch-block failure write both do this).
      then: (res: (v: { data: null; error: null }) => unknown) => {
        apply();
        return Promise.resolve({ data: null, error: null }).then(res);
      },
    };
    return api;
  };

  return { admin: { from, storage: makeAdmin().storage }, state };
}

const RUN = (over: Row = {}): Row => ({
  id: "run-1",
  lead_id: "lead-1",
  template_id: "tpl-1",
  status: "queued",
  options: {},
  images: [],
  pages: {},
  output_path: null,
  error: null,
  generation_id: null,
  updated_at: "2026-07-29T12:00:00.000Z",
  ...over,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(() => {
  adminHolder.admin = makeAdmin();
  runSiteMock.mockReset();
  runSiteMock.mockResolvedValue({
    ok: true,
    pages: { "index.html": { status: "ok", kind: "existing", html: "<html>gen</html>" } },
    zipBytes: new Uint8Array([1, 2, 3]),
  });
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

const runCtx = () => ({ params: Promise.resolve({ id: "run-1" }) });

describe("POST /api/site-builder/runs/[id]/generate — generation ownership", () => {
  it("stamps a fresh generation_id on the claim", async () => {
    const { admin, state } = makeWritableAdmin([RUN()]);
    adminHolder.admin = admin;

    // runSite runs AFTER the claim and BEFORE the terminal write, so the row
    // as seen from in here is the row the claim left behind. Asserting only on
    // the final row would pass whether or not the token was ever stamped.
    let midFlight: Row | null = null;
    runSiteMock.mockImplementation(async () => {
      midFlight = { ...state.runs[0] };
      return {
        ok: true,
        pages: { "index.html": { status: "ok", kind: "existing", html: "<html>gen</html>" } },
        zipBytes: new Uint8Array([1, 2, 3]),
      };
    });

    const res = await generatePost(new Request("http://test.local/x", { method: "POST" }), runCtx());

    // runSite having been called at all is what proves the claim succeeded;
    // assert the token BEFORE the response status so an unstamped claim fails
    // here — naming the real defect — rather than downstream on the 409 the
    // guarded terminal write would then produce.
    expect(runSiteMock).toHaveBeenCalledTimes(1);
    expect(midFlight).not.toBeNull();
    expect(midFlight!.status).toBe("generating");
    expect(midFlight!.generation_id).toEqual(expect.any(String));
    expect(String(midFlight!.generation_id)).toMatch(UUID_RE);
    expect(res.status).toBe(200);
    expect(state.runs[0].status).toBe("review");
  });

  it("discards a superseded attempt's terminal write instead of clobbering", async () => {
    const { admin, state } = makeWritableAdmin([RUN()]);
    adminHolder.admin = admin;

    // Simulate /recover landing mid-flight: it evicts the live attempt by
    // clearing the token and setting a status of its own.
    runSiteMock.mockImplementation(async () => {
      state.runs[0].generation_id = null;
      state.runs[0].status = "failed";
      return {
        ok: true,
        pages: { "index.html": { status: "ok", kind: "existing", html: "<html>gen</html>" } },
        zipBytes: new Uint8Array([1, 2, 3]),
      };
    });

    const res = await generatePost(new Request("http://test.local/x", { method: "POST" }), runCtx());

    expect(res.status).toBe(409);
    expect(state.runs[0].status).toBe("failed");
    expect(state.activity).toHaveLength(0);
  });
});
