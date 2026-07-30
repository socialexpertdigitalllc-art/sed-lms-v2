// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

/** Configurable per test (the live-route auth test flips it to a 401); the
 *  global beforeEach resets it to the operator every other test assumes. */
const guardHolder: { result: { userId: string } | { error: 401 | 403 } } = { result: { userId: "user-1" } };
vi.mock("@/lib/site-studio/service/guard", () => ({
  guard: async () => guardHolder.result,
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
const regeneratePageMock = vi.fn();
vi.mock("@/lib/site-builder/run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/site-builder/run")>()),
  runSite: (args: unknown) => runSiteMock(args),
  // The per-page sibling of the seam above, stubbed for the same reason and
  // in the same lazy way: `regeneratePage` is the AI call, and the regenerate
  // tests are about the ROUTE's status gate and promotion.
  regeneratePage: (args: unknown) => regeneratePageMock(args),
}));

/**
 * The processor's seam, wired the same lazy way as `runSiteMock` — with one
 * extra wrinkle: this file ALSO exercises the REAL `generateRunNow`, both
 * directly (the rounds-loop describe at the bottom) and through the /generate
 * route, so the wrapper falls back to the real implementation whenever no
 * stub is installed. The processor tests install `generateRunNowMock` via the
 * holder; the global beforeEach uninstalls it.
 */
const generateRunNowMock = vi.fn();
const generateRunNowHolder: { impl: typeof generateRunNowMock | null } = { impl: null };
vi.mock("@/lib/site-builder/generateRun", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/site-builder/generateRun")>();
  return {
    ...real,
    generateRunNow: (...args: Parameters<typeof real.generateRunNow>) =>
      generateRunNowHolder.impl ? generateRunNowHolder.impl(...args) : real.generateRunNow(...args),
  };
});

import { GET as previewGet } from "@/app/api/site-builder/runs/[id]/preview/[[...path]]/route";
import { GET as downloadGet } from "@/app/api/site-builder/runs/[id]/download/route";
import { POST as generatePost } from "@/app/api/site-builder/runs/[id]/generate/route";
import { POST as regeneratePost } from "@/app/api/site-builder/runs/[id]/pages/[file]/regenerate/route";
import { POST as recoverPost } from "@/app/api/site-builder/runs/[id]/recover/route";
import { DELETE as runDelete } from "@/app/api/site-builder/runs/[id]/route";
import { GET as liveGet } from "@/app/api/site-builder/runs/[id]/live/route";
import { POST as processPost } from "@/app/api/site-builder/process/route";
import { generateRunNow, type GenerateRunDeps } from "@/lib/site-builder/generateRun";
import { recordOutput, liveSnapshot, clearLive } from "@/lib/site-builder/liveProgress";

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

    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    let removing = false;
    const apply = () => {
      const hits = source.filter((r) => filters.every((f) => f(r)));
      if (patch) for (const r of hits) Object.assign(r, patch);
      // Filters are honoured on DELETE for the same reason they are on update.
      if (removing) for (const r of hits) source.splice(source.indexOf(r), 1);
      return hits;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = {
      select: () => api,
      update: (p: Row) => {
        patch = p;
        return api;
      },
      delete: () => {
        removing = true;
        return api;
      },
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return api;
      },
      /**
       * `.is()` is HONOURED too, for the same reason `.eq()` is: the regenerate
       * route stands aside from a live generation with `.is("generation_id",
       * null)`, so a fake that ignored it would report success for exactly the
       * clobber that guard exists to prevent.
       *
       * An ABSENT key counts as null. A real row always has the column, so a
       * fixture that omits it is a row whose column is NULL — which is what
       * Postgres `IS NULL` matches (this is what keeps the leads fixture, which
       * carries no `deleted_at`, passing the generate route's own `.is()`).
       */
      is: (col: string, val: unknown) => {
        filters.push((r) => (val === null ? r[col] === undefined || r[col] === null : r[col] === val));
        return api;
      },
      single: async () => {
        const hits = apply();
        return hits.length === 1 ? { data: { ...hits[0] }, error: null } : { data: null, error: { message: "no rows" } };
      },
      maybeSingle: async () => {
        const hits = apply();
        return { data: hits.length ? { ...hits[0] } : null, error: null };
      },
      // Awaited directly, with no terminal call. A bare select resolves with
      // every matching row — filter-honoured like everything else — which is
      // how the process route lists builder_runs. An update with no .select()
      // is awaited the same way (the progress chain and the catch-block
      // failure write both do this); its data goes unread.
      then: (res: (v: { data: Row[]; error: null }) => unknown) => {
        const hits = apply();
        return Promise.resolve({ data: hits.map((r) => ({ ...r })), error: null }).then(res);
      },
    };
    return api;
  };

  /**
   * Spy-able upload over the read-only storage stub. It is a spy because the
   * ordering fix is "a superseded attempt does not upload AT ALL" — that is an
   * assertion about a call that must NOT happen, so the call has to be
   * observable. `mockResolvedValue({ error: {...} })` makes packaging fail.
   */
  const baseStorage = makeAdmin().storage;
  const uploadMock = vi.fn(async (_bucket: string, _path: string) => ({ error: null as { message: string } | null }));
  const removed: string[] = [];
  const storage = {
    from(bucket: string) {
      return {
        ...baseStorage.from(bucket),
        upload: (path: string) => uploadMock(bucket, path),
        remove: async (paths: string[]) => {
          removed.push(...paths);
          return { error: null };
        },
      };
    },
  };

  return { admin: { from, storage }, state, uploadMock, removed };
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
  guardHolder.result = { userId: "user-1" };
  adminHolder.admin = makeAdmin();
  runSiteMock.mockReset();
  runSiteMock.mockResolvedValue({
    ok: true,
    pages: { "index.html": { status: "ok", kind: "existing", html: "<html>gen</html>" } },
    zipBytes: new Uint8Array([1, 2, 3]),
  });
  regeneratePageMock.mockReset();
  regeneratePageMock.mockResolvedValue({ ok: true, html: "<html>regenerated</html>" });
  generateRunNowMock.mockReset();
  generateRunNowHolder.impl = null;
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

