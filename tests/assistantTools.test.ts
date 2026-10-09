// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALL_TOOLS, MAX_TOOL_RESULT_CHARS, runTool, toolsFor } from "@/lib/assistant/tools";
import type { ToolContext } from "@/lib/assistant/tools/types";
import type { TurnData } from "@/lib/assistant/tools/data";
import type { FollowUpRow } from "@/lib/assistant/analytics";
import type { Lead } from "@/lib/leads/types";

/**
 * The tools behind a fake database. What matters most here is SCOPE: an
 * agent's assistant sees exactly what that agent could open by hand, an
 * admin's sees everything, and nobody's model can call a tool it was not
 * given.
 */

type Row = Record<string, unknown>;
const asTime = (v: unknown) => new Date(String(v)).getTime();

/** A chainable stand-in for supabase-js's query builder over fixture rows. */
function fakeDb(tables: Record<string, Row[]>, log: string[] = []) {
  return {
    log,
    client: {
      from(table: string) {
        const filters: ((r: Row) => boolean)[] = [];
        let range: [number, number] | null = null;
        let limit: number | null = null;
        let single = false;
        const b: Record<string, unknown> = {};
        Object.assign(b, {
          select: () => b,
          order: () => b,
          eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
          is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
          in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
          gte: (c: string, v: unknown) => (filters.push((r) => asTime(r[c]) >= asTime(v)), b),
          lt: (c: string, v: unknown) => (filters.push((r) => asTime(r[c]) < asTime(v)), b),
          not: (c: string) => (filters.push((r) => r[c] !== null && r[c] !== undefined), b),
          range: (a: number, z: number) => ((range = [a, z]), b),
          limit: (n: number) => ((limit = n), b),
          maybeSingle: () => ((single = true), b),
          then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
            log.push(table);
            let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
            if (range) rows = rows.slice(range[0], range[1] + 1);
            if (limit !== null) rows = rows.slice(0, limit);
            return Promise.resolve(single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }).then(resolve, reject);
          },
        });
        return b;
      },
    } as unknown as SupabaseClient,
  };
}

