// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";
import {
  checkCorrection,
  correctionsByEvent,
  currentStatusSince,
  lifecycleColumnPatch,
  statusSummary,
  STATUS_DATE_CORRECTED,
  type StatusHistory,
} from "@/lib/leads/statusHistory";

/**
 * A lead closed on Oct 30 but marked Closed on Nov 3 counts in November —
 * reports count by leads.closed_at. An admin moves the Closed change back and
 * the lead counts in October. These pin the rules that keep that honest: the
 * history stays in order, the report column follows the ledger, and the
 * correction is recorded.
 */

const LEAD = "11111111-1111-4111-8111-111111111111";
const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const AGENT = "bbbbbbbb-0000-4000-8000-000000000002";
const fmt = (iso: string) => iso;
const NOW = new Date("2026-11-10T12:00:00Z");

const ev = (id: string, from: string | null, to: string, at: string) => ({
  id, from_status: from, to_status: to, changed_at: at, by: null, source: "app", correction: null,
});

const history = (over: Partial<StatusHistory> = {}): StatusHistory => ({
  leadId: LEAD,
  status: "Closed",
  submittedAt: "2026-10-02T10:00:00Z",
  events: [
    ev("e1", "Not Ready", "Ready", "2026-10-20T10:00:00Z"),
    ev("e2", "Ready", "Closed", "2026-11-03T10:05:00Z"),
  ],
  ...over,
});

describe("checkCorrection", () => {
  it("allows moving the Closed change back into the previous month", () => {
    expect(checkCorrection(history(), "e2", "2026-10-30T16:00:00Z", NOW, fmt)).toEqual({ ok: true });
  });

  it("keeps the history in order: not before the change before it", () => {
    const r = checkCorrection(history(), "e2", "2026-10-19T09:00:00Z", NOW, fmt);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/after the change before it \(Ready, 2026-10-20T10:00:00Z\)/);
  });

  it("keeps the history in order: not after the change after it", () => {
    const r = checkCorrection(history(), "e1", "2026-11-04T00:00:00Z", NOW, fmt);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/before the change after it \(Closed/);
  });

  it("refuses a date in the future, allowing a little clock skew", () => {
    expect(checkCorrection(history(), "e2", "2026-11-11T00:00:00Z", NOW, fmt).ok).toBe(false);
    expect(checkCorrection(history(), "e2", new Date(NOW.getTime() + 60_000).toISOString(), NOW, fmt).ok).toBe(true);
  });

  it("allows a date before submission (late-entered leads) but warns", () => {
    const h = history({ events: [ev("e9", null, "Closed", "2026-10-02T10:00:00Z")] });
    const r = checkCorrection(h, "e9", "2026-09-28T10:00:00Z", NOW, fmt);
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/before the lead was submitted/);
  });

  it("rejects an unknown event and an unparseable date", () => {
    expect(checkCorrection(history(), "nope", "2026-10-30T16:00:00Z", NOW, fmt).ok).toBe(false);
    expect(checkCorrection(history(), "e2", "not a date", NOW, fmt).ok).toBe(false);
  });
});

describe("lifecycleColumnPatch", () => {
  it("mirrors the event the CURRENT Closed status came from into closed_at", () => {
    expect(lifecycleColumnPatch(history(), "e2", "2026-10-30T16:00:00Z")).toEqual({ closed_at: "2026-10-30T16:00:00Z" });
  });

  it("mirrors a current Dropped into dropped_at", () => {
    const h = history({ status: "Dropped", events: [ev("d1", "Ready", "Dropped", "2026-11-03T10:00:00Z")] });
    expect(lifecycleColumnPatch(h, "d1", "2026-10-29T10:00:00Z")).toEqual({ dropped_at: "2026-10-29T10:00:00Z" });
  });

  it("leaves the columns alone for an earlier change, or an open status", () => {
    expect(lifecycleColumnPatch(history(), "e1", "2026-10-19T10:00:00Z")).toBeNull();
    const reopened = history({ status: "Ready", events: [...history().events, ev("e3", "Closed", "Ready", "2026-11-05T10:00:00Z")] });
    expect(lifecycleColumnPatch(reopened, "e2", "2026-10-30T10:00:00Z")).toBeNull();
    expect(lifecycleColumnPatch(reopened, "e3", "2026-11-04T10:00:00Z")).toBeNull();
  });
});