describe("POST /api/site-builder/runs/[id]/generate — packaging order", () => {
  it("a superseded attempt does not upload at all", async () => {
    const { admin, state, uploadMock } = makeWritableAdmin([RUN()]);
    adminHolder.admin = admin;

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

    // The DB guard alone never stopped this: the upload path is shared by
    // every attempt and upserts, so a loser that uploaded would have replaced
    // the winner's archive while its row write was correctly discarded.
    expect(uploadMock).not.toHaveBeenCalled();
    expect(res.status).toBe(409);
    expect(state.runs[0].status).toBe("failed");
  });

  it("the winner uploads once and is released afterwards", async () => {
    const { admin, state, uploadMock } = makeWritableAdmin([RUN()]);
    adminHolder.admin = admin;

    const res = await generatePost(new Request("http://test.local/x", { method: "POST" }), runCtx());

    expect(res.status).toBe(200);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledWith("builder-sites", "run-1/site.zip");
    expect(state.runs[0].status).toBe("review");
    expect(state.runs[0].output_path).toBe("run-1/site.zip");
    // Released only in the LAST write — holding the token across the upload is
    // what makes "row says review, bytes not up yet" a safe intermediate state.
    expect(state.runs[0].generation_id).toBeNull();
  });

  it("a failed upload leaves a run that is failed, released and free to retry", async () => {
    const { admin, state, uploadMock } = makeWritableAdmin([RUN()]);
    adminHolder.admin = admin;
    uploadMock.mockResolvedValue({ error: { message: "storage unreachable" } });

    const res = await generatePost(new Request("http://test.local/x", { method: "POST" }), runCtx());

    expect(res.status).toBe(500);
    expect(state.runs[0].status).toBe("failed");
    expect(state.runs[0].generation_id).toBeNull();
    const message = String(state.runs[0].error);
    expect(message).toContain("storage unreachable");
    expect(message).toMatch(/retry/i);
    expect(message).toMatch(/no AI calls/i);
    // …and that promise is only true because the finished pages survived the
    // failure: `resume` carries every `ok` page forward, so the retry re-zips
    // rather than regenerating.
    const pages = state.runs[0].pages as Record<string, { status: string }>;
    expect(Object.keys(pages)).toHaveLength(1);
    expect(Object.values(pages).every((p) => p.status === "ok")).toBe(true);
  });

  /**
   * `output_path` is written BEFORE the upload — deliberately, so ownership is
   * established before any object-store side effect — which means a failed
   * upload would otherwise leave the row naming an object that is not there.
   * The run screen renders "Download zip" on `output_path` alone, so that link
   * 404s.
   */
  it("puts output_path back where it was when packaging fails", async () => {
    const { admin, state, uploadMock } = makeWritableAdmin([RUN({ output_path: null })]);
    adminHolder.admin = admin;
    uploadMock.mockResolvedValue({ error: { message: "storage unreachable" } });

    const res = await generatePost(new Request("http://test.local/x", { method: "POST" }), runCtx());

    expect(res.status).toBe(500);
    // A first run had no zip, so it must end with none — not with a path to
    // bytes that were never uploaded.
    expect(state.runs[0].output_path).toBeNull();
  });

  it("restores the PREVIOUS zip's path, rather than nulling it, when a re-run's packaging fails", async () => {
    // The discriminating half: an implementation that just wrote null on
    // failure would drop a download that still works. The prior attempt's
    // object is untouched by a failed upsert.
    const { admin, state, uploadMock } = makeWritableAdmin([
      RUN({ status: "failed", output_path: "run-1/site.zip", error: "Every page failed to generate." }),
    ]);
    adminHolder.admin = admin;
    uploadMock.mockResolvedValue({ error: { message: "storage unreachable" } });

    const res = await generatePost(new Request("http://test.local/x", { method: "POST" }), runCtx());

    expect(res.status).toBe(500);
    expect(state.runs[0].output_path).toBe("run-1/site.zip");
  });
});

describe("POST /api/site-builder/runs/[id]/generate — which runs may be claimed", () => {
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60 * 1000).toISOString();

  it("claims a failed run, clears its error, and leaves it at review", async () => {
    const { admin, state } = makeWritableAdmin([RUN({ status: "failed", error: "Every page failed to generate." })]);
    adminHolder.admin = admin;

    // Mid-flight, not final: the claim is the thing under test, and the final
    // row would read "review" with a null error whether or not the claim ever
    // touched the failed run's message.
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

    expect(runSiteMock).toHaveBeenCalledTimes(1);
    expect(midFlight).not.toBeNull();
    expect(midFlight!.status).toBe("generating");
    expect(midFlight!.error).toBeNull();
    expect(res.status).toBe(200);
    expect(state.runs[0].status).toBe("review");
    expect(state.runs[0].error).toBeNull();
  });

  it("still claims a queued run", async () => {
    const { admin, state } = makeWritableAdmin([RUN({ status: "queued" })]);
    adminHolder.admin = admin;

    const res = await generatePost(new Request("http://test.local/x", { method: "POST" }), runCtx());

    expect(res.status).toBe(200);
    expect(runSiteMock).toHaveBeenCalledTimes(1);
    expect(state.runs[0].status).toBe("review");
  });

  it("claims a generating run whose row has not moved for 61 minutes", async () => {
    const { admin, state } = makeWritableAdmin([RUN({ status: "generating", updated_at: minutesAgo(61) })]);
    adminHolder.admin = admin;

    const res = await generatePost(new Request("http://test.local/x", { method: "POST" }), runCtx());

    expect(res.status).toBe(200);
    expect(runSiteMock).toHaveBeenCalledTimes(1);
    expect(state.runs[0].status).toBe("review");
  });

  it("refuses a generating run that moved a minute ago", async () => {
    const { admin, state } = makeWritableAdmin([RUN({ status: "generating", updated_at: minutesAgo(1) })]);
    adminHolder.admin = admin;

    const res = await generatePost(new Request("http://test.local/x", { method: "POST" }), runCtx());

    expect(res.status).toBe(409);
    expect(runSiteMock).not.toHaveBeenCalled();
    expect(state.runs[0].status).toBe("generating");
  });

  for (const status of ["review", "approved", "deployed"]) {
    it(`refuses a ${status} run — it has a zip, and the per-page route is the right tool`, async () => {
      const { admin, state } = makeWritableAdmin([RUN({ status })]);
      adminHolder.admin = admin;

      const res = await generatePost(new Request("http://test.local/x", { method: "POST" }), runCtx());

      expect(res.status).toBe(409);
      const message = String((await res.json()).error);
      // The message has to name BOTH the state it found and the states it
      // would accept, or the operator cannot tell why the button did nothing.
      expect(message).toContain(`"${status}"`);
      expect(message).toMatch(/queued/);
      expect(message).toMatch(/failed/);
      expect(runSiteMock).not.toHaveBeenCalled();
      expect(state.runs[0].status).toBe(status);
    });
  }

  it("hands the run's STORED pages to runSite as `resume`", async () => {
    // Recognisable, and deliberately not the shape runSite returns: if the
    // route passed anything else — `{}`, the result, the claimed row's pages
    // as re-derived — this assertion fails.
    const stored = {
      "index.html": { status: "ok", kind: "existing", html: "<html>CARRIED FROM THE LAST ATTEMPT</html>" },
      "about.html": { status: "failed", kind: "existing", error: "boom" },
    };
    const { admin } = makeWritableAdmin([RUN({ status: "failed", pages: stored })]);
    adminHolder.admin = admin;

    const res = await generatePost(new Request("http://test.local/x", { method: "POST" }), runCtx());

    expect(res.status).toBe(200);
    expect(runSiteMock).toHaveBeenCalledTimes(1);
    const args = runSiteMock.mock.calls[0][0] as { resume?: unknown };
    expect(args.resume).toEqual(stored);
  });

  it("passes an empty `resume` for a run that has never generated anything", async () => {
    const { admin } = makeWritableAdmin([RUN({ status: "queued", pages: {} })]);
    adminHolder.admin = admin;

    await generatePost(new Request("http://test.local/x", { method: "POST" }), runCtx());

    const args = runSiteMock.mock.calls[0][0] as { resume?: unknown };
    expect(args.resume).toEqual({});
  });
});

