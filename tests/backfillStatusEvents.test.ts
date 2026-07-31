import { describe, it, expect } from "vitest";
import { deriveStatusHistory } from "@/scripts/backfillStatusEvents.lib.mjs";

const row = (p: Record<string, unknown>) => ({
  user_id: "u1", action: "lead.status_changed", entity_id: "L1",
  old_value: null, new_value: null, created_at: "2026-01-01T00:00:00Z", ...p,
});

describe("deriveStatusHistory", () => {
  it("builds events from status_changed rows using old/new values", () => {
    const { events } = deriveStatusHistory({
      activityRows: [
        row({ old_value: { status: "Not Ready" }, new_value: { status: "Ready" }, created_at: "2026-01-02T00:00:00Z" }),
        row({ old_value: { status: "Ready" }, new_value: { status: "Closed" }, created_at: "2026-01-05T00:00:00Z" }),
      ],
      leads: [{ id: "L1", status: "Closed", updated_at: "2026-01-05T00:00:00Z" }],
      followUps: [],
    });
    expect(events).toEqual([
      expect.objectContaining({ lead_id: "L1", from_status: "Not Ready", to_status: "Ready", changed_at: "2026-01-02T00:00:00Z", source: "backfill" }),
      expect.objectContaining({ lead_id: "L1", from_status: "Ready", to_status: "Closed", changed_at: "2026-01-05T00:00:00Z", changed_by: "u1" }),
    ]);
  });

  it("reads lead.updated rows only when the diff contains status, and dedupes no-ops", () => {
    const { events } = deriveStatusHistory({
      activityRows: [
        row({ action: "lead.updated", new_value: { status: "Ready", rating: 5 }, old_value: { status: "Not Ready", rating: 2 } }),
        row({ action: "lead.updated", new_value: { rating: 7 }, old_value: { rating: 5 }, created_at: "2026-01-03T00:00:00Z" }),
        row({ action: "lead.updated", new_value: { status: "Ready" }, old_value: { status: "Ready" }, created_at: "2026-01-04T00:00:00Z" }),
      ],
      leads: [{ id: "L1", status: "Ready", updated_at: "2026-01-04T00:00:00Z" }],
      followUps: [],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ to_status: "Ready", from_status: "Not Ready" });
  });

  it("fans out bulk rows per id, carrying each lead's last known status", () => {
    const { events } = deriveStatusHistory({
      activityRows: [
        row({ old_value: { status: "Not Ready" }, new_value: { status: "Ready" } }),
        row({ action: "lead.bulk_status", entity_id: null, new_value: { ids: ["L1", "L2"], value: "Dropped" }, created_at: "2026-01-06T00:00:00Z" }),
      ],
      leads: [
        { id: "L1", status: "Dropped", updated_at: "2026-01-06T00:00:00Z" },
        { id: "L2", status: "Dropped", updated_at: "2026-01-06T00:00:00Z" },
      ],
      followUps: [],
    });
    expect(events).toHaveLength(3);
    expect(events[1]).toMatchObject({ lead_id: "L1", from_status: "Ready", to_status: "Dropped" });
    expect(events[2]).toMatchObject({ lead_id: "L2", from_status: null, to_status: "Dropped" });
  });

  it("synthesizes an approx event for terminal leads with no log trace", () => {
    const { events, patches } = deriveStatusHistory({
      activityRows: [],
      leads: [{ id: "L9", status: "Closed", updated_at: "2025-12-31T00:00:00Z" }],
      followUps: [],
    });
    expect(events).toEqual([
      expect.objectContaining({ lead_id: "L9", from_status: null, to_status: "Closed", changed_at: "2025-12-31T00:00:00Z", changed_by: null, source: "backfill_approx" }),
    ]);
    expect(patches).toEqual([
      { id: "L9", closed_at: "2025-12-31T00:00:00Z", dropped_at: null, first_touch_at: null },
    ]);
  });

  it("patches closed_at from the LAST entry into the current status, and first_touch_at from the earliest follow-up", () => {
    const { patches } = deriveStatusHistory({
      activityRows: [
        row({ old_value: { status: "Ready" }, new_value: { status: "Closed" }, created_at: "2026-01-05T00:00:00Z" }),
        row({ old_value: { status: "Closed" }, new_value: { status: "Ready" }, created_at: "2026-02-01T00:00:00Z" }),
        row({ old_value: { status: "Ready" }, new_value: { status: "Closed" }, created_at: "2026-03-01T00:00:00Z" }),
      ],
      leads: [
        { id: "L1", status: "Closed", updated_at: "2026-03-01T00:00:00Z" },
        { id: "L2", status: "Ready", updated_at: "2026-01-01T00:00:00Z" },
      ],
      followUps: [
        { lead_id: "L1", created_at: "2026-01-03T00:00:00Z" },
        { lead_id: "L1", created_at: "2026-01-02T00:00:00Z" },
        { lead_id: "L2", created_at: "2026-01-04T00:00:00Z" },
      ],
    });
    expect(patches).toEqual(
      expect.arrayContaining([
        { id: "L1", closed_at: "2026-03-01T00:00:00Z", dropped_at: null, first_touch_at: "2026-01-02T00:00:00Z" },
        { id: "L2", closed_at: null, dropped_at: null, first_touch_at: "2026-01-04T00:00:00Z" },
      ])
    );
  });

  it("emits no patch for untouched open leads", () => {
    const { patches } = deriveStatusHistory({
      activityRows: [],
      leads: [{ id: "L3", status: "Not Ready", updated_at: "2026-01-01T00:00:00Z" }],
      followUps: [],
    });
    expect(patches).toEqual([]);
  });
});
