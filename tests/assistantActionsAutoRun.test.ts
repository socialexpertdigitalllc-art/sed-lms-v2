// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActionContext, ActionDef } from "@/lib/assistant/actions/types";
import type { ActionCard } from "@/lib/assistant/actions/card";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";

/**
 * Permission modes: what runs without a click, and what always waits. The
 * promise: a change runs on its own only when the person chose that, within
 * the company limit — never a high-impact one, never one needing an
 * approver, never one an admin set to always ask — and it runs exactly as a
 * click would (re-checked, once, as the person, undoable).
 */

const executed: { key: string; values: Record<string, unknown>; as: string; requester?: string }[] = [];
const undone: string[] = [];
let staleReason: string | null = null;
let executeError: Error | null = null;

const testDefs: ActionDef[] = [
  {
    key: "test.create",
    group: "Leads",
    title: "Create a thing",
    description: "",
    confirmLabel: "Create",
    risk: "standard",
    allowed: (ctx) => (ctx.perms.has("things.create") ? null : "Your account doesn't have “Create Thing”."),
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "phone", label: "Phone", type: "phone", required: true },
      { name: "kind", label: "Kind", type: "enum", options: ["A", "B"], required: true },
      { name: "reason", label: "Reason", type: "text", required: true, showIf: (v) => v.kind === "B" },
    ],
    label: (v) => String(v.name ?? ""),
    produces: "lead",
    stale: async () => staleReason,
    async execute(v, ctx, info) {
      if (executeError) throw executeError;
      executed.push({ key: "test.create", values: v, as: ctx.userId, requester: info.requesterId });
      return { message: `Created ${String(v.name)}`, data: { id: "00000000-0000-4000-8000-000000000123", kind: "lead" } };
    },
    undo: { minutes: 10, run: async (stored) => (undone.push(stored.id), "removed") },
  },
  {
    key: "test.critical",
    group: "Websites & domains",
    title: "Buy a thing",
    description: "",
    confirmLabel: "Buy",
    risk: "critical",
    allowed: () => null,
    fields: [{ name: "domain", label: "Domain", type: "text", required: true }],
    label: (v) => String(v.domain ?? ""),
    async execute(v) {
      executed.push({ key: "test.critical", values: v, as: "" });
      return { message: "Bought" };
    },
  },
  {
    key: "test.bulk",
    group: "Leads",
    title: "Change many",
    description: "",
    confirmLabel: "Apply",
    risk: "sensitive",
    allowed: () => null,
    bulkField: "ids",
    fields: [{ name: "ids", label: "Records", type: "list", required: true }],
    async preview(v) {
      return { items: (v.ids as string[]).map((id) => ({ id, label: id, selected: true })) };
    },
    async execute(v) {
      executed.push({ key: "test.bulk", values: v, as: "" });
      return { message: `Changed ${(v.ids as string[]).length}` };
    },
  },
  {
    key: "test.mine",
    group: "Leads",
    title: "Tag my thing",
    description: "",
    confirmLabel: "Tag",
    risk: "standard",
    allowed: (ctx) => (ctx.perms.has("things.tag") ? null : "Your account doesn't have “Tag Things”."),
    selfOnly: true,
    fields: [{ name: "tag", label: "Tag", type: "text", required: true }],
    async execute(v, ctx) {
      executed.push({ key: "test.mine", values: v, as: ctx.userId });
      return { message: "Tagged" };
    },
  },
  {
    key: "test.child",
    group: "Tickets",
    title: "Attach to a lead",
    description: "",
    confirmLabel: "Attach",
    risk: "standard",
    allowed: () => null,
    fields: [
      { name: "lead", label: "Lead", type: "ref", ref: "lead", required: true },
      { name: "note", label: "Note", type: "text", required: true },
    ],
    async execute(v) {
      executed.push({ key: "test.child", values: v, as: "" });
      return { message: "Attached" };
    },
  },
];

vi.mock("@/lib/assistant/actions/registry", () => ({
  ACTION_DEFS: testDefs,
  getActionDef: (k: string) => testDefs.find((d) => d.key === k),
  actionCatalogue: () => "",
}));
vi.mock("@/lib/assistant/actions/people", () => ({
  usersWithPermission: async () => ["approver-1"],
  bell: vi.fn(async () => {}),
  permissionsOf: async () => new Set<string>(),
}));