describe("POST /api/site-builder/runs/[id]/pages/[file]/regenerate — a failed run is fixable", () => {
  const pageCtx = (file: string) => ({ params: Promise.resolve({ id: "run-1", file }) });
  const post = (file: string) =>
    regeneratePost(new Request("http://test.local/x", { method: "POST" }), pageCtx(file));

  /** A run that died with its components rewritten and no page standing. */
  const AFTER_FAILURE = {
    "components.js": { status: "ok", kind: "component", name: "Shared components", html: "// REWRITTEN" },
    "index.html": { status: "failed", kind: "existing", error: "boom" },
  };

  it("accepts a page regeneration on a failed run", async () => {
    const { admin } = makeWritableAdmin([RUN({ status: "failed", pages: AFTER_FAILURE, error: "boom" })]);
    adminHolder.admin = admin;

    const res = await post("index.html");

    expect(res.status).not.toBe(409);
    expect(regeneratePageMock).toHaveBeenCalledTimes(1);
  });

  it("promotes the run to review once a REAL page is ok again, clearing the error", async () => {
    const { admin, state } = makeWritableAdmin([RUN({ status: "failed", pages: AFTER_FAILURE, error: "boom" })]);
    adminHolder.admin = admin;

    const res = await post("index.html");

    expect(res.status).toBe(200);
    expect(state.runs[0].status).toBe("review");
    expect(state.runs[0].error).toBeNull();
    const pages = state.runs[0].pages as Record<string, { status: string }>;
    expect(pages["index.html"].status).toBe("ok");
  });

  it("leaves the run failed when the only thing ok is the components file", async () => {
    // The mirror image of the case above: the components file regenerates
    // fine, every actual PAGE is still failed. A components file is not a
    // site, and a run promoted to review here would offer the operator a zip
    // with nothing in it to look at.
    const componentsDown = {
      "components.js": { status: "failed", kind: "component", name: "Shared components", error: "boom" },
      "index.html": { status: "failed", kind: "existing", error: "boom" },
    };
    const { admin, state } = makeWritableAdmin([RUN({ status: "failed", pages: componentsDown, error: "boom" })]);
    adminHolder.admin = admin;

    const res = await post("components.js");

    expect(res.status).toBe(200);
    const pages = state.runs[0].pages as Record<string, { status: string }>;
    // The regeneration itself landed — so "still failed" below is about the
    // promotion rule, not about a regeneration that quietly did nothing.
    expect(pages["components.js"].status).toBe("ok");
    expect(pages["index.html"].status).toBe("failed");
    expect(state.runs[0].status).toBe("failed");
    expect(state.runs[0].error).toBe("boom");
  });

  it("leaves the run failed, and still answers 502, when the regeneration fails", async () => {
    regeneratePageMock.mockResolvedValue({ ok: false, error: "the model refused" });
    const { admin, state } = makeWritableAdmin([RUN({ status: "failed", pages: AFTER_FAILURE, error: "boom" })]);
    adminHolder.admin = admin;

    const res = await post("index.html");

    expect(res.status).toBe(502);
    expect(String((await res.json()).error)).toContain("the model refused");
    expect(state.runs[0].status).toBe("failed");
    expect(state.runs[0].error).toBe("boom");
  });

  it("does not touch the status of a review run", async () => {
    // The sentinel `error` is the assertion that matters: promotion writes
    // `error: null` alongside `status`, so a promotion rule that ignored the
    // run's CURRENT status would wipe this even though "review" → "review"
    // would look like a no-op.
    const reviewPages = {
      "components.js": { status: "ok", kind: "component", name: "Shared components", html: "// REWRITTEN" },
      "index.html": { status: "ok", kind: "existing", html: "<html>a</html>" },
    };
    const { admin, state } = makeWritableAdmin([
      RUN({ status: "review", pages: reviewPages, error: "a stale note from an earlier attempt" }),
    ]);
    adminHolder.admin = admin;

    const res = await post("index.html");

    expect(res.status).toBe(200);
    expect(state.runs[0].status).toBe("review");
    expect(state.runs[0].error).toBe("a stale note from an earlier attempt");
  });

  it("stands aside for a live generation instead of clobbering its progress", async () => {
    // The window is MINUTES wide: the status read happens before a paced AI
    // call that can take a quarter of an hour (hence maxDuration 900), so a
    // "Retry failed pages" click ten seconds later claims the run legitimately
    // and this write would land on top of everything it has since done.
    const { admin, state, uploadMock } = makeWritableAdmin([
      RUN({ status: "failed", pages: AFTER_FAILURE, error: "boom", generation_id: "gen-in-flight" }),
    ]);
    adminHolder.admin = admin;
    const before = JSON.parse(JSON.stringify(state.runs[0].pages));

    const res = await post("index.html");

    expect(res.status).toBe(409);
    expect(String((await res.json()).error)).toMatch(/changed while the page was being rewritten/i);
    expect(state.runs[0].pages).toEqual(before);
    expect(state.runs[0].status).toBe("failed");
    // And nothing reached the object store: the zip path is shared with the
    // live generation, so an upload here would replace ITS archive even though
    // the row write was correctly refused.
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("regenerates normally once the run is released", async () => {
    const { admin, state, uploadMock } = makeWritableAdmin([
      RUN({ status: "failed", pages: AFTER_FAILURE, error: "boom", generation_id: null }),
    ]);
    adminHolder.admin = admin;

    const res = await post("index.html");

    expect(res.status).toBe(200);
    const pages = state.runs[0].pages as Record<string, { status: string; html?: string }>;
    expect(pages["index.html"].status).toBe("ok");
    expect(pages["index.html"].html).toBe("<html>regenerated</html>");
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledWith("builder-sites", "run-1/site.zip");
    expect(state.runs[0].output_path).toBe("run-1/site.zip");
  });

  it("keeps the saved page when re-packaging fails afterwards", async () => {
    const { admin, state, uploadMock } = makeWritableAdmin([
      RUN({ status: "failed", pages: AFTER_FAILURE, error: "boom" }),
    ]);
    adminHolder.admin = admin;
    uploadMock.mockResolvedValue({ error: { message: "storage unreachable" } });

    const res = await post("index.html");

    expect(res.status).toBe(500);
    expect(String((await res.json()).error)).toContain("storage unreachable");
    // The page is the expensive part and it is already stored — rolling the
    // row back to keep it consistent with a stale zip would throw away the
    // only thing this request paid for.
    const pages = state.runs[0].pages as Record<string, { status: string; html?: string }>;
    expect(pages["index.html"].status).toBe("ok");
    expect(pages["index.html"].html).toBe("<html>regenerated</html>");
  });

  it("does NOT promote a failed run when the packaging that would give it a zip fails", async () => {
    /**
     * Promotion and `output_path` are written BEFORE the upload (ownership
     * first), so an upload failure on a run that never had a zip would leave
     * "review" plus a path to nothing — and Approve → Deploy would then run,
     * with deploy creating the subdomain BEFORE downloading the zip. A stray
     * empty subdomain and a failed deployment row, for a site never packaged.
     */
    const { admin, state, uploadMock } = makeWritableAdmin([
      RUN({ status: "failed", pages: AFTER_FAILURE, error: "boom", output_path: null }),
    ]);
    adminHolder.admin = admin;
    uploadMock.mockResolvedValue({ error: { message: "storage unreachable" } });

    const res = await post("index.html");

    expect(res.status).toBe(500);
    expect(state.runs[0].status).toBe("failed");
    expect(state.runs[0].error).toBe("boom");
    expect(state.runs[0].output_path).toBeNull();
    // The regenerated page itself is still kept — it is the expensive part,
    // and the next attempt re-packages rather than re-buying it.
    const pages = state.runs[0].pages as Record<string, { status: string; html?: string }>;
    expect(pages["index.html"].status).toBe("ok");
    expect(pages["index.html"].html).toBe("<html>regenerated</html>");
  });

  it("keeps the promotion when the run already had a zip to fall back on", async () => {
    // The discriminating half: a run WITH a prior object is not left worse off
    // by a failed re-package — the path still names real bytes, one revision
    // out of date, so nothing is undone.
    const { admin, state, uploadMock } = makeWritableAdmin([
      RUN({ status: "failed", pages: AFTER_FAILURE, error: "boom", output_path: "run-1/site.zip" }),
    ]);
    adminHolder.admin = admin;
    uploadMock.mockResolvedValue({ error: { message: "storage unreachable" } });

    const res = await post("index.html");

    expect(res.status).toBe(500);
    expect(state.runs[0].status).toBe("review");
    expect(state.runs[0].output_path).toBe("run-1/site.zip");
  });

  /**
   * TWO REGENERATIONS AT ONCE — the mainline hazard, not an exotic one.
   *
   * `runSite` marks a run "ok" when ANY real page succeeded, so the ordinary
   * partial failure (5 of 7 pages) lands at "review", where per-page Retry is
   * the only tool. Each regeneration rebuilds the WHOLE `pages` blob from the
   * snapshot it read minutes earlier, so the second to land would revert the
   * first's page and upload a zip without it — an AI call paid for and thrown
   * away.
   */
  describe("two at once", () => {
    const TWO_DOWN = {
      "components.js": { status: "ok", kind: "component", name: "Shared components", html: "// REWRITTEN" },
      "index.html": { status: "failed", kind: "existing", error: "boom" },
      "about.html": { status: "failed", kind: "existing", error: "boom" },
    };

    /** A promise a test resolves by hand, so both handlers can be held INSIDE
     *  their AI call — the minutes-wide window where they overlap for real. */
    const defer = <T,>() => {
      let resolve!: (v: T) => void;
      const promise = new Promise<T>((r) => (resolve = r));
      return { promise, resolve };
    };

    it("refuses the second write and keeps the first's page", async () => {
      const { admin, state, uploadMock } = makeWritableAdmin([RUN({ status: "review", pages: TWO_DOWN })]);
      adminHolder.admin = admin;

      const forIndex = defer<{ ok: boolean; html: string }>();
      const forAbout = defer<{ ok: boolean; html: string }>();
      regeneratePageMock.mockImplementation(async (args: { file: string }) =>
        args.file === "index.html" ? forIndex.promise : forAbout.promise,
      );

      const indexReq = post("index.html");
      const aboutReq = post("about.html");
      // Both are past their row READ and sitting in the AI call — which is the
      // whole premise: they share one stale snapshot.
      await vi.waitFor(() => expect(regeneratePageMock).toHaveBeenCalledTimes(2));

      forAbout.resolve({ ok: true, html: "<html>ABOUT REWRITTEN</html>" });
      const aboutRes = await aboutReq;
      forIndex.resolve({ ok: true, html: "<html>INDEX REWRITTEN</html>" });
      const indexRes = await indexReq;

      expect(aboutRes.status).toBe(200);
      expect(indexRes.status).toBe(409);
      expect(String((await indexRes.json()).error)).toMatch(/changed while the page was being rewritten/i);

      // The winner's page survived — that is the paid-for work the loser would
      // have reverted — and the loser's own page never landed.
      const pages = state.runs[0].pages as Record<string, { status: string; html?: string }>;
      expect(pages["about.html"].status).toBe("ok");
      expect(pages["about.html"].html).toBe("<html>ABOUT REWRITTEN</html>");
      expect(pages["index.html"].status).toBe("failed");
      // …and the zip in the bucket is the winner's, uploaded once.
      expect(uploadMock).toHaveBeenCalledTimes(1);
    });
  });

  it("refuses a regeneration whose run moved under it, and uploads nothing", async () => {
    // The residual race, and it is reachable: a retry AFTER a packaging failure
    // makes no AI calls at all and finishes in seconds, so it can start and
    // finish entirely inside one regeneration's call. `generation_id` stays
    // null throughout, so this is the `updated_at` CAS and nothing else.
    const { admin, state, uploadMock } = makeWritableAdmin([
      RUN({ status: "failed", pages: AFTER_FAILURE, error: "boom", generation_id: null }),
    ]);
    adminHolder.admin = admin;
    const before = JSON.parse(JSON.stringify(state.runs[0].pages));

    regeneratePageMock.mockImplementation(async () => {
      // …a fast retry claimed, ran and released the run while we were writing.
      state.runs[0].updated_at = "2026-07-29T12:07:00.000Z";
      return { ok: true, html: "<html>regenerated</html>" };
    });

    const res = await post("index.html");

    expect(res.status).toBe(409);
    expect(String((await res.json()).error)).toMatch(/changed while the page was being rewritten/i);
    expect(state.runs[0].pages).toEqual(before);
    expect(state.runs[0].status).toBe("failed");
    // The zip path is shared with whoever moved the row, so an upload here
    // would replace THEIR archive even though the row write was refused.
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("still refuses a queued run", async () => {
    const { admin, state } = makeWritableAdmin([RUN({ status: "queued", pages: AFTER_FAILURE })]);
    adminHolder.admin = admin;

    const res = await post("index.html");

    expect(res.status).toBe(409);
    expect(String((await res.json()).error)).toContain(`"queued"`);
    expect(regeneratePageMock).not.toHaveBeenCalled();
    expect(state.runs[0].status).toBe("queued");
  });
});

describe("DELETE /api/site-builder/runs/[id] — a live run is not debris", () => {
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60 * 1000).toISOString();
  const del = () => runDelete(new Request("http://test.local/x", { method: "DELETE" }), runCtx());

  it("refuses a generating run quiet for 40 minutes — well inside the reclaim window", async () => {
    /**
     * The exact gap this closes. Deletion's grace was ten minutes while the
     * generate route's reclaim rule had been raised to sixty, so a HEALTHY
     * paced run — one that can legitimately write nothing for ~21 minutes while
     * it waits out a provider's rate limit — was deletable out from under
     * itself, taking its zip with it.
     */
    const { admin, state, removed } = makeWritableAdmin([
      RUN({ status: "generating", generation_id: "gen-live", updated_at: minutesAgo(40) }),
    ]);
    adminHolder.admin = admin;

    const res = await del();

    expect(res.status).toBe(409);
    expect(state.runs).toHaveLength(1);
    expect(removed).toHaveLength(0);
  });

  it("still deletes a generating run whose row has not moved for 61 minutes", async () => {
    // The discriminating half: past the reclaim window the generation really is
    // presumed dead, and the run is debris the operator may clear.
    const { admin, state, removed } = makeWritableAdmin([
      RUN({ status: "generating", output_path: "run-1/site.zip", updated_at: minutesAgo(61) }),
    ]);
    adminHolder.admin = admin;

    const res = await del();

    expect(res.status).toBe(200);
    expect(state.runs).toHaveLength(0);
    // Storage first, row second — an orphaned zip with no row is invisible debris.
    expect(removed).toEqual(["run-1/site.zip"]);
  });

  it("deletes a review run at once — the grace is only for runs that may still be working", async () => {
    const { admin, state } = makeWritableAdmin([RUN({ status: "review", updated_at: minutesAgo(0) })]);
    adminHolder.admin = admin;

    const res = await del();

    expect(res.status).toBe(200);
    expect(state.runs).toHaveLength(0);
  });
});

describe("POST /api/site-builder/runs/[id]/recover — releasing a wedged run", () => {
  const post = () => recoverPost(new Request("http://test.local/x", { method: "POST" }), runCtx());

  /**
   * The run this route exists for: claimed by an attempt that is gone (or that
   * the operator no longer wants), so the token is set and the status is stuck.
   */
  const WEDGED = { status: "generating", generation_id: "gen-in-flight", error: null };

  it("releases a generating run to failed, clearing the claim token", async () => {
    const { admin, state } = makeWritableAdmin([
      RUN({ ...WEDGED, pages: { "index.html": { status: "ok", kind: "existing", html: "<html>a</html>" } } }),
    ]);
    adminHolder.admin = admin;

    const res = await post();

    expect(res.status).toBe(200);
    expect(state.runs[0].status).toBe("failed");
    /**
     * The token is the whole safety story: nulling it is what makes an attempt
     * that is STILL RUNNING discard its own writes instead of racing whatever
     * the operator does next. A recover that flipped the status but left the
     * token would hand the run back to the very attempt it just disowned.
     */
    expect(state.runs[0].generation_id).toBeNull();

    const message = String(state.runs[0].error);
    expect(message).toMatch(/generating/i);
    expect(message).toMatch(/retry/i);
    // The response carries the released row, so the screen can render it
    // without a second round trip.
    const body = (await res.json()) as { run: Row };
    expect(body.run.status).toBe("failed");
    expect(body.run.generation_id).toBeNull();

    // Pages are DELIBERATELY untouched — they are what makes the retry cheap.
    expect(Object.keys(state.runs[0].pages as Row)).toEqual(["index.html"]);
  });

  it("writes an activity_log row naming the transition", async () => {
    const { admin, state } = makeWritableAdmin([RUN(WEDGED)]);
    adminHolder.admin = admin;

    const res = await post();

    expect(res.status).toBe(200);
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0]).toMatchObject({
      user_id: "user-1",
      action: "site_builder.run.recovered",
      entity_type: "builder_run",
      entity_id: "run-1",
    });
  });

  /**
   * The other wedge, and the one nothing else could clear: /generate's terminal
   * write sets "review" and deliberately KEEPS its token across the zip upload,
   * so a process that dies in that window leaves "review" + a token nobody
   * owns. /regenerate then 409s forever (`generation_id IS NULL` never matches),
   * /generate refuses "review", and before this the only escape was deleting
   * the run.
   */
  describe("a dangling token on a run that is no longer generating", () => {
    it("clears the token and leaves the run at review", async () => {
      const pages = { "index.html": { status: "ok", kind: "existing", html: "<html>a</html>" } };
      const { admin, state } = makeWritableAdmin([
        RUN({ status: "review", generation_id: "gen-orphaned", pages, output_path: "run-1/site.zip", error: null }),
      ]);
      adminHolder.admin = admin;

      const res = await post();

      expect(res.status).toBe(200);
      expect(state.runs[0].generation_id).toBeNull();
      // NOT demoted: this run has a reviewable site, and the leak was
      // bookkeeping. Demoting it would cost the operator their place in the
      // flow to fix a token nobody owns.
      expect(state.runs[0].status).toBe("review");
      expect(state.runs[0].error).toBeNull();
      expect(state.runs[0].pages).toEqual(pages);
      expect(state.runs[0].output_path).toBe("run-1/site.zip");

      const body = (await res.json()) as { run: Row };
      expect(body.run.status).toBe("review");
      expect(body.run.generation_id).toBeNull();
      expect(state.activity[0]).toMatchObject({ new_value: { from: "review", to: "review" } });
    });

    it("still demotes a generating run to failed — the status rule is not blanket", async () => {
      // The discriminating pair for the case above: same route, same clearing
      // of the token, opposite status handling.
      const { admin, state } = makeWritableAdmin([RUN(WEDGED)]);
      adminHolder.admin = admin;

      const res = await post();

      expect(res.status).toBe(200);
      expect(state.runs[0].status).toBe("failed");
      expect(state.runs[0].generation_id).toBeNull();
    });

    it("409s when the token is cleared by someone else first", async () => {
      const { admin, state } = makeWritableAdmin([RUN({ status: "review", generation_id: "gen-orphaned" })]);
      adminHolder.admin = admin;
      // The dying attempt's step-3 release landing late, or a second operator
      // recovering the same run — either way our CAS must not force it.
      const original = admin.from;
      let hooked = false;
      adminHolder.admin = {
        ...admin,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        from(table: string): any {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const inner: any = original(table);
          if (table !== "builder_runs") return inner;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const wrap: any = {
            select: (...a: unknown[]) => { inner.select(...a); return wrap; },
            update: (...a: unknown[]) => { inner.update(...a); return wrap; },
            eq: (...a: unknown[]) => { inner.eq(...a); return wrap; },
            is: (...a: unknown[]) => { inner.is(...a); return wrap; },
            maybeSingle: () => inner.maybeSingle(),
            then: (r: unknown) => inner.then(r),
            single: async () => {
              const out = await inner.single();
              if (!hooked) { hooked = true; state.runs[0].generation_id = null; }
              return out;
            },
          };
          return wrap;
        },
      };

      const res = await post();

      expect(hooked).toBe(true);
      expect(res.status).toBe(409);
      expect(String((await res.json()).error)).toMatch(/changed/i);
      expect(state.activity).toHaveLength(0);
    });
  });

  for (const status of ["queued", "review", "approved", "deployed", "failed"]) {
    it(`refuses a ${status} run with no claim to release, naming what it found`, async () => {
      const { admin, state } = makeWritableAdmin([RUN({ status, generation_id: null })]);
      adminHolder.admin = admin;

      const res = await post();

      expect(res.status).toBe(409);
      const message = String((await res.json()).error);
      expect(message).toContain(`"${status}"`);
      expect(message).toContain(`"generating"`);
      expect(state.runs[0].status).toBe(status);
      expect(state.activity).toHaveLength(0);
    });
  }

  it("404s for a run that is not there", async () => {
    const { admin } = makeWritableAdmin([]);
    adminHolder.admin = admin;

    const res = await post();

    expect(res.status).toBe(404);
  });

  it("409s rather than forcing it when the row moves between the read and the write", async () => {
    const { admin, state } = makeWritableAdmin([RUN(WEDGED)]);
    adminHolder.admin = admin;

    /**
     * The race this route is most likely to lose, and the one that matters: the
     * very generation it is about to disown finishes on its own in the gap
     * between the handler's status read and its CAS write. Without the
     * `.eq("status", "generating")` on the update, this recover would stamp
     * "failed" over a run that had just reached "review" — with a zip in the
     * bucket and no way back.
     *
     * Driven by hooking the handler's READ (the only `.single()` on this path)
     * and mutating the row the instant it returns, which is exactly that gap.
     * The chain object is rebuilt rather than spread because the underlying
     * fake's methods return ITS api, not ours — a spread would lose the hook
     * the moment the handler called `.select()`.
     */
    let hooked = false;
    adminHolder.admin = {
      ...admin,
      from(table: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inner: any = admin.from(table);
        if (table !== "builder_runs") return inner;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wrap: any = {
          select: (...a: unknown[]) => { inner.select(...a); return wrap; },
          update: (...a: unknown[]) => { inner.update(...a); return wrap; },
          eq: (...a: unknown[]) => { inner.eq(...a); return wrap; },
          is: (...a: unknown[]) => { inner.is(...a); return wrap; },
          maybeSingle: () => inner.maybeSingle(),
          then: (res: unknown) => inner.then(res),
          single: async () => {
            const out = await inner.single();
            if (!hooked) {
              hooked = true;
              // …the generation finished and published while we were deciding.
              state.runs[0].status = "review";
              state.runs[0].generation_id = null;
            }
            return out;
          },
        };
        return wrap;
      },
    };

    const res = await post();

    // The hook fired — otherwise this test proves nothing about the CAS.
    expect(hooked).toBe(true);
    expect(res.status).toBe(409);
    expect(String((await res.json()).error)).toMatch(/changed/i);
    // Untouched: the run kept the state the winner set.
    expect(state.runs[0].status).toBe("review");
    expect(state.activity).toHaveLength(0);
  });
});

/**
 * The background processor: the route that lets a run start (and a parked run
 * resume) with NO screen open. `generateRunNow` is stubbed via the holder —
 * these tests are about the route's secret gate, its eligibility filter, and
 * its single-flight cap, not about generation itself.
 */
describe("POST /api/site-builder/process — the background processor", () => {
  const SECRET = "processor-secret";
  const post = (secret?: string) =>
    processPost(
      new Request("http://test.local/api/site-builder/process", {
        method: "POST",
        headers: secret === undefined ? {} : { "x-wge-secret": secret },
      }),
    );

  const minutesFromNow = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

  beforeEach(() => {
    vi.stubEnv("WGE_PROCESSOR_SECRET", SECRET);
    generateRunNowHolder.impl = generateRunNowMock;
    generateRunNowMock.mockResolvedValue({ kind: "done", run: RUN({ status: "review" }) });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("401s a wrong secret — and generation is never touched", async () => {
    const { admin } = makeWritableAdmin([RUN({ status: "queued" })]);
    adminHolder.admin = admin;

    const res = await post("not-the-secret");

    expect(res.status).toBe(401);
    expect(generateRunNowMock).not.toHaveBeenCalled();
  });

  it("401s a missing secret header", async () => {
    const { admin } = makeWritableAdmin([RUN({ status: "queued" })]);
    adminHolder.admin = admin;

    const res = await post(undefined);

    expect(res.status).toBe(401);
    expect(generateRunNowMock).not.toHaveBeenCalled();
  });

  it("503s when the secret is not configured, even with a matching header", async () => {
    vi.stubEnv("WGE_PROCESSOR_SECRET", "");
    const { admin } = makeWritableAdmin([RUN({ status: "queued" })]);
    adminHolder.admin = admin;

    const res = await post(SECRET);

    expect(res.status).toBe(503);
    expect(generateRunNowMock).not.toHaveBeenCalled();
  });

  it("kicks a queued run", async () => {
    const { admin } = makeWritableAdmin([RUN({ status: "queued" })]);
    adminHolder.admin = admin;

    const res = await post(SECRET);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ processed: 1, runId: "run-1", kind: "done" });
    expect(generateRunNowMock).toHaveBeenCalledTimes(1);
    expect(generateRunNowMock.mock.calls[0][1]).toBe("run-1");
  });

  it("resumes a parked run whose resume_at is due — an ABSENT auto_resume key means true", async () => {
    // Parking never writes auto_resume; the default has to live in the
    // processor's read, and it has to default ON or parking is just failing
    // with extra steps.
    const { admin } = makeWritableAdmin([
      RUN({ status: "failed", resume_at: minutesFromNow(-5), options: {}, error: "Paused — quota exhausted." }),
    ]);
    adminHolder.admin = admin;

    const res = await post(SECRET);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ processed: 1, runId: "run-1" });
    expect(generateRunNowMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT resume a parked run the operator switched to manual", async () => {
    const { admin } = makeWritableAdmin([
      RUN({ status: "failed", resume_at: minutesFromNow(-5), options: { auto_resume: false } }),
    ]);
    adminHolder.admin = admin;

    const res = await post(SECRET);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 0 });
    expect(generateRunNowMock).not.toHaveBeenCalled();
  });

  it("does NOT resume a parked run whose resume_at is still in the future", async () => {
    const { admin } = makeWritableAdmin([
      RUN({ status: "failed", resume_at: minutesFromNow(30), options: {} }),
    ]);
    adminHolder.admin = admin;

    const res = await post(SECRET);

    expect(await res.json()).toEqual({ processed: 0 });
    expect(generateRunNowMock).not.toHaveBeenCalled();
  });

  it("does NOT touch an ordinary failed run — no resume_at means the retry is the operator's", async () => {
    const { admin } = makeWritableAdmin([
      RUN({ status: "failed", resume_at: null, error: "Every page failed to generate." }),
    ]);
    adminHolder.admin = admin;

    const res = await post(SECRET);

    expect(await res.json()).toEqual({ processed: 0 });
    expect(generateRunNowMock).not.toHaveBeenCalled();
  });

  it("processes AT MOST ONE run per invocation — the oldest — even with several eligible", async () => {
    // Single-flight is the burst protection: generation takes minutes and the
    // poller re-fires every ~60s, so the second run's turn comes next tick.
    const { admin } = makeWritableAdmin([
      RUN({ id: "run-newer", status: "queued", created_at: "2026-07-29T11:00:00.000Z" }),
      RUN({ id: "run-older", status: "queued", created_at: "2026-07-29T10:00:00.000Z" }),
    ]);
    adminHolder.admin = admin;

    const res = await post(SECRET);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ processed: 1, runId: "run-older" });
    expect(generateRunNowMock).toHaveBeenCalledTimes(1);
    expect(generateRunNowMock.mock.calls[0][1]).toBe("run-older");
  });

  it("reports a refused outcome as processed work, not as an idle tick", async () => {
    // A refusal means the claim CAS lost a race (an open run screen kicked the
    // same run first) — work WAS attempted, and reporting processed: 0 would
    // make a busy system indistinguishable from an empty queue.
    generateRunNowMock.mockResolvedValue({ kind: "refused", status: 409, error: "Generation already started for this run." });
    const { admin } = makeWritableAdmin([RUN({ status: "queued" })]);
    adminHolder.admin = admin;

    const res = await post(SECRET);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ processed: 1, runId: "run-1", kind: "refused" });
  });

  it("answers 200 when the RUN itself fails — a failed run is not a failed processor call", async () => {
    generateRunNowMock.mockResolvedValue({ kind: "done", run: RUN({ status: "failed", error: "boom" }) });
    const { admin } = makeWritableAdmin([RUN({ status: "queued" })]);
    adminHolder.admin = admin;

    const res = await post(SECRET);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ processed: 1, kind: "done" });
  });
});

