// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memorySupabase } from "./helpers/memorySupabase";
import { runTool, toolsFor } from "@/lib/assistant/tools";
import { DATASETS, SECRET_COLUMN, readableColumns, readableDatasets } from "@/lib/assistant/tools/catalog";
import type { ToolContext } from "@/lib/assistant/tools/types";
import type { TurnData } from "@/lib/assistant/tools/data";
import { describeScope } from "@/lib/assistant/prompt";
import type { Lead } from "@/lib/leads/types";

/**
 * describe_data / query_data and the HitList in the lead tools. The rule
 * under test: a person's assistant reads exactly what they could open by hand,
 * an admin's reads everything, and secrets never come out.
 */

type Row = Record<string, unknown>;

const L1 = "00000000-0000-4000-8000-000000000001"; // Sam's lead
const L2 = "00000000-0000-4000-8000-000000000002"; // Sam's lead
const L3 = "00000000-0000-4000-8000-000000000003"; // Ali's lead — Sam can't see it

function lead(id: string, over: Partial<Lead> = {}): Lead {
  return {
    id,
    status: "Ready",
    agent_id: "sam",
    business_name: `Biz ${id.slice(-1)}`,
    business_phone: "(512) 555-0100",
    created_at: "2026-10-02T10:00:00Z",
    updated_at: "2026-10-02T10:00:00Z",
    closed_at: null,
    dropped_at: null,
    first_touch_at: null,
    follow_up_time: null,
    no_pickup_streak: 0,
    price_quoted: null,
    yearly_price: null,
    deleted_at: null,
    ...over,
  } as Lead;
}

const ALL_LEADS = [lead(L1), lead(L2, { status: "Closed" }), lead(L3, { agent_id: "ali" })];
const NAMES: Record<string, string> = { sam: "Sam", ali: "Ali", boss: "Boss" };

function world() {
  const tables: Record<string, Row[]> = {
    leads: ALL_LEADS as unknown as Row[],
    lead_hitlist: [
      { lead_id: L1, priority: 5, added_by: "boss", created_at: "2026-10-05T10:00:00Z" },
      { lead_id: L2, priority: 3, added_by: "boss", created_at: "2026-10-06T10:00:00Z" },
      { lead_id: L3, priority: 4, added_by: "boss", created_at: "2026-10-07T10:00:00Z" },
    ],
    lead_status_events: [
      { id: "e1", lead_id: L1, from_status: "Not Ready", to_status: "Ready", changed_by: "sam", changed_at: "2026-10-03T10:00:00Z", source: "app" },
      { id: "e2", lead_id: L3, from_status: "Ready", to_status: "Closed", changed_by: "ali", changed_at: "2026-10-04T10:00:00Z", source: "app" },
    ],
    lead_receipts: [
      { id: "r1", lead_id: L2, receipt_no: "R-1", total: 1200, paid_on: "2026-10-10", created_at: "2026-10-10T09:00:00Z" },
      { id: "r2", lead_id: L3, receipt_no: "R-2", total: 800, paid_on: "2026-10-12", created_at: "2026-10-12T09:00:00Z" },
      { id: "r3", lead_id: L2, receipt_no: "R-3", total: 300, paid_on: "2026-09-02", created_at: "2026-09-02T09:00:00Z" },
    ],
    lead_follow_ups: [
      { id: "f1", lead_id: L1, user_id: "sam", fu_status: "Picked", created_at: "2026-10-05T10:00:00Z" },
      { id: "f2", lead_id: L1, user_id: "sam", fu_status: "Not Picked", created_at: "2026-10-06T10:00:00Z" },
      { id: "f3", lead_id: L2, user_id: "sam", fu_status: "Picked", created_at: "2026-10-13T10:00:00Z" },
    ],
  };
  const admin = memorySupabase(tables);
  // Sam's own client: row-level security has already cut the leads and calls to his.
  const userDb = memorySupabase({
    leads: tables.leads.filter((l) => l.agent_id === "sam"),
    lead_hitlist: tables.lead_hitlist,
    lead_follow_ups: tables.lead_follow_ups,
  });
  return { admin, userDb };
}

function ctxFor(opts: { perms: string[]; isAdmin?: boolean }) {
  const { admin, userDb } = world();
  const visible = (opts.isAdmin ? ALL_LEADS : ALL_LEADS.filter((l) => l.agent_id === "sam")) as Lead[];
  const data = {
    leads: async () => visible,
    names: async () => (id: string | null) => (id ? (NAMES[id] ?? "Unknown user") : "Unassigned"),
    directory: async () => new Map(Object.entries(NAMES).map(([id, display_name]) => [id, { id, display_name }])),
    teamAgentIds: async () => [],
    hitlist: async (asAdmin = false) => {
      const { data: rows } = await (asAdmin ? admin.client : userDb.client).from("lead_hitlist").select("lead_id, priority");
      return new Map((rows as Row[]).map((r) => [String(r.lead_id), Number(r.priority)]));
    },
  } as unknown as TurnData;
  const ctx = {
    userId: opts.isAdmin ? "boss" : "sam",
    displayName: opts.isAdmin ? "Boss" : "Sam",
    perms: new Set(opts.perms),
    isAdmin: opts.isAdmin ?? false,
    db: userDb.client as unknown as SupabaseClient,
    admin: admin.client as unknown as SupabaseClient,
    timezone: "Asia/Karachi",
    now: new Date("2026-10-20T10:00:00Z"),
    conversationId: "c1",
    data,
  } as unknown as ToolContext;
  return ctx;
}