describe("history reading", () => {
  it("dates the current status from its event, else from submission", () => {
    expect(currentStatusSince(history())).toBe("2026-11-03T10:05:00Z");
    expect(currentStatusSince(history({ status: "Not Ready", events: [] }))).toBe("2026-10-02T10:00:00Z");
  });

  it("summarises how long it took", () => {
    expect(statusSummary(history(), NOW)).toBe("Closed 32 days after it was submitted");
    expect(statusSummary(history({ status: "Not Ready", events: [] }), NOW)).toBe("Submitted 39 days ago");
    expect(statusSummary(history({ status: "Ready", events: [history().events[0]] }), NOW)).toBe("Ready for 21 days · submitted 39 days ago");
  });

  it("keeps the FIRST recorded date and the LATEST corrector per event", () => {
    const fixes = correctionsByEvent(
      [
        { user_id: "u2", created_at: "2026-11-06T00:00:00Z", old_value: { event_id: "e2", changed_at: "2026-11-01T00:00:00Z" } },
        { user_id: "u1", created_at: "2026-11-05T00:00:00Z", old_value: { event_id: "e2", changed_at: "2026-11-03T10:05:00Z" } },
        { user_id: "u1", created_at: "2026-11-05T00:00:00Z", old_value: null },
      ],
      (id) => (id === "u1" ? "Ana" : id === "u2" ? "Ben" : null),
    );
    expect(fixes.get("e2")).toEqual({ originalAt: "2026-11-03T10:05:00Z", by: "Ben", at: "2026-11-06T00:00:00Z" });
    expect(fixes.size).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

const holder = vi.hoisted(() => ({
  user: { id: "" } as { id: string } | null,
  isAdmin: false,
  perms: new Set<string>(),
  /** What the RLS-scoped user client can see. */
  visibleLeadIds: new Set<string>(),
  db: null as unknown as MemoryDb,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: holder.user } }) },
    from: (table: string) => {
      const q = holder.db.client.from(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
      // RLS stand-in: the viewer sees only the leads they may.
      const rows = holder.db.tables.leads.filter((l) => holder.visibleLeadIds.has(l.id as string));
      return table === "leads" ? memorySupabase({ leads: rows }).client.from("leads") : q;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => holder.db.client }));
vi.mock("@/lib/permissions/isAdminMember", () => ({ isAdminMember: async () => holder.isAdmin }));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => holder.perms }));
vi.mock("@/lib/settings/appSettings", () => ({ getAppSettings: async () => ({ work_timezone: "Asia/Karachi" }) }));

import { GET } from "@/app/api/leads/[id]/status-history/route";
import { PATCH } from "@/app/api/leads/[id]/status-history/[eventId]/route";

const E_READY = "eeeeeeee-0000-4000-8000-000000000001";
const E_CLOSED = "eeeeeeee-0000-4000-8000-000000000002";

function seed() {
  holder.db = memorySupabase({
    leads: [{ id: LEAD, status: "Closed", created_at: "2026-10-02T10:00:00Z", closed_at: "2026-11-03T10:05:00Z", dropped_at: null, deleted_at: null }],
    lead_status_events: [
      { id: E_READY, lead_id: LEAD, from_status: "Not Ready", to_status: "Ready", changed_by: AGENT, changed_at: "2026-10-20T10:00:00Z", source: "app" },
      { id: E_CLOSED, lead_id: LEAD, from_status: "Ready", to_status: "Closed", changed_by: AGENT, changed_at: "2026-11-03T10:05:00Z", source: "app" },
    ],
    activity_log: [],
    profiles: [
      { id: ADMIN, display_name: "Ana Admin" },
      { id: AGENT, display_name: "Sam Agent" },
    ],
  });
}

const patch = (eventId: string, body: unknown) =>
  PATCH(
    new Request(`http://test.local/api/leads/${LEAD}/status-history/${eventId}`, { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: LEAD, eventId }) },
  );
const leadRow = () => holder.db.tables.leads[0];
const eventRow = (id: string) => holder.db.tables.lead_status_events.find((e) => e.id === id)!;