const run = await import("@/lib/assistant/actions/run");
const { clearActionSettingsCache } = await import("@/lib/assistant/actions/store");
const { clearPermissionCapCache, getActPermissions } = await import("@/lib/assistant/actions/permissionStore");
const tools = await import("@/lib/assistant/tools/actions");

let mem: MemoryDb;

function ctxFor(userId: string, perms: string[] = ["things.create"]): ActionContext {
  return { userId, displayName: userId, perms: new Set(perms), db: mem.client, admin: mem.client, timezone: "Asia/Karachi", now: new Date(), isAdmin: false };
}

const base = { conversationId: "c1", turnId: "t1", callId: "call-1", source: "chat" as const };
const THING = { name: "Jumbo's", phone: "2524012775", kind: "A" };

async function propose(key: string, fields: Record<string, unknown>, ctx = ctxFor("sam")) {
  const out = await run.prepareAction({ ...base, key, fields, ctx });
  if (out.kind !== "proposed") throw new Error(`expected a proposal, got ${out.kind}: ${JSON.stringify(out)}`);
  return out.card;
}

function auto(over: Partial<import("@/lib/assistant/actions/run").AutoRunContext> = {}): import("@/lib/assistant/actions/run").AutoRunContext {
  return { mode: "auto_safe", cap: "auto", allow: [], origin: "https://lms.test", budget: { left: 15 }, ...over };
}

beforeEach(() => {
  executed.length = 0;
  undone.length = 0;
  staleReason = null;
  executeError = null;
  clearActionSettingsCache();
  clearPermissionCapCache();
  mem = memorySupabase(
    {
      leads: [{ id: "00000000-0000-4000-8000-000000000123", business_name: "Jumbo's Pizza", status: "Ready", agent_id: "sam", deleted_at: null }],
      app_settings: [{ singleton: true, assistant_max_permission_mode: "auto" }],
      profiles: [{ id: "sam", ui_preferences: { assistantName: "Nova" } }],
    },
    {
      assistant_actions: () => ({
        status: "proposed",
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        approver_id: null,
        approval_note: null,
        decided_at: null,
        reported_at: null,
        result: null,
        error: null,
        undo_until: null,
        executed_at: null,
      }),
    },
  );
});