/**
 * The rounds loop inside `generateRunNow` (lib/site-builder/generateRun.ts),
 * driven directly with injected deps — instant `sleep` that records requested
 * waits, a fixed clock, a tiny escalation schedule, and stubbed `runSite` /
 * `probeQuota` — so no test here ever actually waits, probes, or touches the
 * DB/crypto behind the production quota lookup. The HTTP mapping above stays
 * the routes' own tests; these are about when the loop retries, how long it
 * chooses to wait, and when it parks.
 */
describe("generateRunNow — retry rounds, quota-aware waits, parking", () => {
  /** The fixed "now" every test runs at. */
  const T0 = 1_000_000;

  const okPage = (html = "<html>gen</html>") => ({ status: "ok", kind: "existing", html });
  const throttled = (retryAfterMs?: number) => ({
    status: "failed",
    kind: "existing",
    error: "429: too many requests",
    retryable: true,
    ...(retryAfterMs !== undefined && { retryAfterMs }),
  });
  const dead = (error = "401: API key not valid") => ({
    status: "failed",
    kind: "existing",
    error,
    retryable: false,
  });

  /** A finished pass: one ok page, zip ready. */
  const finished = () => ({
    ok: true,
    pages: { "index.html": okPage(), "about.html": okPage("<html>about</html>") },
    zipBytes: new Uint8Array([9]),
  });
  /** A pass that left one throttled page standing. */
  const oneThrottled = (retryAfterMs?: number) => ({
    ok: true,
    pages: { "index.html": okPage(), "about.html": throttled(retryAfterMs) },
  });

  function harness(results: unknown[], over: Partial<GenerateRunDeps> = {}) {
    const { admin, state, uploadMock } = makeWritableAdmin([RUN()]);
    const impl = vi.fn();
    for (const r of results) impl.mockResolvedValueOnce(r);
    const waits: number[] = [];
    const sleepMock = vi.fn(async (ms: number) => {
      waits.push(ms);
    });
    const deps: GenerateRunDeps = {
      runSiteImpl: impl as unknown as GenerateRunDeps["runSiteImpl"],
      // No provider identity by default: the loop must run purely on the
      // schedule without ever reaching for the production DB/crypto lookup.
      quotaTarget: async () => null,
      sleep: sleepMock,
      now: () => T0,
      waitsMs: [10, 20],
      budgetMs: 100_000,
      ...over,
    };
    const call = () => generateRunNow(admin as unknown as Parameters<typeof generateRunNow>[0], "run-1", deps);
    return { admin, state, uploadMock, impl, waits, sleepMock, deps, call };
  }

  /** A quota lookup that "knows" the provider, for the probe tests. */
  const minimaxTarget = async () => ({ providerKey: "minimax", credentials: { api_key: "k" } });
  const exhaustedSnapshot = (resetAt: Date) => async () => ({
    providerKey: "minimax",
    windows: [{ label: "5-hour window", remainingTokens: 0, resetAt }],
    fetchedAt: new Date(T0),
  });

  it("retries a retryable failure in a second round, resuming from the first round's pages", async () => {
    const round1 = oneThrottled();
    const { state, impl, waits, call } = harness([round1, finished()]);

    const outcome = await call();

    expect(outcome.kind).toBe("done");
    expect(impl).toHaveBeenCalledTimes(2);
    // The second round resumes from the FIRST round's pages — the carried
    // `ok` page is what makes round two cost only the page that failed.
    expect((impl.mock.calls[1][0] as { resume: unknown }).resume).toEqual(round1.pages);
    expect(waits).toEqual([10]);
    expect(state.runs[0].status).toBe("review");
    expect(state.runs[0].error).toBeNull();
    expect(state.runs[0].resume_at).toBeNull();
    expect(state.runs[0].generation_id).toBeNull();
  });

  it("stops after one round when every failure is terminal — no wait, and the real reason", async () => {
    const { state, impl, waits, uploadMock, call } = harness([
      { ok: false, pages: { "index.html": dead("401: API key not valid") } },
    ]);

    const outcome = await call();

    expect(outcome.kind).toBe("done");
    expect((outcome as { run: Row }).run.status).toBe("failed");
    expect(impl).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
    // The page's own terminal error, not the generic "Every page failed" —
    // retrying cannot fix a bad key, so the operator needs the actual reason.
    expect(String(state.runs[0].error)).toContain("401: API key not valid");
    expect(state.runs[0].status).toBe("failed");
    expect(state.runs[0].generation_id).toBeNull();
    expect(state.runs[0].resume_at).toBeNull();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("waits out a vendor Retry-After larger than the schedule", async () => {
    const { waits, call } = harness([oneThrottled(45_000), finished()]);

    const outcome = await call();

    expect(outcome.kind).toBe("done");
    // 45s from the vendor beats 10ms from the schedule — dropping the max()
    // would retry into the very throttle the vendor priced.
    expect(waits).toEqual([45_000]);
  });

  it("waits for the probed quota reset, not the schedule, when the reset fits the budget", async () => {
    const resetAt = new Date(T0 + 5_000);
    const { state, waits, call } = harness([oneThrottled(), finished()], {
      quotaTarget: minimaxTarget,
      probeQuotaImpl: exhaustedSnapshot(resetAt) as unknown as GenerateRunDeps["probeQuotaImpl"],
    });

    const outcome = await call();

    expect(outcome.kind).toBe("done");
    expect(waits).toEqual([5_000]);
    expect(state.runs[0].status).toBe("review");
  });

  it("parks the run — released, with resume_at at the reset — when the window resets beyond the budget", async () => {
    const resetAt = new Date(T0 + 60_000);
    const { state, impl, waits, uploadMock, call } = harness([oneThrottled()], {
      budgetMs: 10_000,
      quotaTarget: minimaxTarget,
      probeQuotaImpl: exhaustedSnapshot(resetAt) as unknown as GenerateRunDeps["probeQuotaImpl"],
    });

    const outcome = await call();

    expect(outcome.kind).toBe("parked");
    expect(impl).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
    expect(state.runs[0].status).toBe("failed");
    expect(state.runs[0].resume_at).toBe(resetAt.toISOString());
    // The token is RELEASED by the park write — a parked run left claimed
    // could never be resumed by the processor or the operator.
    expect(state.runs[0].generation_id).toBeNull();
    expect(String(state.runs[0].error)).toContain("quota is exhausted");
    expect(String(state.runs[0].error)).toContain(resetAt.toISOString());
    expect(uploadMock).not.toHaveBeenCalled();
    // The round's finished page rides the park write, so the resume costs
    // only the page that failed.
    expect((state.runs[0].pages as Record<string, { status: string }>)["index.html"].status).toBe("ok");
  });

  it("parks with resume_at = now + wait when the schedule itself would blow the budget", async () => {
    const { state, impl, sleepMock, call } = harness([oneThrottled()], { budgetMs: 5, waitsMs: [10] });

    const outcome = await call();

    expect(outcome.kind).toBe("parked");
    expect(impl).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
    expect(state.runs[0].status).toBe("failed");
    expect(state.runs[0].resume_at).toBe(new Date(T0 + 10).toISOString());
    expect(state.runs[0].generation_id).toBeNull();
    expect(String(state.runs[0].error)).toMatch(/kept throttling/);
  });

  it("proceeds on the schedule when the probe throws or knows nothing — the probe can never fail a run", async () => {
    const probes = [
      async () => {
        throw new Error("probe endpoint down");
      },
      async () => null,
    ];
    for (const probe of probes) {
      const { state, waits, call } = harness([oneThrottled(), finished()], {
        quotaTarget: minimaxTarget,
        probeQuotaImpl: probe as unknown as GenerateRunDeps["probeQuotaImpl"],
      });

      const outcome = await call();

      expect(outcome.kind).toBe("done");
      expect(waits).toEqual([10]);
      expect(state.runs[0].status).toBe("review");
    }
  });

  it("marks the next attempt on the still-generating row during a wait, and clears it at the end", async () => {
    const h = harness([oneThrottled(), finished()]);
    const seen: { resume_at: unknown; status: unknown }[] = [];
    // Captured AT the sleep — the only moment the marker is meaningful: the
    // run screen reads `resume_at` on a "generating" row as "next attempt at".
    h.deps.sleep = async () => {
      seen.push({ resume_at: h.state.runs[0].resume_at, status: h.state.runs[0].status });
    };

    const outcome = await h.call();

    expect(outcome.kind).toBe("done");
    expect(seen).toEqual([{ resume_at: new Date(T0 + 10).toISOString(), status: "generating" }]);
    // …and the terminal write cleared it: a finished run with a leftover
    // "next attempt" time would show a countdown to nothing.
    expect(h.state.runs[0].resume_at).toBeNull();
  });

  it("wires onOutput into the live registry, starts it clean on claim, and clears it on terminal", async () => {
    // A PREVIOUS attempt's leftovers. If the claim did not clear them, the
    // fresh attempt would show a stale tail beside a live generation.
    recordOutput("run-1", "stale.html", "left over from the last attempt");

    const h = harness([]);
    let atClaim: unknown;
    let midRun: unknown;
    h.deps.runSiteImpl = (async (args: { onOutput?: (file: string, delta: string) => void }) => {
      atClaim = liveSnapshot("run-1");
      args.onOutput?.("index.html", "<html>st");
      args.onOutput?.("index.html", "reamed</html>");
      midRun = liveSnapshot("run-1");
      return finished();
    }) as unknown as GenerateRunDeps["runSiteImpl"];

    const outcome = await h.call();

    expect(outcome.kind).toBe("done");
    // Clean at claim — the stale entry is gone before the first page starts.
    expect(atClaim).toEqual([]);
    // Wired: the engine's deltas landed in the registry, accumulated per file.
    expect(midRun).toEqual([
      { file: "index.html", chars: 21, lastChunkAt: expect.any(Number), tail: "<html>streamed</html>" },
    ]);
    // And a finished attempt leaves nothing behind for the poller to misread.
    expect(liveSnapshot("run-1")).toEqual([]);
  });

  it("a parked attempt drops its live feed too", async () => {
    const h = harness([], { budgetMs: 5, waitsMs: [10] });
    h.impl.mockImplementationOnce(async (args: { onOutput?: (file: string, delta: string) => void }) => {
      args.onOutput?.("about.html", "partial output");
      return oneThrottled();
    });

    const outcome = await h.call();

    expect(outcome.kind).toBe("parked");
    // The park released the run; its live tail describes a generation that is
    // no longer writing and must not linger until the resume.
    expect(liveSnapshot("run-1")).toEqual([]);
  });
});

/**
 * The live-output route: a Map lookup behind the operator guard, polled every
 * ~2s by the run screen. No DB in sight — the registry tests own the data
 * semantics; these pin the route's shape and its guard.
 */
describe("GET /api/site-builder/runs/[id]/live", () => {
  const get = () => liveGet(new Request("http://test.local/api/site-builder/runs/run-1/live"), ctx());

  afterEach(() => {
    clearLive("run-1");
  });

  it("returns the run's live snapshot with the server's own clock", async () => {
    recordOutput("run-1", "index.html", "<html>partial");

    const res = await get();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { now: number; files: unknown };
    // `now` is the reference the client subtracts lastChunkAt from — one
    // clock, no skew.
    expect(typeof body.now).toBe("number");
    expect(body.files).toEqual([
      { file: "index.html", chars: 13, lastChunkAt: expect.any(Number), tail: "<html>partial" },
    ]);
  });

  it("answers an idle or unknown run with an empty list, not a 404", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ files: [] });
  });

  it("guards auth: an unauthenticated caller gets a 401 and no tail", async () => {
    guardHolder.result = { error: 401 };
    recordOutput("run-1", "index.html", "output the outsider must not see");

    const res = await get();

    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain("outsider");
  });
});