async function call(ctx: ToolContext, name: string, args: Row) {
  const out = await runTool(name, JSON.stringify(args), ctx);
  return { ...out, body: JSON.parse(out.content) as Row };
}

describe("the catalog", () => {
  it("never lists a secret column", () => {
    for (const d of DATASETS) for (const c of readableColumns(d)) expect(c, `${d.key}.${c}`).not.toMatch(SECRET_COLUMN);
  });

  it("keeps useful columns that only look like secrets", () => {
    expect(SECRET_COLUMN.test("tokens_used")).toBe(false);
    expect(SECRET_COLUMN.test("encrypted_password")).toBe(true);
    expect(SECRET_COLUMN.test("access_key")).toBe(true);
  });

  it("admins read every dataset; others only what their permissions open", () => {
    expect(readableDatasets({ perms: new Set(), isAdmin: true })).toHaveLength(DATASETS.length);
    const agent = readableDatasets({ perms: new Set(["leads.view"]), isAdmin: false }).map((d) => d.key);
    expect(agent).toContain("follow_ups");
    expect(agent).not.toContain("hitlist");
    expect(agent).not.toContain("receipts");
    expect(agent).not.toContain("activity_log");
  });
});

describe("query_data and describe_data are offered to everyone", () => {
  it("are in the tool list for a plain user", () => {
    const names = toolsFor(new Set(["assistant.use"])).map((t) => t.name);
    expect(names).toContain("query_data");
    expect(names).toContain("describe_data");
  });
});

describe("an admin's assistant reads everything", () => {
  it("lists every dataset", async () => {
    const { body } = await call(ctxFor({ perms: [], isAdmin: true }), "describe_data", {});
    expect((body.datasets as Row[]).length).toBe(DATASETS.length);
    expect(String(body.access)).toMatch(/everything/i);
  });

  it("sees the whole HitList, with each lead's name, status and agent", async () => {
    const { ok, body } = await call(ctxFor({ perms: [], isAdmin: true }), "query_data", { dataset: "hitlist", include_lead: true, order_by: "priority" });
    expect(ok).toBe(true);
    expect(body.total_rows).toBe(3);
    const rows = body.rows as Row[];
    expect(rows.map((r) => r.priority)).toEqual([5, 4, 3]);
    expect(rows[1].lead).toMatchObject({ business_name: "Biz 3", agent: "Ali", link: `/leads/${L3}` });
    expect(rows[0].added_by_name).toBe("Boss");
  });

  it("sees status history and receipts on every lead", async () => {
    const ctx = ctxFor({ perms: [], isAdmin: true });
    expect((await call(ctx, "query_data", { dataset: "status_history" })).body.total_rows).toBe(2);
    const sum = await call(ctx, "query_data", { dataset: "receipts", metrics: ["sum:total"] });
    expect((sum.body.totals as Row)["sum:total"]).toBe(2300);
  });
});

describe("everyone else reads what they could open", () => {
  it("no HitList permission: the HitList is refused, never guessed", async () => {
    const ctx = ctxFor({ perms: ["leads.view"] });
    const q = await call(ctx, "query_data", { dataset: "hitlist" });
    expect(q.ok).toBe(false);
    expect(String(q.body.error)).toMatch(/does not have access to hitlist/i);
    const s = await call(ctx, "search_leads", { hitlist: true });
    expect(s.ok).toBe(false);
    expect(String(s.body.error)).toMatch(/does not have access to the HitList/i);
    const listed = (await call(ctx, "describe_data", {})).body.datasets as Row[];
    expect(listed.map((d) => d.dataset)).not.toContain("hitlist");
  });

  it("with HitList access: only the HitList rows on leads they can see", async () => {
    const { body } = await call(ctxFor({ perms: ["leads.view", "hitlist.view"] }), "query_data", { dataset: "hitlist", include_lead: true });
    expect(body.total_rows).toBe(2);
    expect((body.rows as Row[]).map((r) => r.lead_id).sort()).toEqual([L1, L2]);
    expect(String((body.notes as string[])[0])).toMatch(/1 row\(s\) on leads this person cannot see/);
  });

  it("service-role tables are cut to their visible leads", async () => {
    const { body } = await call(ctxFor({ perms: ["leads.view"] }), "query_data", { dataset: "status_history" });
    expect(body.total_rows).toBe(1);
    expect((body.rows as Row[])[0].lead_id).toBe(L1);
  });

  it("a dataset their permissions don't open is refused", async () => {
    const q = await call(ctxFor({ perms: ["leads.view"] }), "query_data", { dataset: "receipts" });
    expect(q.ok).toBe(false);
    expect(String(q.body.error)).toMatch(/does not have access to receipts/);
  });

  it("a table outside the catalog doesn't exist for the assistant", async () => {
    const q = await call(ctxFor({ perms: [], isAdmin: true }), "query_data", { dataset: "company_mailboxes" });
    expect(q.ok).toBe(false);
    expect(String(q.body.error)).toMatch(/There is no dataset/);
  });
});

