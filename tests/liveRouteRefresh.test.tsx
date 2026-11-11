import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ path: "/pre-leads/all", params: { id: "L1" } as Record<string, string> }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), prefetch: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => nav.path,
  useParams: () => nav.params,
  useSearchParams: () => new URLSearchParams(),
}));
const ticks = vi.hoisted(() => ({ subs: [] as { tables: string[]; fn: (p: Record<string, string>) => void }[] }));
vi.mock("@/lib/realtime/tableTicks", async (orig) => ({
  ...(await orig<typeof import("@/lib/realtime/tableTicks")>()),
  subscribeTableTicks: (tables: string[], fn: (p: Record<string, string>) => void) => {
    const s = { tables, fn };
    ticks.subs.push(s);
    return () => {
      ticks.subs = ticks.subs.filter((x) => x !== s);
    };
  },
}));
const live = vi.hoisted(() => ({ leads: [] as Record<string, unknown>[] }));
vi.mock("@/hooks/useLiveLeads", () => ({
  useLiveLeads: () => ({ status: "ready", leads: live.leads, error: null, fromCache: false, retry: () => {} }),
}));

import { LiveRouteRefresh, REVISIT_FRESH_MS } from "@/components/layout/LiveRouteRefresh";
import { LeadLink, LEAD_PREFETCH_INTENT_MS } from "@/components/leads/LeadLink";
import LeadLoading from "@/app/(app)/leads/[id]/loading";

const fire = (table: string, extra: Record<string, string> = {}) =>
  act(() => ticks.subs.forEach((s) => s.tables.includes(table) && s.fn({ table, ...extra })));

describe("LiveRouteRefresh — every screen re-renders on changes to what it shows", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    router.refresh.mockClear();
    ticks.subs = [];
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
  afterEach(() => vi.useRealTimers());

  it("listens to the screen's tables and refreshes once for a burst", async () => {
    nav.path = "/pre-leads/all";
    render(<LiveRouteRefresh />);
    expect(ticks.subs[0].tables).toContain("pre_leads");
    fire("pre_leads", { id: "p1" });
    fire("pre_leads", { id: "p2" });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("a detail page ignores other rows", async () => {
    nav.path = "/tickets/T1";
    render(<LiveRouteRefresh />);
    fire("lead_tickets", { id: "T2" });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(router.refresh).not.toHaveBeenCalled();
    fire("ticket_items", { ticket_id: "T1" });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("screens that keep themselves live are left alone", () => {
    nav.path = "/leads/L1";
    render(<LiveRouteRefresh />);
    expect(ticks.subs).toHaveLength(0);
  });

  it("a revisit from the browser's copy is refreshed in the background", async () => {
    nav.path = "/contracts";
    const { rerender } = render(<LiveRouteRefresh />);
    nav.path = "/payments";
    rerender(<LiveRouteRefresh />);
    await act(async () => {
      vi.advanceTimersByTime(REVISIT_FRESH_MS + 1);
    });
    nav.path = "/contracts";
    rerender(<LiveRouteRefresh />);
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("LeadLink — the lead's page starts loading on intent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    router.prefetch.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("pointer resting on it prefetches the full page", () => {
    render(<LeadLink href="/leads/L1">Acme</LeadLink>);
    fireEvent.mouseEnter(screen.getByText("Acme"));
    act(() => {
      vi.advanceTimersByTime(LEAD_PREFETCH_INTENT_MS);
    });
    expect(router.prefetch).toHaveBeenCalledWith("/leads/L1");
  });

  it("a pointer just passing over does not", () => {
    render(<LeadLink href="/leads/L1">Acme</LeadLink>);
    fireEvent.mouseEnter(screen.getByText("Acme"));
    fireEvent.mouseLeave(screen.getByText("Acme"));
    act(() => {
      vi.advanceTimersByTime(LEAD_PREFETCH_INTENT_MS * 3);
    });
    expect(router.prefetch).not.toHaveBeenCalled();
  });

  it("keyboard focus or the press itself prefetches at once, once", () => {
    render(<LeadLink href="/leads/L1">Acme</LeadLink>);
    fireEvent.focus(screen.getByText("Acme"));
    fireEvent.pointerDown(screen.getByText("Acme"));
    expect(router.prefetch).toHaveBeenCalledTimes(1);
  });
});

describe("Opening a lead — the instant view", () => {
  it("shows the lead's real details from the live copy right away", () => {
    nav.params = { id: "L1" };
    live.leads = [
      { id: "L1", business_name: "Acme Roofing", status: "Ready", business_phone: "555-0100", business_email: "hi@acme.test", price_quoted: 1200 },
    ];
    render(<LeadLoading />);
    expect(screen.getByRole("heading", { name: "Acme Roofing" })).toBeTruthy();
    expect(screen.getByText("555-0100")).toBeTruthy();
    expect(screen.getByText("hi@acme.test")).toBeTruthy();
  });

  it("falls back to a lead-shaped placeholder when the lead isn't in the copy", () => {
    nav.params = { id: "missing" };
    live.leads = [];
    render(<LeadLoading />);
    expect(screen.getByTestId("lead-preview")).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
