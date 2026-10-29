import { describe, it, expect } from "vitest";
import { memorySupabase } from "./helpers/memorySupabase";
import { parsePriority, loadHitlist, setHitlist, removeHitlist } from "@/lib/hitlist/store";

type Admin = Parameters<typeof loadHitlist>[0];
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("hitlist — priority parsing", () => {
  it("takes whole numbers 1 to 5, numeric strings included", () => {
    expect([1, 2, 3, 4, 5].map(parsePriority)).toEqual([1, 2, 3, 4, 5]);
    expect(parsePriority("4")).toBe(4);
  });
  it("rejects anything else", () => {
    for (const v of [0, 6, -1, 2.5, "", " ", "x", null, undefined, true, {}, [3], NaN]) expect(parsePriority(v)).toBeNull();
  });
});

describe("hitlist — store", () => {
  it("loads lead id → stars", async () => {
    const db = memorySupabase({ lead_hitlist: [{ lead_id: A, priority: 5 }, { lead_id: B, priority: 2 }] });
    expect(await loadHitlist(db.client as Admin)).toEqual({ [A]: 5, [B]: 2 });
  });

  it("an error (table not there yet) reads as an empty list", async () => {
    const client = { from: () => ({ select: async () => ({ data: null, error: { message: "relation does not exist" } }) }) };
    expect(await loadHitlist(client as unknown as Admin)).toEqual({});
  });

  it("adding writes one row and logs it on the lead", async () => {
    const db = memorySupabase({ lead_hitlist: [] });
    expect(await setHitlist(db.client as Admin, A, 4, "admin-1")).toEqual({});
    expect(db.tables.lead_hitlist).toHaveLength(1);
    expect(db.tables.lead_hitlist[0]).toMatchObject({ lead_id: A, priority: 4, added_by: "admin-1" });
    expect(db.tables.activity_log).toEqual([
      expect.objectContaining({ action: "lead.hitlist_added", entity_id: A, old_value: null, new_value: { hitlist_priority: 4 } }),
    ]);
  });

  it("re-rating updates the same row and logs the change", async () => {
    const db = memorySupabase({ lead_hitlist: [{ lead_id: A, priority: 2 }] });
    await setHitlist(db.client as Admin, A, 5, "admin-1");
    expect(db.tables.lead_hitlist).toEqual([expect.objectContaining({ lead_id: A, priority: 5 })]);
    expect(db.tables.activity_log).toEqual([
      expect.objectContaining({ action: "lead.hitlist_priority", old_value: { hitlist_priority: 2 }, new_value: { hitlist_priority: 5 } }),
    ]);
  });

  it("the same priority again writes no log line", async () => {
    const db = memorySupabase({ lead_hitlist: [{ lead_id: A, priority: 3 }] });
    await setHitlist(db.client as Admin, A, 3, "admin-1");
    expect(db.tables.activity_log ?? []).toEqual([]);
  });

  it("removing deletes the row and logs the old stars", async () => {
    const db = memorySupabase({ lead_hitlist: [{ lead_id: A, priority: 3 }, { lead_id: B, priority: 1 }] });
    expect(await removeHitlist(db.client as Admin, A, "admin-1")).toEqual({});
    expect(db.tables.lead_hitlist).toEqual([expect.objectContaining({ lead_id: B })]);
    expect(db.tables.activity_log).toEqual([
      expect.objectContaining({ action: "lead.hitlist_removed", entity_id: A, old_value: { hitlist_priority: 3 }, new_value: null }),
    ]);
  });

  it("removing a lead that isn't on the list is a quiet no-op", async () => {
    const db = memorySupabase({ lead_hitlist: [] });
    expect(await removeHitlist(db.client as Admin, A, "admin-1")).toEqual({});
    expect(db.tables.activity_log ?? []).toEqual([]);
  });
});