let seq = 0;
function lead(over: Partial<Lead>): Lead {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    status: "Ready",
    agent_id: "sam",
    business_name: `Business ${seq}`,
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

const USERS = new Map([
  ["sam", { id: "sam", display_name: "Sam Khan", is_active: true }],
  ["ali", { id: "ali", display_name: "Ali Raza", is_active: true }],
  ["ali2", { id: "ali2", display_name: "Ali Hassan", is_active: true }],
  ["boss", { id: "boss", display_name: "Admin Boss", is_active: true }],
]);

/** The per-message loader, over leads the caller says are VISIBLE — exactly
 *  what RLS would have returned through the user's own client. */
function fakeData(visible: Lead[], calls: FollowUpRow[] = [], team: string[] = []): TurnData {
  return {
    leads: async () => visible,
    followUps: async () => calls,
    followUpsForLeads: async (ids: string[]) => calls.filter((c) => ids.includes(c.lead_id)),
    directory: async () => USERS,
    names: async () => (id: string | null) => (id ? USERS.get(id)?.display_name ?? "Unknown user" : "Unassigned"),
    teamAgentIds: async () => team,
  } as unknown as TurnData;
}

const AGENT_PERMS = new Set(["leads.view", "tickets.view", "pre_leads.view", "assistant.use"]);
const ADMIN_PERMS = new Set([
  ...AGENT_PERMS,
  "leads.view_all",
  "tickets.view_all",
  "analytics.by_agent",
  "admin.logs.view",
  "contracts.view",
]);

function ctxFor(opts: { userId: string; perms: Set<string>; data: TurnData; db?: SupabaseClient; admin?: SupabaseClient }): ToolContext {
  const empty = fakeDb({}).client;
  return {
    userId: opts.userId,
    displayName: USERS.get(opts.userId)?.display_name ?? "?",
    perms: opts.perms,
    db: opts.db ?? empty,
    admin: opts.admin ?? empty,
    timezone: "Asia/Karachi",
    now: new Date("2026-10-09T10:00:00Z"),
    conversationId: "conv-1",
    data: opts.data,
  };
}

/** Tool output, read deep by the assertions below (JSON.parse's own `any`). */
const parse = (content: string) => JSON.parse(content);

describe("which tools a user's assistant is given", () => {
  it("gives an agent the lead tools but none of the team-wide ones", () => {
    const names = toolsFor(AGENT_PERMS).map((t) => t.name);
    expect(names).toContain("get_pipeline_summary");
    expect(names).toContain("get_tickets_overview");
    expect(names).not.toContain("get_team_performance");
    expect(names).not.toContain("get_team_activity");
  });

  it("gives an admin every tool", () => {
    expect(toolsFor(ADMIN_PERMS).map((t) => t.name).sort()).toEqual(ALL_TOOLS.map((t) => t.name).sort());
  });

  it("leaves someone with no data permissions only the calculator and their memory", () => {
    expect(toolsFor(new Set(["assistant.use"])).map((t) => t.name).sort()).toEqual(["calculate", "forget_memory", "save_memory"]);
  });

  it("refuses a tool the user was not given, even if the model names it", async () => {
    const ctx = ctxFor({ userId: "sam", perms: AGENT_PERMS, data: fakeData([]) });
    const out = await runTool("get_team_activity", "{}", ctx);
    expect(out.ok).toBe(false);
    expect(parse(out.content).error).toMatch(/no tool called/);
    expect((await runTool("drop_database", "{}", ctx)).ok).toBe(false);
  });

  it("turns malformed arguments into an error the model can recover from", async () => {
    const ctx = ctxFor({ userId: "sam", perms: AGENT_PERMS, data: fakeData([]) });
    const out = await runTool("calculate", "{not json", ctx);
    expect(out.ok).toBe(false);
    expect(parse(out.content).error).toMatch(/valid JSON/);
  });
});

describe("lead tools stay inside the user's visibility", () => {
  const samLeads = [
    lead({ status: "Closed", price_quoted: 1000, closed_at: "2026-10-05T10:00:00Z" }),
    lead({ status: "Ready", price_quoted: 500 }),
  ];

  it("summarises only the visible leads and says what the scope is", async () => {
    const ctx = ctxFor({ userId: "sam", perms: AGENT_PERMS, data: fakeData(samLeads) });
    const out = await runTool("get_pipeline_summary", "{}", ctx);
    const data = parse(out.content);
    expect(out.ok).toBe(true);
    expect(data.visible_scope).toBe("only your own leads");
    expect(data.summary.total_leads).toBe(2);
    expect(data.summary.revenue.closed_one_time).toBe(1000);
    expect(out.summary).toMatch(/2 leads · 1 closed/);
  });

  it("tells an agent that a colleague's leads are invisible rather than reporting zero as fact", async () => {
    const ctx = ctxFor({ userId: "sam", perms: AGENT_PERMS, data: fakeData(samLeads) });
    const data = parse((await runTool("get_pipeline_summary", JSON.stringify({ agent: "Ali Raza" }), ctx)).content);
    expect(data.summary.total_leads).toBe(0);
    expect(data.notes[0]).toMatch(/only see your own leads/);
  });

  it("asks which person when a name is ambiguous", async () => {
    const ctx = ctxFor({ userId: "boss", perms: ADMIN_PERMS, data: fakeData(samLeads) });
    const out = await runTool("get_pipeline_summary", JSON.stringify({ agent: "ali" }), ctx);
    expect(out.ok).toBe(false);
    expect(parse(out.content).error).toMatch(/matches several people: Ali Raza, Ali Hassan/);
  });

  it("is lenient about how a model writes a status, strict about what it means", async () => {
    const ctx = ctxFor({ userId: "sam", perms: AGENT_PERMS, data: fakeData(samLeads) });
    const ok = parse((await runTool("search_leads", JSON.stringify({ status: "closed" }), ctx)).content);
    expect(ok.total_matches).toBe(1);
    const bad = await runTool("search_leads", JSON.stringify({ status: ["Won"] }), ctx);
    expect(parse(bad.content).error).toMatch(/Unknown status "Won"/);
  });

  it("never reads a lead's private ledger unless the lead itself came back through the user's client", async () => {
    const admin = fakeDb({ lead_status_events: [{ lead_id: "00000000-0000-4000-8000-999999999999", to_status: "Closed" }] });
    const ctx = ctxFor({ userId: "sam", perms: AGENT_PERMS, data: fakeData(samLeads), admin: admin.client });
    const out = await runTool("get_lead_details", JSON.stringify({ lead_id: "00000000-0000-4000-8000-999999999999" }), ctx);
    expect(out.ok).toBe(false);
    expect(parse(out.content).error).toMatch(/No lead with that id is visible/);
    expect(admin.log).not.toContain("lead_status_events");
  });

  it("opens a visible lead with its call history and status history", async () => {
    const target = samLeads[0];
    const db = fakeDb({
      lead_follow_ups: [{ lead_id: target.id, fu_status: "Pickup", comments: "Interested", created_at: "2026-10-03T10:00:00Z", user_id: "sam" }],
    });
    const admin = fakeDb({
      lead_status_events: [{ lead_id: target.id, from_status: "Ready", to_status: "Closed", changed_by: "sam", changed_at: "2026-10-05T10:00:00Z", source: "app" }],
    });
    const ctx = ctxFor({ userId: "sam", perms: AGENT_PERMS, data: fakeData(samLeads), db: db.client, admin: admin.client });
    const data = parse((await runTool("get_lead_details", JSON.stringify({ business_name: target.business_name }), ctx)).content);
    expect(data.lead.agent).toBe("Sam Khan");
    expect(data.follow_up_calls).toEqual([expect.objectContaining({ result: "Pickup", comments: "Interested", by: "Sam Khan" })]);
    expect(data.status_history).toEqual([expect.objectContaining({ from: "Ready", to: "Closed", by: "Sam Khan" })]);
  });
});

describe("tickets follow the Tickets page's own scope", () => {
  const samLead = lead({ agent_id: "sam" });
  const aliLead = lead({ agent_id: "ali" });
  const tickets = [
    { id: "t1", lead_id: samLead.id, created_by: "boss", assigned_to: null, status: "Open", priority: "High", category: "Changes", created_at: "2026-10-01T10:00:00Z", resolved_at: null, due_date: "2026-10-02T10:00:00Z" },
    { id: "t2", lead_id: aliLead.id, created_by: "sam", assigned_to: "ali", status: "Resolved", priority: "Normal", category: "Changes", created_at: "2026-10-01T10:00:00Z", resolved_at: "2026-10-01T20:00:00Z", due_date: null },
    { id: "t3", lead_id: aliLead.id, created_by: "ali", assigned_to: "ali", status: "Open", priority: "Low", category: "Improvement", created_at: "2026-10-03T10:00:00Z", resolved_at: null, due_date: null },
  ];
  const admin = () =>
    fakeDb({
      lead_tickets: tickets,
      leads: [
        { id: samLead.id, agent_id: "sam", deleted_at: null, business_name: samLead.business_name },
        { id: aliLead.id, agent_id: "ali", deleted_at: null, business_name: aliLead.business_name },
      ],
    }).client;

  it("shows an agent tickets on their leads and the ones they opened — not a colleague's", async () => {
    const ctx = ctxFor({ userId: "sam", perms: AGENT_PERMS, data: fakeData([samLead]), admin: admin() });
    const data = parse((await runTool("get_tickets_overview", "{}", ctx)).content);
    expect(data.total).toBe(2); // t1 (his lead) + t2 (he opened it); not t3
    expect(data.overdue_against_sla).toBe(1);
  });

  it("shows an admin the whole queue", async () => {
    const ctx = ctxFor({ userId: "boss", perms: ADMIN_PERMS, data: fakeData([samLead, aliLead]), admin: admin() });
    const data = parse((await runTool("get_tickets_overview", "{}", ctx)).content);
    expect(data.total).toBe(3);
    expect(data.by_assignee.find((a: { assignee: string }) => a.assignee === "Ali Raza")).toMatchObject({ open: 1, resolved: 1 });
  });
});

describe("result size", () => {
  it("caps what goes back to the model", async () => {
    const many = Array.from({ length: 400 }, (_, i) => lead({ business_name: `${"Very long business name ".repeat(12)}${i}`, category: `Category ${i}` }));
    const ctx = ctxFor({ userId: "boss", perms: ADMIN_PERMS, data: fakeData(many) });
    const out = await runTool("breakdown_leads", JSON.stringify({ group_by: "category", limit: 60 }), ctx);
    expect(out.ok).toBe(true);
    expect(out.content.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS + 60);
    expect(parse(out.content).truncated).toMatch(/Showing 60 of 400/);
  });
});