describe("grouping, filters and periods", () => {
  it("HitList by stars", async () => {
    const { body } = await call(ctxFor({ perms: [], isAdmin: true }), "query_data", { dataset: "hitlist", group_by: ["priority"], order_by: "priority" });
    expect(body.groups).toEqual([{ priority: "5", count: 1 }, { priority: "4", count: 1 }, { priority: "3", count: 1 }]);
  });

  it("calls per person per week, with names", async () => {
    const { body } = await call(ctxFor({ perms: ["leads.view"] }), "query_data", { dataset: "follow_ups", group_by: ["user_id", "created_at:week"] });
    const groups = body.groups as Row[];
    expect(groups.every((g) => g.user_id === "Sam")).toBe(true);
    expect(groups.reduce((n, g) => n + Number(g.count), 0)).toBe(3);
  });

  it("a period in company time, and a sum", async () => {
    const { body } = await call(ctxFor({ perms: [], isAdmin: true }), "query_data", {
      dataset: "receipts",
      from: "2026-10-01",
      to: "2026-10-31",
      metrics: ["sum:total", "count"],
    });
    expect(body.rows_matched).toBe(2);
    expect(body.totals).toEqual({ "sum:total": 2000, count: 2 });
  });

  it("filters: in, gte on a date, contains", async () => {
    const ctx = ctxFor({ perms: [], isAdmin: true });
    const inList = await call(ctx, "query_data", { dataset: "receipts", filters: [{ column: "receipt_no", op: "in", value: "R-1, R-3" }] });
    expect(inList.body.total_rows).toBe(2);
    const since = await call(ctx, "query_data", { dataset: "receipts", filters: [{ column: "created_at", op: "gte", value: "2026-10-11" }] });
    expect(since.body.total_rows).toBe(1);
    const text = await call(ctx, "query_data", { dataset: "status_history", filters: [{ column: "to_status", op: "contains", value: "clos" }] });
    expect(text.body.total_rows).toBe(1);
  });

  it("a wrong column says which columns exist", async () => {
    const q = await call(ctxFor({ perms: [], isAdmin: true }), "query_data", { dataset: "hitlist", filters: [{ column: "stars", op: "eq", value: "5" }] });
    expect(q.ok).toBe(false);
    expect(String(q.body.error)).toMatch(/Columns: lead_id, priority/);
  });
});

describe("the HitList inside the lead tools", () => {
  it("search_leads: only HitList leads, at least N stars, with their stars", async () => {
    const ctx = ctxFor({ perms: ["leads.view", "hitlist.view"] });
    const { body } = await call(ctx, "search_leads", { min_stars: 4, sort: "hitlist_stars" });
    expect((body.leads as Row[]).map((l) => [l.id, l.hitlist_stars])).toEqual([[L1, 5]]);
    const off = await call(ctx, "search_leads", { hitlist: false });
    expect(off.body.total_matches).toBe(0); // both of Sam's leads are starred
  });

  it("breakdown_leads by HitList stars", async () => {
    const { body } = await call(ctxFor({ perms: ["leads.view", "hitlist.view"] }), "breakdown_leads", { group_by: "hitlist" });
    expect((body.groups as Row[]).map((g) => [g.group, g.leads])).toEqual([
      ["3 stars", 1],
      ["5 stars", 1],
    ]);
  });
});

describe("what the assistant is told it can see", () => {
  it("an admin: everything, the HitList, and every dataset", () => {
    const lines = describeScope({ perms: new Set(), teamSize: 0, isAdmin: true });
    expect(lines[0]).toMatch(/Everything in the LMS/);
    expect(lines.some((l) => /HitList/.test(l))).toBe(true);
    expect(lines.at(-1)).toContain("hitlist");
  });

  it("an agent: no HitList line without the permission", () => {
    const lines = describeScope({ perms: new Set(["leads.view"]), teamSize: 0 });
    expect(lines.some((l) => /^HitList/.test(l))).toBe(false);
    expect(lines.join("\n")).not.toMatch(/\bhitlist\b/);
  });
});
