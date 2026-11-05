import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// ── LiveLeadsGate: what a leads screen shows before / after the copy is ready ──
const live = vi.hoisted(() => ({
  snap: { status: "idle", leads: [] as { id: string }[], error: null as string | null, fromCache: false },
  retry: vi.fn(),
}));
vi.mock("@/hooks/useLiveLeads", () => ({
  useLiveLeads: () => ({ ...live.snap, retry: live.retry }),
  syncLeadsNow: () => {},
}));

// ── LeadLiveRefresh: the open lead page refreshing itself ──
const ticks = vi.hoisted(() => ({ fn: null as null | ((k: "leads" | "tags" | "other") => void), reconnect: null as null | (() => void) }));
vi.mock("@/lib/realtime/leadsTicks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/realtime/leadsTicks")>()),
  subscribeLeadsTicks: (fn: (k: "leads" | "tags" | "other") => void, onReconnect?: () => void) => {
    ticks.fn = fn;
    ticks.reconnect = onReconnect ?? null;
    return () => {
      ticks.fn = null;
    };
  },
}));
const db = vi.hoisted(() => ({ updatedAt: "2026-11-05T10:00:00Z", tags: [] as string[], reads: 0 }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          table === "leads"
            ? {
                maybeSingle: async () => {
                  db.reads++;
                  return { data: { updated_at: db.updatedAt }, error: null };
                },
              }
            : Promise.resolve({ data: db.tags.map((t) => ({ tag_id: t })), error: null }),
      }),
    }),
  }),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/leads", useSearchParams: () => new URLSearchParams() }));

import { LiveLeadsGate } from "@/components/leads/LiveLeads";
import { LeadLiveRefresh, LEAD_PAGE_CHECK_DELAY_MS } from "@/components/leads/LeadLiveRefresh";
import { toSyncRow } from "@/lib/leads/liveSource";
import { tickKind } from "@/lib/realtime/leadsTicks";

describe("LiveLeadsGate", () => {
  const child = (leads: { id: string }[]) => <div data-testid="screen">{leads.map((l) => l.id).join(",")}</div>;

  it("shows a skeleton until the leads are there", () => {
    live.snap = { status: "loading", leads: [], error: null, fromCache: false };
    render(<LiveLeadsGate>{child}</LiveLeadsGate>);
    expect(screen.getByLabelText("Loading leads")).toBeTruthy();
    expect(screen.queryByTestId("screen")).toBeNull();
  });

  it("a page can bring its own skeleton", () => {
    live.snap = { status: "idle", leads: [], error: null, fromCache: false };
    render(<LiveLeadsGate loading={<p>dashboard skeleton</p>}>{child}</LiveLeadsGate>);
    expect(screen.getByText("dashboard skeleton")).toBeTruthy();
  });

  it("renders the screen with the live leads once ready", () => {
    live.snap = { status: "ready", leads: [{ id: "a" }, { id: "b" }], error: null, fromCache: true };
    render(<LiveLeadsGate>{child}</LiveLeadsGate>);
    expect(screen.getByTestId("screen").textContent).toBe("a,b");
  });

  it("keeps showing the leads when a background sync failed", () => {
    live.snap = { status: "ready", leads: [{ id: "a" }], error: "timeout", fromCache: false };
    render(<LiveLeadsGate>{child}</LiveLeadsGate>);
    expect(screen.getByTestId("screen").textContent).toBe("a");
  });

  it("a failed first load says so and offers a retry", () => {
    live.snap = { status: "error", leads: [], error: "network down", fromCache: false };
    render(<LiveLeadsGate>{child}</LiveLeadsGate>);
    expect(screen.getByRole("alert").textContent).toContain("network down");
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(live.retry).toHaveBeenCalled();
  });
});

describe("toSyncRow / tickKind", () => {
  it("flattens the embedded tag links into sorted tag_ids", () => {
    const row = toSyncRow({ id: "x", business_name: "B", lead_tag_links: [{ tag_id: "t2" }, { tag_id: "t1" }] });
    expect(row.tag_ids).toEqual(["t1", "t2"]);
    expect("lead_tag_links" in row).toBe(false);
    expect(toSyncRow({ id: "y", lead_tag_links: null }).tag_ids).toEqual([]);
  });

  it("a lead_tag_links tick is a tags tick, a leads tick is leads, other tables are 'other'", () => {
    expect(tickKind({ table: "lead_tag_links", op: "INSERT" })).toBe("tags");
    expect(tickKind({ table: "leads", op: "UPDATE" })).toBe("leads");
    expect(tickKind({ table: "lead_tickets", op: "UPDATE" })).toBe("other");
    expect(tickKind({ table: "lead_follow_ups", op: "INSERT" })).toBe("other");
    // An unlabelled tick is treated as a leads change (safe: a delta read).
    expect(tickKind(null)).toBe("leads");
  });

  it("a tick for another table never reaches the open lead page", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    db.reads = 0;
    render(<LeadLiveRefresh leadId="L1" updatedAt="2026-11-05T10:00:00Z" tagIds={[]} />);
    ticks.fn!("other");
    await act(async () => {
      vi.advanceTimersByTime(LEAD_PAGE_CHECK_DELAY_MS * 2);
    });
    expect(db.reads).toBe(0);
    vi.useRealTimers();
  });
});

describe("LeadLiveRefresh — the open lead page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    router.refresh.mockClear();
    db.reads = 0;
    db.updatedAt = "2026-11-05T10:00:00Z";
    db.tags = ["t1"];
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
  afterEach(() => vi.useRealTimers());

  const settle = async () => {
    await act(async () => {
      vi.advanceTimersByTime(LEAD_PAGE_CHECK_DELAY_MS);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it("someone else edits THIS lead: the page refreshes", async () => {
    render(<LeadLiveRefresh leadId="L1" updatedAt="2026-11-05T10:00:00Z" tagIds={["t1"]} />);
    db.updatedAt = "2026-11-05T10:05:00Z";
    ticks.fn!("leads");
    await settle();
    expect(db.reads).toBe(1);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("a change to some OTHER lead: one tiny read, no refresh", async () => {
    render(<LeadLiveRefresh leadId="L1" updatedAt="2026-11-05T10:00:00Z" tagIds={["t1"]} />);
    ticks.fn!("leads");
    await settle();
    expect(db.reads).toBe(1);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("a burst of ticks is one check", async () => {
    render(<LeadLiveRefresh leadId="L1" updatedAt="2026-11-05T10:00:00Z" tagIds={["t1"]} />);
    ticks.fn!("leads");
    ticks.fn!("leads");
    ticks.fn!("leads");
    await settle();
    expect(db.reads).toBe(1);
  });

  it("a tag added to this lead refreshes the page", async () => {
    render(<LeadLiveRefresh leadId="L1" updatedAt="2026-11-05T10:00:00Z" tagIds={["t1"]} />);
    db.tags = ["t1", "t9"];
    ticks.fn!("tags");
    await settle();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("a hidden tab waits, then checks when looked at", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    render(<LeadLiveRefresh leadId="L1" updatedAt="2026-11-05T10:00:00Z" tagIds={["t1"]} />);
    db.updatedAt = "2026-11-05T10:05:00Z";
    ticks.fn!("leads");
    await settle();
    expect(db.reads).toBe(0);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
