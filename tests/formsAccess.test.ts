// @vitest-environment node
import { describe, it, expect } from "vitest";
import { allowedFormScope, endpointInScope, type FormScope } from "@/lib/forms/access";

function fakeAdmin(leadIds: string[]) {
  return {
    from: () => ({ select: () => ({ eq: () => ({ is: async () => ({ data: leadIds.map((id) => ({ id })) }) }) }) }),
  } as unknown as Parameters<typeof allowedFormScope>[0];
}

describe("allowedFormScope", () => {
  it("is global with leads.view_all", async () => {
    const s = await allowedFormScope(fakeAdmin([]), "u1", new Set(["leads.view_all"]));
    expect(s).toEqual({ all: true, manage: false });
  });
  it("otherwise lists the user's own leads and remembers manage", async () => {
    const s = await allowedFormScope(fakeAdmin(["l1"]), "u1", new Set(["forms.manage"]));
    expect(s.all).toBe(false);
    if (s.all) return;
    expect([...s.leadIds]).toEqual(["l1"]);
    expect(s.manage).toBe(true);
  });
});

describe("endpointInScope", () => {
  const own: FormScope = { all: false, leadIds: new Set(["l1"]), manage: false };
  const mgr: FormScope = { all: false, leadIds: new Set(), manage: true };
  it("global scope sees everything", () => {
    expect(endpointInScope({ lead_id: null }, { all: true, manage: false })).toBe(true);
  });
  it("own leads only; lead-less endpoints need manage", () => {
    expect(endpointInScope({ lead_id: "l1" }, own)).toBe(true);
    expect(endpointInScope({ lead_id: "l2" }, own)).toBe(false);
    expect(endpointInScope({ lead_id: null }, own)).toBe(false);
    expect(endpointInScope({ lead_id: null }, mgr)).toBe(true);
  });
});
