import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A template is chosen WITH the client on the submission form. The generator
 * must then build with THAT template rather than making the operator re-decide
 * it from the brief — and the default has to live at the route, not only in
 * the new-site screen, so every caller inherits it.
 */

const guard = vi.hoisted(() => vi.fn(async () => ({ userId: "user-1" })));
const adminRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/site-studio/service/guard", () => ({
  guard,
  guardError: (e: unknown) => new Response(JSON.stringify({ error: e }), { status: 403 }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminRef.current }));

type Lead = { id: string; deleted_at: null; recommended_template_id: string | null };

/** Minimal fake covering only the calls this route makes. */
function makeAdmin(opts: { lead: Lead | null; templateIds: string[] }) {
  const inserted: Record<string, unknown>[] = [];
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self,
        eq: self,
        is: self,
        insert: (row: Record<string, unknown>) => {
          inserted.push({ table, ...row });
          return chain;
        },
        single: async () => {
          if (table === "leads") return { data: opts.lead, error: opts.lead ? null : { message: "no rows" } };
          if (table === "builder_templates") {
            // eq() was chained with the id; the fake resolves against whatever
            // the route asked to insert or look up, tracked below.
            const wanted = chain.__wantedTemplateId as string | undefined;
            const found = wanted && opts.templateIds.includes(wanted);
            return { data: found ? { id: wanted } : null, error: found ? null : { message: "no rows" } };
          }
          const row = inserted[inserted.length - 1] ?? {};
          return { data: { id: "run-1", ...row }, error: null };
        },
      });
      // Capture the id the route filters templates by.
      chain.eq = (col: string, val: unknown) => {
        if (table === "builder_templates" && col === "id") chain.__wantedTemplateId = val;
        return chain;
      };
      return chain;
    },
  };
  return { admin, inserted };
}

async function post(body: unknown) {
  const { POST } = await import("@/app/api/site-builder/runs/route");
  return POST(new Request("http://x/api/site-builder/runs", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.resetModules();
  guard.mockResolvedValue({ userId: "user-1" });
});

const TPL_A = "3f1e5a1e-0000-4000-8000-00000000000a";
const TPL_B = "3f1e5a1e-0000-4000-8000-00000000000b";

describe("POST /api/site-builder/runs — template selection", () => {
  it("uses the lead's recommended template when none is supplied", async () => {
    const { admin, inserted } = makeAdmin({
      lead: { id: "lead-1", deleted_at: null, recommended_template_id: TPL_A },
      templateIds: [TPL_A],
    });
    adminRef.current = admin;

    const res = await post({ lead_id: "lead-1" });
    expect(res.status).toBe(201);
    const run = inserted.find((r) => r.table === "builder_runs");
    expect(run?.template_id).toBe(TPL_A);
  });

  it("lets an explicit template_id override the recommendation", async () => {
    const { admin, inserted } = makeAdmin({
      lead: { id: "lead-1", deleted_at: null, recommended_template_id: TPL_A },
      templateIds: [TPL_A, TPL_B],
    });
    adminRef.current = admin;

    const res = await post({ lead_id: "lead-1", template_id: TPL_B });
    expect(res.status).toBe(201);
    const run = inserted.find((r) => r.table === "builder_runs");
    expect(run?.template_id).toBe(TPL_B);
  });

  it("refuses clearly when there is neither a choice nor a recommendation", async () => {
    const { admin } = makeAdmin({
      lead: { id: "lead-1", deleted_at: null, recommended_template_id: null },
      templateIds: [TPL_A],
    });
    adminRef.current = admin;

    const res = await post({ lead_id: "lead-1" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/no recommended template/i);
  });

  it("still requires a lead", async () => {
    const { admin } = makeAdmin({ lead: null, templateIds: [] });
    adminRef.current = admin;
    const res = await post({});
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/lead_id is required/i);
  });

  it("404s when the recommended template has since been deleted", async () => {
    const { admin } = makeAdmin({
      lead: { id: "lead-1", deleted_at: null, recommended_template_id: TPL_A },
      templateIds: [], // template gone
    });
    adminRef.current = admin;

    const res = await post({ lead_id: "lead-1" });
    expect(res.status).toBe(404);
  });
});
