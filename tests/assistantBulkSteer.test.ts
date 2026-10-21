// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { memorySupabase } from "./helpers/memorySupabase";
import { categoryEditsAsBulk, prepareActionTool, proposePlanTool } from "@/lib/assistant/tools/actions";
import { BULK_READ_TIP, leadDetailsTool, OPEN_ONE_BY_ONE_TIP_AFTER } from "@/lib/assistant/tools/leads";
import type { ToolContext } from "@/lib/assistant/tools/types";

/**
 * Seen live (2026-10-21): SED AI categorised the pipeline by opening leads
 * one at a time and proposing ten-card plans of lead.update — slow, and each
 * card spent one of the answer's 60 auto-run changes. Now ten category edits
 * become ONE bulk lead.categorize, and opening lead after lead says how to read
 * a hundred at once.
 */

const L = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("categoryEditsAsBulk", () => {
  it("a plan of one-lead category edits (by id) → one list of assignments", () => {
    expect(
      categoryEditsAsBulk([
        { action: "lead.update", fields: { lead: L(1), category: "Painting" } },
        { action: "lead.update", fields: { lead: L(2), category: " Roofing " } },
      ]),
    ).toEqual([
      { lead: L(1), category: "Painting" },
      { lead: L(2), category: "Roofing" },
    ]);
  });

  it("anything else is left as a plan: another field, another action, a lead by name, a single step", () => {
    expect(categoryEditsAsBulk([{ action: "lead.update", fields: { lead: L(1), category: "Painting", phone: "1" } }, { action: "lead.update", fields: { lead: L(2), category: "X" } }])).toBeNull();
    expect(categoryEditsAsBulk([{ action: "lead.update", fields: { lead: L(1), category: "Painting" } }, { action: "ticket.create", fields: {} }])).toBeNull();
    expect(categoryEditsAsBulk([{ action: "lead.update", fields: { lead: "Jumbo's Pizza", category: "Food" } }, { action: "lead.update", fields: { lead: L(2), category: "X" } }])).toBeNull();
    expect(categoryEditsAsBulk([{ action: "lead.update", fields: { lead: L(1), category: "Painting" } }])).toBeNull();
  });
});

describe("propose_plan with only category edits", () => {
  it("prepares ONE lead.categorize instead, and says so", async () => {
    const spy = vi.spyOn(prepareActionTool, "run").mockResolvedValue({ data: { status: "done", action_id: "a1" }, summary: "Set categories — 2 leads" });
    const steps = [
      { action: "lead.update", fields: { lead: L(1), category: "Painting" } },
      { action: "lead.update", fields: { lead: L(2), category: "Roofing" } },
    ];
    const ctx = { act: { mode: "act", turnId: "t", source: "chat", isAdmin: false } } as unknown as ToolContext;
    const r = await proposePlanTool.run({ title: "Batch 19", steps }, ctx);
    expect(spy).toHaveBeenCalledWith({ action: "lead.categorize", fields: { assignments: [{ lead: L(1), category: "Painting" }, { lead: L(2), category: "Roofing" }] } }, ctx);
    expect(r.data).toMatchObject({ status: "done", merged: expect.stringMatching(/ONE bulk change \(lead\.categorize\)/) });
    spy.mockRestore();
  });
});

describe("get_lead_details, lead after lead", () => {
  it(`after ${OPEN_ONE_BY_ONE_TIP_AFTER} in one answer, the result says how to read many at once`, async () => {
    const lead = { id: L(1), business_name: "Acme Roofing", status: "Ready", agent_id: null, closed_by: null, add_ons: [], services: [], service_areas: [] };
    const db = memorySupabase({ lead_follow_ups: [], lead_status_events: [] });
    const data = { leads: async () => [lead], names: async () => () => "Sam" };
    const ctx = { userId: "u", perms: new Set(["leads.view"]), db: db.client, admin: db.client, timezone: "Asia/Karachi", now: new Date(), data } as unknown as ToolContext;
    const tips: unknown[] = [];
    for (let i = 0; i < OPEN_ONE_BY_ONE_TIP_AFTER + 1; i++) tips.push(((await leadDetailsTool.run({ lead_id: L(1) }, ctx)).data as { tip?: string }).tip);
    expect(tips.slice(0, OPEN_ONE_BY_ONE_TIP_AFTER)).toEqual(Array(OPEN_ONE_BY_ONE_TIP_AFTER).fill(undefined));
    expect(tips.at(-1)).toBe(BULK_READ_TIP);
    // A new answer starts counting afresh.
    const fresh = { ...ctx, data: { ...data } } as unknown as ToolContext;
    expect(((await leadDetailsTool.run({ lead_id: L(1) }, fresh)).data as { tip?: string }).tip).toBeUndefined();
  });
});
