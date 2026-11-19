import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { Lead } from "@/lib/leads/types";

/** The website deadline timers under the date in the leads table, and SENT. */

const perms = vi.hoisted(() => ({ set: new Set<string>() }));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ has: (k: string) => perms.set.has(k), hasAny: (ks: string[]) => ks.some((k) => perms.set.has(k)), all: perms.set }),
}));
vi.mock("@/hooks/useRealtimeRefresh", () => ({ useRealtimeRefresh: () => {} }));
vi.mock("@/hooks/useLiveLeads", () => ({ syncLeadsNow: vi.fn() }));
vi.mock("@/hooks/useSitesInReview", () => ({ useSitesInReview: () => new Set(["in-review"]) }));
vi.mock("@/providers/UiPrefsProvider", () => ({
  useUiPrefs: () => ({ density: "comfortable", columns: {}, setTableColumns: () => {} }),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/leads",
  useSearchParams: () => new URLSearchParams(),
}));

import { LeadsTable } from "@/components/leads/LeadsTable";
import { ToastProvider } from "@/components/common/Toast";

const CREATED = "2026-11-20T21:00:00Z"; // 1 PM Pacific
const FOLLOW = "2026-11-21T05:00:00Z"; // 9 PM Pacific
const lead = (id: string, name: string, over: Partial<Lead> = {}): Lead =>
  ({
    id, business_name: name, business_email: null, business_phone: null, status: "Not Ready", agent_id: null,
    created_at: CREATED, updated_at: CREATED, site_type: null, platform: null, last_followup_status: null,
    no_pickup_streak: 0, follow_up_time: FOLLOW, rating: null, price_quoted: null, website_link: null, tag_ids: [],
    ...over,
  }) as unknown as Lead;

const LEADS = [
  lead("has-site", "Alpha Roofing", { website_link: "https://alpha.dmviral.com" }),
  lead("no-site", "Bravo Plumbing"),
  lead("in-review", "Charlie Electric"),
  lead("ready", "Delta Dental", { status: "Ready", website_link: "https://delta.dmviral.com" }),
  lead("old", "Echo Auto", { created_at: "2026-11-01T21:00:00Z" }),
];
const TECH = ["leads.view", "leads.view_all", "leads.cat_view.ready", "leads.cat_view.not_ready", "tickets.resolve"];
const SALES = ["leads.view", "leads.view_all", "leads.cat_view.ready", "leads.cat_view.not_ready", "leads.status_change"];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sessionStorage.clear();
  fetchMock = vi.fn(async (url: RequestInfo | URL) =>
    String(url).startsWith("/api/me/views") ? new Response(JSON.stringify({ views: [] })) : new Response(JSON.stringify({ ok: true })),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => vi.useRealTimers());

function mount(p: string[], nowIso: string) {
  vi.setSystemTime(new Date(nowIso));
  perms.set = new Set(p);
  return render(
    <ToastProvider>
      <LeadsTable leads={LEADS} agentNameById={{}} salesAgents={[]} tags={[]} canViewTags={false} canManageTags={false} canShareTags={false} currentUserId="me" />
    </ToastProvider>,
  );
}
const rowOf = (name: string) => screen.getByText(name).closest("tr")!;
const timerIn = (name: string) => within(rowOf(name)).queryByTestId("deadline-timer");

describe("deadline timer under the date (Tech and Admin)", () => {
  it("1:30 PM: the blue 3-hour main timer is counting", async () => {
    mount(TECH, "2026-11-20T21:30:00Z");
    await waitFor(() => expect(timerIn("Alpha Roofing")).toBeTruthy());
    expect(timerIn("Alpha Roofing")!.dataset.phase).toBe("main");
    expect(timerIn("Alpha Roofing")!.textContent).toContain("Main · 2h 30m 00s");
  });

  it("5 PM: the amber bonus timer counts to the 9 PM follow-up, and says to send when ready", async () => {
    mount(TECH, "2026-11-21T01:00:00Z");
    await waitFor(() => expect(timerIn("Alpha Roofing")!.dataset.phase).toBe("bonus"));
    expect(timerIn("Alpha Roofing")!.textContent).toContain("Bonus · 4h 00m 00s");
    expect(timerIn("Alpha Roofing")!.textContent).toMatch(/send the website as soon as it's ready/i);
  });

  it("past 9 PM: red overdue", async () => {
    mount(TECH, "2026-11-21T05:25:00Z");
    await waitFor(() => expect(timerIn("Alpha Roofing")!.dataset.phase).toBe("overdue"));
    expect(timerIn("Alpha Roofing")!.textContent).toContain("Overdue 25m 00s");
  });

  it("no timer on Ready leads, or on leads from before the launch day", async () => {
    mount(TECH, "2026-11-20T21:30:00Z");
    await waitFor(() => expect(timerIn("Alpha Roofing")).toBeTruthy());
    expect(timerIn("Delta Dental")).toBeNull();
    expect(timerIn("Echo Auto")).toBeNull();
  });

  it("sales users don't see the timers", async () => {
    mount(SALES, "2026-11-20T21:30:00Z");
    await new Promise((r) => setTimeout(r, 1100));
    expect(timerIn("Alpha Roofing")).toBeNull();
  });
});

describe("SENT", () => {
  it("greyed out when the lead has no website yet; live when it has one or a site is in review", async () => {
    mount(TECH, "2026-11-20T21:30:00Z");
    await waitFor(() => expect(timerIn("Bravo Plumbing")).toBeTruthy());
    expect(within(timerIn("Bravo Plumbing")!).getByRole("button", { name: /sent/i })).toBeDisabled();
    expect(within(timerIn("Alpha Roofing")!).getByRole("button", { name: /mark alpha roofing's website sent/i })).not.toBeDisabled();
    expect(within(timerIn("Charlie Electric")!).getByRole("button", { name: /mark charlie electric's website sent/i })).not.toBeDisabled();
  });

  it("asks 'Sure?' once, then turns the lead Ready and the timer goes away", async () => {
    mount(TECH, "2026-11-20T21:30:00Z");
    await waitFor(() => expect(timerIn("Alpha Roofing")).toBeTruthy());
    fireEvent.click(within(timerIn("Alpha Roofing")!).getByRole("button", { name: /mark alpha roofing's website sent/i }));
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/sent"))).toBe(false);
    fireEvent.click(within(timerIn("Alpha Roofing")!).getByRole("button", { name: /confirm: alpha roofing's website was sent/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/leads/has-site/sent", { method: "POST" }));
    await waitFor(() => expect(timerIn("Alpha Roofing")).toBeNull());
  });
});