describe("autoRun — which proposals run without a click", () => {
  it("Ask mode: nothing runs; the card waits", async () => {
    const card = await propose("test.create", THING);
    const r = await run.autoRun(card, ctxFor("sam"), auto({ mode: "ask" }));
    expect(r).toMatchObject({ ran: false, card: { status: "proposed" } });
    expect(executed).toHaveLength(0);
  });

  it("Auto: safe — a safe change runs once, as the person, marked and undoable", async () => {
    const card = await propose("test.create", THING);
    const started: ActionCard[] = [];
    const r = await run.autoRun(card, ctxFor("sam"), auto(), (c) => started.push(c));
    expect(r.ran).toBe(true);
    expect(r.card).toMatchObject({ status: "done", auto: { via: "mode" }, result: { message: "Created Jumbo's" } });
    expect(r.card.undoUntil).toBeTruthy();
    expect(started).toEqual([expect.objectContaining({ id: card.id, status: "executing" })]);
    expect(executed).toEqual([expect.objectContaining({ key: "test.create", as: "sam" })]);
    // Exactly once: a click on the same card afterwards is refused.
    await expect(run.confirmAction({ id: card.id, ctx: ctxFor("sam"), origin: "x" })).rejects.toThrow(/already been done/);
    expect(executed).toHaveLength(1);
    // Undo works as for a clicked one.
    await run.undoAction(card.id, ctxFor("sam"));
    expect(undone).toEqual([card.id]);
  });

  it("Auto: safe — a change that needs a check still waits", async () => {
    const card = await propose("test.bulk", { ids: ["a", "b"] });
    const r = await run.autoRun(card, ctxFor("sam"), auto());
    expect(r).toMatchObject({ ran: false, reason: expect.stringMatching(/confirm changes like this/) });
    expect(executed).toHaveLength(0);
  });

  it("Auto — checked changes run too (bulk on every record the card listed)", async () => {
    const card = await propose("test.bulk", { ids: ["a", "b"] });
    const r = await run.autoRun(card, ctxFor("sam"), auto({ mode: "auto" }));
    expect(r.card.status).toBe("done");
    expect(executed).toEqual([expect.objectContaining({ key: "test.bulk", values: { ids: ["a", "b"] } })]);
  });

  it("high-impact changes never run on their own, in any mode or list", async () => {
    const card = await propose("test.critical", { domain: "x.com" });
    const r = await run.autoRun(card, ctxFor("sam"), auto({ mode: "auto", allow: ["test.critical"] }));
    expect(r).toMatchObject({ ran: false, reason: expect.stringMatching(/High-impact/) });
    // Not even when asked directly.
    await expect(run.confirmAction({ id: card.id, ctx: ctxFor("sam"), origin: "x", auto: { via: "mode" } })).rejects.toThrow(/confirmed on its card/);
    expect(executed).toHaveLength(0);
  });

  it("anything that needs an approver waits", async () => {
    const card = await propose("test.create", THING, ctxFor("sam", []));
    expect(card.approval).toBeTruthy();
    const r = await run.autoRun(card, ctxFor("sam", []), auto({ mode: "auto" }));
    expect(r).toMatchObject({ ran: false, reason: "This needs an approver." });
    expect(executed).toHaveLength(0);
  });

  it("an admin's \"always ask\" wins over every mode", async () => {
    mem.tables.assistant_action_settings = [{ action_key: "test.create", enabled: true, require_approval: false, auto_run: false }];
    const card = await propose("test.create", THING);
    expect(card.allowAlways).toBe(false);
    const r = await run.autoRun(card, ctxFor("sam"), auto({ mode: "auto", allow: ["test.create"] }));
    expect(r).toMatchObject({ ran: false, reason: expect.stringMatching(/always ask/) });
  });

  it("the company limit caps the person's mode — and their list", async () => {
    const card = await propose("test.bulk", { ids: ["a"] });
    expect((await run.autoRun(card, ctxFor("sam"), auto({ mode: "auto", cap: "auto_safe" }))).ran).toBe(false);
    const safe = await propose("test.create", THING);
    expect((await run.autoRun(safe, ctxFor("sam"), auto({ mode: "auto", cap: "ask", allow: ["test.create"] }))).ran).toBe(false);
    expect(executed).toHaveLength(0);
  });

  it("\"don't ask again\" runs that action on its own even in Ask mode", async () => {
    const card = await propose("test.create", THING);
    const r = await run.autoRun(card, ctxFor("sam"), auto({ mode: "ask", allow: ["test.create"] }));
    expect(r.card).toMatchObject({ status: "done", auto: { via: "always" } });
  });

  it("at most N per answer; the rest wait on their cards", async () => {
    const budget = { left: 1 };
    const one = await propose("test.create", THING);
    const two = await propose("test.create", { ...THING, name: "Second" });
    expect((await run.autoRun(one, ctxFor("sam"), auto({ budget }))).ran).toBe(true);
    const r = await run.autoRun(two, ctxFor("sam"), auto({ budget }));
    expect(r).toMatchObject({ ran: false, reason: expect.stringMatching(/rest wait/) });
    expect(executed).toHaveLength(1);
  });

  it("re-checked like a click: a record that moved on is not changed", async () => {
    staleReason = "Someone changed it.";
    const card = await propose("test.create", THING);
    const r = await run.autoRun(card, ctxFor("sam"), auto());
    expect(r.ran).toBe(false);
    expect(r.card.status).toBe("failed");
    expect(executed).toHaveLength(0);
  });

  it("a run that fails shows as failed, nothing claimed", async () => {
    executeError = new Error("boom");
    const card = await propose("test.create", THING);
    const r = await run.autoRun(card, ctxFor("sam"), auto());
    expect(r.ran).toBe(true);
    expect(r.card.status).toBe("failed");
  });
});

