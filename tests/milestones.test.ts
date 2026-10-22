// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";
import { celebrationFor, leadMilestone, markMilestoneSeen, MILESTONE_FRESH_MS, pendingMilestone, seenMilestone, MilestoneError } from "@/lib/milestones";

/**
 * Every 1,000 leads the whole company gets a celebration — once per person:
 * shown the next time they open the app, then never again until the next
 * thousand, whatever device they use.
 */

const now = new Date("2026-10-22T09:00:00Z");
const day = 86_400_000;
const iso = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();

describe("leadMilestone / pendingMilestone", () => {
  it("every thousand, nothing below the first", () => {
    expect([0, 999, 1000, 1001, 1999, 2000, 3450].map(leadMilestone)).toEqual([0, 0, 1000, 1000, 1000, 2000, 3000]);
  });

  it("owed once: reached, not seen yet, still news", () => {
    expect(pendingMilestone({ count: 1000, seen: 0, reachedAt: iso(day), now })).toBe(1000);
    expect(pendingMilestone({ count: 1450, seen: 1000, reachedAt: iso(day), now })).toBeNull(); // seen — never again before 2,000
    expect(pendingMilestone({ count: 2003, seen: 1000, reachedAt: iso(day), now })).toBe(2000); // the next one
    expect(pendingMilestone({ count: 999, seen: 0, reachedAt: null, now })).toBeNull();
    expect(pendingMilestone({ count: 1000, seen: 0, reachedAt: iso(MILESTONE_FRESH_MS + day), now })).toBeNull(); // joined long after
  });

  it("reads what a person has seen from their preferences", () => {
    expect(seenMilestone({ milestones: { leads: 1000 } })).toBe(1000);
    expect(seenMilestone({})).toBe(0);
    expect(seenMilestone(null)).toBe(0);
    expect(seenMilestone({ milestones: { leads: "lots" } })).toBe(0);
  });
});

function company(leads: number, over: { prefs?: Record<string, unknown>; deleted?: number; mine?: number; closed?: number } = {}): MemoryDb {
  const rows = Array.from({ length: leads }, (_, i) => ({
    id: `L${i}`,
    created_at: new Date(now.getTime() - (leads - i) * 60_000).toISOString(),
    deleted_at: null,
    agent_id: i < (over.mine ?? 0) ? "U1" : "U2",
    status: i < (over.closed ?? 0) ? "Closed" : "Ready",
  }));
  for (let i = 0; i < (over.deleted ?? 0); i++) rows.push({ id: `D${i}`, created_at: iso(5 * day), deleted_at: iso(day) as never, agent_id: "U1", status: "Ready" });
  return memorySupabase({
    leads: rows,
    profiles: [
      { id: "U1", ui_preferences: over.prefs ?? { density: "compact" }, is_active: true },
      { id: "U2", ui_preferences: {}, is_active: null },
      { id: "U3", ui_preferences: {}, is_active: false },
    ],
  });
}

describe("celebrationFor", () => {
  it("at 1,000 live leads: the celebration, with their share and the team's", async () => {
    const db = company(1000, { mine: 137, closed: 89 });
    expect(await celebrationFor(db.client, "U1", now)).toEqual({
      milestone: 1000,
      total: 1000,
      mine: 137,
      closed: 89,
      team: 2, // active accounts (not the deactivated one)
      reachedAt: expect.any(String),
      next: 2000,
    });
  });

  it("archived leads don't count; already seen → nothing", async () => {
    expect(await celebrationFor(company(995, { deleted: 10 }).client, "U1", now)).toBeNull();
    expect(await celebrationFor(company(1200, { prefs: { milestones: { leads: 1000 } } }).client, "U1", now)).toBeNull();
  });
});

describe("markMilestoneSeen", () => {
  it("keeps it in their preferences (the rest untouched), never lower, only one the company reached", async () => {
    const db = company(1000);
    expect(await markMilestoneSeen(db.client, "U1", 1000, now)).toBe(1000);
    const prefs = db.tables.profiles[0].ui_preferences as Record<string, unknown>;
    expect(prefs).toEqual({ density: "compact", milestones: { leads: 1000, leadsSeenAt: now.toISOString() } });
    expect(await celebrationFor(db.client, "U1", now)).toBeNull(); // a refresh shows nothing
    await expect(markMilestoneSeen(db.client, "U1", 2000, now)).rejects.toThrow(MilestoneError);
    await expect(markMilestoneSeen(db.client, "U1", 1500, now)).rejects.toThrow(MilestoneError);
  });
});

describe("wiring", () => {
  it("every page of the app mounts the celebration", () => {
    expect(readFileSync("app/(app)/layout.tsx", "utf8")).toMatch(/<MilestoneCelebration displayName=/);
  });
});

describe("/api/me/milestone", () => {
  const h = vi.hoisted(() => ({ user: { id: "U1" } as { id: string } | null, db: null as unknown as MemoryDb }));
  vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }) }));
  vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client }));

  beforeEach(() => {
    h.user = { id: "U1" };
    h.db = company(1000);
  });

  it("GET → the celebration; POST → seen; GET again → nothing", async () => {
    const { GET, POST } = await import("@/app/api/me/milestone/route");
    expect((await (await GET()).json()).celebration).toMatchObject({ milestone: 1000 });
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ milestone: 1000 }) }));
    expect(await res.json()).toEqual({ seen: 1000 });
    expect((await (await GET()).json()).celebration).toBeNull();
    expect((await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ milestone: 5000 }) }))).status).toBe(422);
  });

  it("signed out → 401", async () => {
    h.user = null;
    const { GET } = await import("@/app/api/me/milestone/route");
    expect((await GET()).status).toBe(401);
  });
});
