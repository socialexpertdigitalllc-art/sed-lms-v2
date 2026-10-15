// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActionContext, ActionDef } from "@/lib/assistant/actions/types";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";

/**
 * The life of an action — prepared, proposed, confirmed (or edited, refused,
 * sent for approval), executed once, undone — against an in-memory database
 * and test actions. This is the promise SED AI makes: NOTHING changes until a
 * person confirms, it changes exactly once, and only what the card showed.
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
const people = await import("@/lib/assistant/actions/people");

let mem: MemoryDb;

function ctxFor(userId: string, perms: string[] = ["things.create"]): ActionContext {
  return { userId, displayName: userId, perms: new Set(perms), db: mem.client, admin: mem.client, timezone: "Asia/Karachi", now: new Date(), isAdmin: false };
}

const base = { conversationId: "c1", turnId: "t1", callId: "call-1", source: "chat" as const };

async function propose(key: string, fields: Record<string, unknown>, ctx = ctxFor("sam")) {
  const out = await run.prepareAction({ ...base, key, fields, ctx });
  if (out.kind !== "proposed") throw new Error(`expected a proposal, got ${out.kind}: ${JSON.stringify(out)}`);
  return out.card;
}

beforeEach(() => {
  executed.length = 0;
  undone.length = 0;
  staleReason = null;
  executeError = null;
  clearActionSettingsCache();
  mem = memorySupabase(
    { leads: [{ id: "00000000-0000-4000-8000-000000000123", business_name: "Jumbo's Pizza", status: "Ready", agent_id: "sam", deleted_at: null }] },
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

describe("prepareAction", () => {
  it("asks for what is missing — in order, with options — and changes nothing", async () => {
    const out = await run.prepareAction({ ...base, key: "test.create", fields: { name: "Jumbo's", phone: "123" }, ctx: ctxFor("sam") });
    expect(out.kind).toBe("needs_input");
    if (out.kind !== "needs_input") return;
    expect(out.missing.map((m) => m.field)).toEqual(["kind"]);
    expect(out.missing[0].options).toEqual(["A", "B"]);
    expect(out.problems.map((p) => p.field)).toEqual(["phone"]);
    expect(out.understood).toEqual({ Name: "Jumbo's" });
    expect(mem.tables.assistant_actions ?? []).toHaveLength(0);
  });

  it("asks for a conditional field only when it applies", async () => {
    const out = await run.prepareAction({ ...base, key: "test.create", fields: { name: "X", phone: "2524012775", kind: "B" }, ctx: ctxFor("sam") });
    expect(out.kind === "needs_input" && out.missing.map((m) => m.field)).toEqual(["reason"]);
  });

  it("stores a complete one as a proposal and returns its card", async () => {
    const card = await propose("test.create", { name: "Jumbo's", phone: "2524012775", kind: "A" });
    expect(card).toMatchObject({ status: "proposed", title: "Create a thing — Jumbo's", confirmLabel: "Create", risk: "standard", callId: "call-1", turnId: "t1" });
    expect(card.fields.map((f) => [f.label, f.value])).toEqual([
      ["Name", "Jumbo's"],
      ["Phone", "(252) 401-2775"],
      ["Kind", "A"],
    ]);
    expect(executed).toHaveLength(0);
  });

  it("refuses an action an admin switched off", async () => {
    mem.tables.assistant_action_settings = [{ action_key: "test.create", enabled: false, require_approval: false }];
    const out = await run.prepareAction({ ...base, key: "test.create", fields: {}, ctx: ctxFor("sam") });
    expect(out.kind).toBe("disabled");
  });

  it("withdraws the card it corrects", async () => {
    const first = await propose("test.create", { name: "Jumbos", phone: "2524012775", kind: "A" });
    const out = await run.prepareAction({ ...base, key: "test.create", fields: { name: "Jumbo's", phone: "2524012775", kind: "A" }, ctx: ctxFor("sam"), replaces: first.id });
    expect(out.kind).toBe("proposed");
    expect(mem.tables.assistant_actions.find((r) => r.id === first.id)?.status).toBe("cancelled");
  });
});

describe("confirmAction", () => {
  it("runs it once, as the person confirming, and offers undo", async () => {
    const card = await propose("test.create", { name: "Jumbo's", phone: "2524012775", kind: "A" });
    const done = await run.confirmAction({ id: card.id, ctx: ctxFor("sam"), origin: "https://app" });
    expect(done.status).toBe("done");
    expect(done.result?.message).toBe("Created Jumbo's");
    expect(done.undoUntil).toBeTruthy();
    expect(executed).toEqual([{ key: "test.create", values: expect.objectContaining({ name: "Jumbo's", phone: "(252) 401-2775" }), as: "sam", requester: "sam" }]);
    await expect(run.confirmAction({ id: card.id, ctx: ctxFor("sam"), origin: "" })).rejects.toMatchObject({ status: 409 });
    expect(executed).toHaveLength(1);
  });

  it("is not found for anyone but its owner", async () => {
    const card = await propose("test.create", { name: "J", phone: "2524012775", kind: "A" });
    await expect(run.confirmAction({ id: card.id, ctx: ctxFor("ali"), origin: "" })).rejects.toMatchObject({ status: 404 });
  });

  it("re-checks edits made on the card, and keeps the proposal open when one is wrong", async () => {
    const card = await propose("test.create", { name: "J", phone: "2524012775", kind: "A" });
    await expect(run.confirmAction({ id: card.id, ctx: ctxFor("sam"), origin: "", edits: { phone: "555" } })).rejects.toMatchObject({ status: 422 });
    expect(mem.tables.assistant_actions[0].status).toBe("proposed");
    const done = await run.confirmAction({ id: card.id, ctx: ctxFor("sam"), origin: "", edits: { phone: "(512) 555-0100", name: "Jumbo's Pizza" } });
    expect(done.status).toBe("done");
    expect(executed[0].values).toMatchObject({ name: "Jumbo's Pizza", phone: "(512) 555-0100" });
    expect(done.fields.find((f) => f.name === "name")?.value).toBe("Jumbo's Pizza");
  });

  it("needs the typed phrase for a critical action", async () => {
    const card = await propose("test.critical", { domain: "jumbospizza.com" });
    expect(card.confirmPhrase).toBe("jumbospizza.com");
    await expect(run.confirmAction({ id: card.id, ctx: ctxFor("sam"), origin: "", phrase: "yes" })).rejects.toMatchObject({ status: 422 });
    const done = await run.confirmAction({ id: card.id, ctx: ctxFor("sam"), origin: "", phrase: " JumbosPizza.com " });
    expect(done.status).toBe("done");
  });

  it("applies only the records still ticked on a bulk card", async () => {
    const card = await propose("test.bulk", { ids: ["a", "b", "c"] });
    expect(card.items?.map((i) => i.id)).toEqual(["a", "b", "c"]);
    await expect(run.confirmAction({ id: card.id, ctx: ctxFor("sam"), origin: "", selected: [] })).rejects.toMatchObject({ status: 422 });
    const done = await run.confirmAction({ id: card.id, ctx: ctxFor("sam"), origin: "", selected: ["a", "c", "zzz"] });
    expect(done.status).toBe("done");
    expect(executed[0].values.ids).toEqual(["a", "c"]);
  });

  it("refuses a proposal the record has moved on from", async () => {
    const card = await propose("test.create", { name: "J", phone: "2524012775", kind: "A" });
    staleReason = "it was changed by someone else after this was proposed.";
    await expect(run.confirmAction({ id: card.id, ctx: ctxFor("sam"), origin: "" })).rejects.toMatchObject({ status: 409 });
    expect(mem.tables.assistant_actions[0]).toMatchObject({ status: "failed" });
    expect(executed).toHaveLength(0);
  });

  it("records the endpoint's refusal as a failure, in its own words", async () => {
    const { RouteError } = await import("@/lib/assistant/actions/invoke");
    const card = await propose("test.create", { name: "J", phone: "2524012775", kind: "A" });
    executeError = new RouteError("This business is already in the system.", 409, {});
    const out = await run.confirmAction({ id: card.id, ctx: ctxFor("sam"), origin: "" });
    expect(out).toMatchObject({ status: "failed", error: "This business is already in the system." });
  });

  it("expires a proposal nobody confirmed in time", async () => {
    const card = await propose("test.create", { name: "J", phone: "2524012775", kind: "A" });
    mem.tables.assistant_actions[0].expires_at = new Date(Date.now() - 1000).toISOString();
    await expect(run.confirmAction({ id: card.id, ctx: ctxFor("sam"), origin: "" })).rejects.toMatchObject({ status: 410 });
    expect(mem.tables.assistant_actions[0].status).toBe("expired");
  });
});

describe("approvals", () => {
  it("lets someone without the permission send it to an approver, who runs it as themselves", async () => {
    const card = await propose("test.create", { name: "J", phone: "2524012775", kind: "A" }, ctxFor("sam", []));
    expect(card.approval?.reason).toMatch(/Create Thing/);
    await expect(run.confirmAction({ id: card.id, ctx: ctxFor("sam", []), origin: "" })).rejects.toMatchObject({ status: 403 });

    const sent = await run.requestApproval(card.id, ctxFor("sam", []), "Customer is waiting");
    expect(sent.status).toBe("awaiting_approval");
    expect(people.bell).toHaveBeenCalledWith(expect.anything(), "approver-1", expect.objectContaining({ title: expect.stringMatching(/asks you to approve/) }));

    const done = await run.confirmAction({ id: card.id, ctx: ctxFor("boss", ["things.create"]), origin: "", asApprover: { note: "ok" } });
    expect(done.status).toBe("done");
    expect(executed[0]).toMatchObject({ as: "boss", requester: "sam" });
    expect(mem.tables.assistant_actions[0]).toMatchObject({ approver_id: "boss", approval_note: "ok" });
  });

  it("an approver who lacks the permission too cannot approve it", async () => {
    const card = await propose("test.create", { name: "J", phone: "2524012775", kind: "A" }, ctxFor("sam", []));
    await run.requestApproval(card.id, ctxFor("sam", []), null);
    await expect(run.confirmAction({ id: card.id, ctx: ctxFor("boss", []), origin: "", asApprover: {} })).rejects.toMatchObject({ status: 403 });
  });

  it("nobody approves their own request — another approver has to", async () => {
    mem.tables.assistant_action_settings = [{ action_key: "test.create", enabled: true, require_approval: true }];
    const card = await propose("test.create", { name: "J", phone: "2524012775", kind: "A" }, ctxFor("boss"));
    expect(card.approval?.reason).toMatch(/approved before it runs/);
    await run.requestApproval(card.id, ctxFor("boss"), null);
    await expect(run.confirmAction({ id: card.id, ctx: ctxFor("boss"), origin: "", asApprover: {} })).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/own request/) });
    expect(executed).toHaveLength(0);
    const done = await run.confirmAction({ id: card.id, ctx: ctxFor("boss-2"), origin: "", asApprover: {} });
    expect(done.status).toBe("done");
  });

  it("the approver types the name of a high-impact change too", async () => {
    mem.tables.assistant_action_settings = [{ action_key: "test.critical", enabled: true, require_approval: true }];
    const card = await propose("test.critical", { domain: "jumbospizza.com" });
    await run.requestApproval(card.id, ctxFor("sam"), null);
    await expect(run.confirmAction({ id: card.id, ctx: ctxFor("boss"), origin: "", asApprover: {} })).rejects.toMatchObject({ status: 422 });
    expect(executed).toHaveLength(0);
    const done = await run.confirmAction({ id: card.id, ctx: ctxFor("boss"), origin: "", asApprover: {}, phrase: "jumbospizza.com" });
    expect(done.status).toBe("done");
  });

  it("sends the card as the person left it: their edits and unticked records", async () => {
    const card = await propose("test.create", { name: "J", phone: "2524012775", kind: "A" }, ctxFor("sam", []));
    // A wrong edit is refused and the proposal stays open.
    await expect(run.requestApproval(card.id, ctxFor("sam", []), null, { edits: { phone: "555" } })).rejects.toMatchObject({ status: 422 });
    expect(mem.tables.assistant_actions[0].status).toBe("proposed");
    const sent = await run.requestApproval(card.id, ctxFor("sam", []), null, { edits: { name: "Jumbo's Pizza" } });
    expect(sent.fields.find((f) => f.name === "name")?.value).toBe("Jumbo's Pizza");
    await run.confirmAction({ id: card.id, ctx: ctxFor("boss"), origin: "", asApprover: {} });
    expect(executed[0].values).toMatchObject({ name: "Jumbo's Pizza" });

    mem.tables.assistant_action_settings = [{ action_key: "test.bulk", enabled: true, require_approval: true }];
    clearActionSettingsCache();
    const bulk = await propose("test.bulk", { ids: ["a", "b", "c"] });
    const waiting = await run.requestApproval(bulk.id, ctxFor("sam"), null, { selected: ["a", "c"] });
    expect(waiting.items?.map((i) => i.id)).toEqual(["a", "c"]);
    await run.confirmAction({ id: bulk.id, ctx: ctxFor("boss"), origin: "", asApprover: {} });
    expect(executed[1].values.ids).toEqual(["a", "c"]);
  });

  it("what only concerns the person's own things is never sent to, or run by, an approver", async () => {
    const out = await run.prepareAction({ ...base, key: "test.mine", fields: { tag: "hot" }, ctx: ctxFor("sam") });
    expect(out.kind).toBe("disabled");
    expect(out.kind === "disabled" && out.message).toMatch(/Tag Things/);

    // Even when an admin asked for approvals on it, it stays the person's own call.
    mem.tables.assistant_action_settings = [{ action_key: "test.mine", enabled: true, require_approval: true }];
    const card = await propose("test.mine", { tag: "hot" }, ctxFor("sam", ["things.tag"]));
    expect(card.approval).toBeFalsy();
    await expect(run.requestApproval(card.id, ctxFor("sam", ["things.tag"]), null)).rejects.toMatchObject({ status: 403 });
    mem.tables.assistant_actions[0].status = "awaiting_approval";
    await expect(run.confirmAction({ id: card.id, ctx: ctxFor("boss", ["things.tag"]), origin: "", asApprover: {} })).rejects.toMatchObject({ status: 403 });
    expect(executed).toHaveLength(0);
  });

  it("a rejection closes it and tells the requester", async () => {
    const card = await propose("test.create", { name: "J", phone: "2524012775", kind: "A" }, ctxFor("sam", []));
    await run.requestApproval(card.id, ctxFor("sam", []), null);
    const out = await run.rejectAction(card.id, ctxFor("boss"), "Not this one");
    expect(out.status).toBe("rejected");
    expect(people.bell).toHaveBeenCalledWith(expect.anything(), "sam", expect.objectContaining({ title: expect.stringMatching(/Not approved/) }));
  });
});

describe("undo", () => {
  it("undoes within the window, once", async () => {
    const card = await propose("test.create", { name: "J", phone: "2524012775", kind: "A" });
    await run.confirmAction({ id: card.id, ctx: ctxFor("sam"), origin: "" });
    const out = await run.undoAction(card.id, ctxFor("sam"));
    expect(out.status).toBe("undone");
    expect(undone).toEqual([card.id]);
    await expect(run.undoAction(card.id, ctxFor("sam"))).rejects.toMatchObject({ status: 409 });
  });

  it("refuses once the window has passed", async () => {
    const card = await propose("test.create", { name: "J", phone: "2524012775", kind: "A" });
    await run.confirmAction({ id: card.id, ctx: ctxFor("sam"), origin: "" });
    mem.tables.assistant_actions[0].undo_until = new Date(Date.now() - 1000).toISOString();
    await expect(run.undoAction(card.id, ctxFor("sam"))).rejects.toMatchObject({ status: 409 });
  });
});

describe("plans", () => {
  it("checks every step first, then proposes them together; a later step uses the record an earlier one creates", async () => {
    const incomplete = await run.preparePlan("New client", [{ action: "test.create", fields: { name: "J" } }, { action: "test.child", fields: { lead: "@1" } }], { ...base, ctx: ctxFor("sam") });
    expect(incomplete.kind).toBe("needs_input");
    expect(mem.tables.assistant_actions ?? []).toHaveLength(0);

    const out = await run.preparePlan(
      "New client",
      [
        { action: "test.create", fields: { name: "Jumbo's", phone: "2524012775", kind: "A" } },
        { action: "test.child", fields: { lead: "@1", note: "Logo attached" } },
      ],
      { ...base, ctx: ctxFor("sam") },
    );
    expect(out.kind).toBe("proposed");
    if (out.kind !== "proposed") return;
    expect(out.cards.map((c) => c.plan?.index)).toEqual([1, 2]);

    // Step 2 cannot run before step 1 exists.
    await expect(run.confirmAction({ id: out.cards[1].id, ctx: ctxFor("sam"), origin: "" })).rejects.toMatchObject({ status: 409 });

    const cards = await run.confirmPlan(out.planId, ctxFor("sam"), "");
    expect(cards.map((c) => c.status)).toEqual(["done", "done"]);
    expect(executed.find((e) => e.key === "test.child")?.values.lead).toBe("00000000-0000-4000-8000-000000000123");
  });

  it("Run all runs each step as its card was left", async () => {
    const out = await run.preparePlan(
      "New client",
      [
        { action: "test.create", fields: { name: "Jumbos", phone: "2524012775", kind: "A" } },
        { action: "test.child", fields: { lead: "@1", note: "Logo attached" } },
      ],
      { ...base, ctx: ctxFor("sam") },
    );
    if (out.kind !== "proposed") throw new Error(out.kind);
    const cards = await run.confirmPlan(out.planId, ctxFor("sam"), "", { [out.cards[0].id]: { edits: { name: "Jumbo's Grill" } }, [out.cards[1].id]: { edits: { note: "Logo + photos" } } });
    expect(cards.map((c) => c.status)).toEqual(["done", "done"]);
    expect(executed.map((e) => [e.key, e.values.name ?? e.values.note])).toEqual([
      ["test.create", "Jumbo's Grill"],
      ["test.child", "Logo + photos"],
    ]);
  });

  it("a later step may not point at itself or a later one", async () => {
    const out = await run.preparePlan("Bad", [{ action: "test.child", fields: { lead: "@1", note: "x" } }], { ...base, ctx: ctxFor("sam") });
    expect(out.kind).toBe("needs_input");
  });
});