describe("autoRunPlan", () => {
  it("runs steps in order while they may run on their own; stops at the first that must wait", async () => {
    const planned = await run.preparePlan(
      "Set it up",
      [
        { action: "test.create", fields: THING },
        { action: "test.child", fields: { lead: "@1", note: "hi" } },
        { action: "test.critical", fields: { domain: "x.com" } },
        { action: "test.create", fields: { ...THING, name: "After" } },
      ],
      { ...base, ctx: ctxFor("sam") },
    );
    if (planned.kind !== "proposed") throw new Error(JSON.stringify(planned));
    const r = await run.autoRunPlan(planned.cards, ctxFor("sam"), auto());
    expect(r.cards.map((c) => c.status)).toEqual(["done", "done", "proposed", "proposed"]);
    expect(r.stoppedAt).toMatchObject({ title: expect.stringMatching(/Buy a thing/) });
    // Step 2 got step 1's record.
    expect(executed.map((e) => e.key)).toEqual(["test.create", "test.child"]);
    expect(executed[1].values.lead).toBe("00000000-0000-4000-8000-000000000123");
  });
});

describe("cards offer \"don't ask again\" only where it could apply", () => {
  it("safe and checked changes yes; high-impact no; nothing when the company says Ask", async () => {
    expect((await propose("test.create", THING)).allowAlways).toBe(true);
    expect((await propose("test.critical", { domain: "x.com" })).allowAlways).toBe(false);
    mem.tables.app_settings[0].assistant_max_permission_mode = "ask";
    clearPermissionCapCache();
    expect((await propose("test.create", { ...THING, name: "Other" })).allowAlways).toBe(false);
  });

  it("names the action it covers", async () => {
    expect((await propose("test.create", THING)).kind).toBe("Create a thing");
  });
});

describe("prepare_action / propose_plan with a permission mode", () => {
  function toolCtx(autoCtx: import("@/lib/assistant/actions/run").AutoRunContext | null, events: unknown[]) {
    return {
      userId: "sam",
      displayName: "sam",
      perms: new Set(["things.create", "assistant.act"]),
      db: mem.client,
      admin: mem.client,
      timezone: "Asia/Karachi",
      now: new Date(),
      conversationId: "c1",
      data: {} as never,
      emit: (e: unknown) => events.push(e),
      act: { mode: "act" as const, turnId: "t1", source: "chat" as const, isAdmin: false, callId: "call-9", auto: autoCtx },
    };
  }

  it("tells the model it is DONE when it ran — and shows Working… then Done", async () => {
    const events: { type: string; card?: ActionCard }[] = [];
    const out = await tools.prepareActionTool.run({ action: "test.create", fields: THING }, toolCtx(auto(), events));
    expect(out.data).toMatchObject({ status: "done", result: "Created Jumbo's", undo: expect.stringMatching(/10 minutes/) });
    expect(events.map((e) => e.card?.status)).toEqual(["executing", "done"]);
  });

  it("says it waits — and why — when it may not run on its own", async () => {
    const events: { type: string; card?: ActionCard }[] = [];
    const out = await tools.prepareActionTool.run({ action: "test.critical", fields: { domain: "x.com" } }, toolCtx(auto({ mode: "auto" }), events));
    expect(out.data).toMatchObject({ status: "proposed", why_it_waits: expect.stringMatching(/High-impact/), next: expect.stringMatching(/never say it is done/) });
    expect(executed).toHaveLength(0);
  });

  it("a plan runs as far as it may, and reports what still waits", async () => {
    const events: unknown[] = [];
    const out = await tools.proposePlanTool.run(
      { title: "Two", steps: [{ action: "test.create", fields: THING }, { action: "test.critical", fields: { domain: "x.com" } }] },
      toolCtx(auto(), events),
    );
    expect(out.data).toMatchObject({ status: "partly_done", steps: [{ status: "done" }, { status: "proposed" }] });
  });

  it("without a permission context it only proposes, as before", async () => {
    const events: unknown[] = [];
    const out = await tools.prepareActionTool.run({ action: "test.create", fields: THING }, toolCtx(null, events));
    expect(out.data).toMatchObject({ status: "proposed" });
    expect(executed).toHaveLength(0);
  });
});

describe("saved preferences", () => {
  it("a person who never chose is in Ask with nothing always allowed", async () => {
    expect(await getActPermissions(mem.client, "sam")).toEqual({ mode: "ask", allow: [] });
  });
});
