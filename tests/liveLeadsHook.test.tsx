import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

/**
 * The real useLiveLeads wiring — engine + scheduler + tick channel + focus —
 * over a fake Supabase and a fake tick channel.
 */
const server = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  reads: { page: 0, changedSince: 0, count: 0 },
}));
vi.mock("@/lib/leads/liveSource", () => ({
  LEADS_CACHE_PREFIX: "leads:",
  idbLeadsCache: { load: async () => null, save: async () => {} },
  supabaseLeadsSource: () => ({
    async page() {
      server.reads.page++;
      return server.rows.filter((r) => !r.deleted_at);
    },
    async changedSince(since: string) {
      server.reads.changedSince++;
      return server.rows.filter((r) => String(r.updated_at) > since);
    },
    async count() {
      server.reads.count++;
      return server.rows.filter((r) => !r.deleted_at).length;
    },
    async ids() {
      return server.rows.filter((r) => !r.deleted_at).map((r) => String(r.id));
    },
    async byIds() {
      return [];
    },
    async tagLinks() {
      return [];
    },
  }),
}));
const ticks = vi.hoisted(() => ({ fns: [] as ((k: "leads" | "tags") => void)[] }));
vi.mock("@/lib/realtime/leadsTicks", () => ({
  subscribeLeadsTicks: (fn: (k: "leads" | "tags") => void) => {
    ticks.fns.push(fn);
    return () => {
      ticks.fns = ticks.fns.filter((f) => f !== fn);
    };
  },
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ has: () => true, hasAny: () => true, all: new Set(["leads.view"]) }),
}));

import { useLiveLeads } from "@/hooks/useLiveLeads";
import { ViewScopeProvider } from "@/providers/ViewScopeProvider";

function Names() {
  const { status, leads } = useLiveLeads();
  return <div data-testid="out">{status}:{leads.map((l) => l.business_name).join(",")}</div>;
}

const row = (id: string, name: string, minute: number) => ({
  id,
  business_name: name,
  created_at: new Date(Date.UTC(2026, 10, 5, 10, minute)).toISOString(),
  updated_at: new Date(Date.UTC(2026, 10, 5, 10, minute)).toISOString(),
  deleted_at: null,
  tag_ids: [],
});

const flush = async (ms = 0) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

describe("useLiveLeads — wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    server.rows = [row("a", "Alpha", 1), row("b", "Bravo", 2)];
    server.reads = { page: 0, changedSince: 0, count: 0 };
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
  afterEach(() => vi.useRealTimers());

  it("loads once, then a tick brings in only the change — and a second screen shares the copy", async () => {
    render(
      <ViewScopeProvider userId="u-wiring">
        <Names />
      </ViewScopeProvider>,
    );
    await flush();
    expect(screen.getByTestId("out").textContent).toBe("ready:Bravo,Alpha");
    expect(server.reads.page).toBe(1);

    // Someone else adds a lead; the database ticks.
    server.rows.push(row("c", "Charlie", 30));
    act(() => ticks.fns.forEach((f) => f("leads")));
    await flush(1000);
    expect(screen.getByTestId("out").textContent).toBe("ready:Charlie,Bravo,Alpha");
    expect(server.reads.page).toBe(1); // never a second full read
    expect(server.reads.changedSince).toBeGreaterThanOrEqual(1);

    // Another screen (say the dashboard) mounts: same copy, no new read.
    render(
      <ViewScopeProvider userId="u-wiring">
        <Names />
      </ViewScopeProvider>,
    );
    await flush();
    expect(screen.getAllByTestId("out").map((n) => n.textContent)).toEqual([
      "ready:Charlie,Bravo,Alpha",
      "ready:Charlie,Bravo,Alpha",
    ]);
    expect(server.reads.page).toBe(1);
  });
});

describe("useLiveLeads — sign-out", () => {
  it("resetLiveLeads drops the tab's copy; the next person starts from a fresh read", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    server.rows = [row("a", "Alpha", 1)];
    server.reads = { page: 0, changedSince: 0, count: 0 };
    const { resetLiveLeads } = await import("@/hooks/useLiveLeads");
    const first = render(
      <ViewScopeProvider userId="u-signout">
        <Names />
      </ViewScopeProvider>,
    );
    await flush();
    expect(server.reads.page).toBe(1);
    first.unmount();
    resetLiveLeads();
    expect(ticks.fns).toHaveLength(0); // no tick listener left behind
    render(
      <ViewScopeProvider userId="u-signout">
        <Names />
      </ViewScopeProvider>,
    );
    await flush();
    expect(server.reads.page).toBe(2);
    vi.useRealTimers();
  });
});
