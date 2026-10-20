// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActionContext } from "@/lib/assistant/actions/types";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";

/**
 * lead.categorize — many leads, each to its own category, as ONE action: the
 * job "categorise the whole pipeline" needs, instead of one card per lead.
 * Through the lead endpoint (so permissions and the activity log apply),
 * keeping the pipeline's existing spelling, honouring unticks, and undoable.
 */

const patched: { id: string; body: Record<string, unknown> }[] = [];
const failFor = new Set<string>();
vi.mock("@/app/api/leads/[id]/route", () => ({
  PATCH: vi.fn(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (failFor.has(id)) return Response.json({ error: "Forbidden" }, { status: 403 });
    patched.push({ id, body: (await req.json()) as Record<string, unknown> });
    return Response.json({ ok: true });
  }),
}));

const run = await import("@/lib/assistant/actions/run");
const { clearActionSettingsCache } = await import("@/lib/assistant/actions/store");
const { clearPermissionCapCache } = await import("@/lib/assistant/actions/permissionStore");
const { CATEGORIZE_MAX } = await import("@/lib/assistant/actions/defs/leads");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let mem: MemoryDb;

function ctx(perms = ["leads.edit"]): ActionContext {
  return { userId: "sam", displayName: "Sam", perms: new Set(perms), db: mem.client, admin: mem.client, timezone: "Asia/Karachi", now: new Date(), isAdmin: false };
}
const base = { conversationId: "c1", turnId: "t1", callId: "k1", source: "chat" as const };

beforeEach(() => {
  patched.length = 0;
  failFor.clear();
  clearActionSettingsCache();
  clearPermissionCapCache();
  mem = memorySupabase(
    {
      leads: [
        { id: id(1), business_name: "Master Painter", category: null, deleted_at: null },
        { id: id(2), business_name: "Light Work Electric", category: null, deleted_at: null },
        { id: id(3), business_name: "Cool Air", category: null, deleted_at: null },
        { id: id(4), business_name: "Old HVAC Co", category: "HVAC", deleted_at: null },
        { id: id(5), business_name: "Gone", category: null, deleted_at: "2026-01-01T00:00:00Z" },
      ],
      app_settings: [{ singleton: true, assistant_max_permission_mode: "auto" }],
    },
    {
      assistant_actions: () => ({
        status: "proposed",
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        approver_id: null, approval_note: null, decided_at: null, reported_at: null, result: null, error: null, undo_until: null, executed_at: null,
      }),
    },
  );
});

const assignments = [
  { lead: id(1), category: "Painting" },
  { lead: id(2), category: "Electrical" },
  { lead: id(3), category: "hvac" },
];

async function propose(list: unknown, c = ctx()) {
  return run.prepareAction({ ...base, key: "lead.categorize", fields: { assignments: list }, ctx: c });
}

describe("lead.categorize", () => {
  it("one card for many leads, each with its own category — the pipeline's spelling kept", async () => {
    const out = await propose(assignments);
    if (out.kind !== "proposed") throw new Error(JSON.stringify(out));
    expect(out.card).toMatchObject({ title: "Set categories — 3 leads", risk: "standard", confirmLabel: "Set categories" });
    expect(out.card.items?.map((i) => [i.label, i.detail])).toEqual([
      ["Master Painter", "→ Painting"],
      ["Light Work Electric", "→ Electrical"],
      ["Cool Air", "→ HVAC"], // "hvac" takes the existing "HVAC"
    ]);
    expect(out.card.warnings).toEqual(["New categories not used on any lead yet: Painting, Electrical."]);
  });

  it("runs through the lead endpoint, honours unticks, and Undo restores every old category", async () => {
    const out = await propose(assignments);
    if (out.kind !== "proposed") throw new Error(out.kind);
    const card = await run.confirmAction({ id: out.card.id, ctx: ctx(), origin: "x", selected: [id(1), id(3)] });
    expect(card.status).toBe("done");
    expect(card.result?.message).toBe("Set the category on 2 leads (Painting 1, HVAC 1).");
    expect(patched).toEqual([
      { id: id(1), body: { category: "Painting" } },
      { id: id(3), body: { category: "HVAC" } },
    ]);
    patched.length = 0;
    await run.undoAction(out.card.id, ctx());
    expect(patched.map((p) => p.body)).toEqual([{ category: null }, { category: null }]);
  });

  it("runs on its own under a permission mode, as one change", async () => {
    const out = await propose(assignments);
    if (out.kind !== "proposed") throw new Error(out.kind);
    const budget = { left: 1 };
    const r = await run.autoRun(out.card, ctx(), { mode: "auto_safe", cap: "auto", allow: [], origin: "x", budget });
    expect(r.ran).toBe(true);
    expect(patched).toHaveLength(3);
    expect(budget.left).toBe(0);
  });

  it("more than 50 leads is a change to check (Auto: safe leaves it on a card); over the maximum is refused", async () => {
    for (let n = 10; n < 70; n++) mem.tables.leads.push({ id: id(n), business_name: `Lead ${n}`, category: null, deleted_at: null });
    const many = Array.from({ length: 60 }, (_, i) => ({ lead: id(10 + i), category: "Roofing" }));
    const out = await propose(many);
    expect(out.kind === "proposed" && out.card.risk).toBe("sensitive");
    const tooMany = Array.from({ length: CATEGORIZE_MAX + 1 }, (_, i) => ({ lead: id(1000 + i), category: "Roofing" }));
    const refused = await propose(tooMany);
    expect(refused.kind).toBe("needs_input");
    expect(JSON.stringify(refused)).toMatch(/At most 200 leads/);
  });

  it("refuses leads that aren't visible (or archived), bad entries, and people without edit rights", async () => {
    const out = await propose([{ lead: id(5), category: "Painting" }, { lead: "nope", category: "X" }, { lead: id(1), category: "" }]);
    expect(out.kind).toBe("needs_input");
    const text = JSON.stringify(out);
    expect(text).toMatch(/not visible to you \(or archived\)/);
    expect(text).toMatch(/must be a lead id/);
    expect(text).toMatch(/give a category/);
    const noPerm = await propose(assignments, ctx([]));
    expect(noPerm.kind === "proposed" && noPerm.card.approval).toBeTruthy();
  });

  it("reports leads the endpoint refused, and changes nothing when every one fails", async () => {
    failFor.add(id(2));
    const out = await propose(assignments);
    if (out.kind !== "proposed") throw new Error(out.kind);
    const card = await run.confirmAction({ id: out.card.id, ctx: ctx(), origin: "x" });
    expect(card.result?.message).toMatch(/2 leads.*1 lead could not be updated/);
    failFor.add(id(1)).add(id(3));
    const again = await propose(assignments);
    if (again.kind !== "proposed") throw new Error(again.kind);
    const failed = await run.confirmAction({ id: again.card.id, ctx: ctx(), origin: "x" });
    expect(failed.status).toBe("failed");
  });
});