beforeEach(() => {
  // The fixtures are dated November; "now" has to be after them.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  seed();
  holder.user = { id: ADMIN };
  holder.isAdmin = true;
  holder.perms = new Set(["leads.view"]);
  holder.visibleLeadIds = new Set([LEAD]);
});

afterEach(() => vi.useRealTimers());

describe("PATCH /api/leads/[id]/status-history/[eventId]", () => {
  it("moves the Closed change and closed_at together, and records the correction", async () => {
    const res = await patch(E_CLOSED, { changed_at: "2026-10-30T16:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(eventRow(E_CLOSED).changed_at).toBe("2026-10-30T16:00:00.000Z");
    expect(leadRow().closed_at).toBe("2026-10-30T16:00:00.000Z");

    const log = holder.db.tables.activity_log;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      user_id: ADMIN,
      action: STATUS_DATE_CORRECTED,
      entity_id: LEAD,
      old_value: { event_id: E_CLOSED, changed_at: "2026-11-03T10:05:00Z" },
      new_value: { event_id: E_CLOSED, changed_at: "2026-10-30T16:00:00.000Z" },
    });

    const { history: h } = (await res.json()) as { history: StatusHistory };
    const closed = h.events.find((e) => e.id === E_CLOSED)!;
    expect(closed.changed_at).toBe("2026-10-30T16:00:00.000Z");
    expect(closed.correction).toMatchObject({ originalAt: "2026-11-03T10:05:00Z", by: "Ana Admin" });
  });

  it("moves an earlier change without touching the report columns", async () => {
    const res = await patch(E_READY, { changed_at: "2026-10-18T09:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(eventRow(E_READY).changed_at).toBe("2026-10-18T09:00:00.000Z");
    expect(leadRow().closed_at).toBe("2026-11-03T10:05:00Z");
    expect(holder.db.writes.some(([t]) => t === "leads")).toBe(false);
  });

  it("is admin-only", async () => {
    holder.isAdmin = false;
    const res = await patch(E_CLOSED, { changed_at: "2026-10-30T16:00:00.000Z" });
    expect(res.status).toBe(403);
    expect(eventRow(E_CLOSED).changed_at).toBe("2026-11-03T10:05:00Z");
    expect(holder.db.writes).toHaveLength(0);
  });

  it("refuses an out-of-order date and writes nothing", async () => {
    const res = await patch(E_CLOSED, { changed_at: "2026-10-15T09:00:00.000Z" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/after the change before it/);
    expect(holder.db.writes).toHaveLength(0);
  });

  it("refuses a missing or invalid date", async () => {
    expect((await patch(E_CLOSED, {})).status).toBe(422);
    expect((await patch(E_CLOSED, { changed_at: "yesterday-ish" })).status).toBe(422);
  });

  it("404s an event that is not this lead's", async () => {
    const res = await patch("eeeeeeee-0000-4000-8000-00000000ffff", { changed_at: "2026-10-30T16:00:00.000Z" });
    expect(res.status).toBe(404);
  });

  it("treats re-saving the same date as a no-op", async () => {
    const res = await patch(E_CLOSED, { changed_at: "2026-11-03T10:05:00Z" });
    expect(res.status).toBe(200);
    expect(holder.db.writes).toHaveLength(0);
  });
});

describe("GET /api/leads/[id]/status-history", () => {
  const get = () => GET(new Request(`http://test.local/api/leads/${LEAD}/status-history`), { params: Promise.resolve({ id: LEAD }) });

  it("returns submission plus every change, oldest first, with who made it", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const { history: h } = (await res.json()) as { history: StatusHistory };
    expect(h.submittedAt).toBe("2026-10-02T10:00:00Z");
    expect(h.events.map((e) => [e.to_status, e.by])).toEqual([
      ["Ready", "Sam Agent"],
      ["Closed", "Sam Agent"],
    ]);
  });

  it("tells a viewer who cannot see the lead nothing", async () => {
    holder.visibleLeadIds = new Set();
    expect((await get()).status).toBe(404);
  });

  it("needs leads.view", async () => {
    holder.perms = new Set();
    expect((await get()).status).toBe(403);
  });
});
