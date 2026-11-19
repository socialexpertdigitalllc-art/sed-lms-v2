import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { Lead } from "@/lib/leads/types";

/**
 * The HitList's one-click Direct Line tag and its filter, and the Timezone
 * filter on Leads and the HitList.
 */

const perms = vi.hoisted(() => ({ set: new Set<string>() }));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ has: (k: string) => perms.set.has(k), hasAny: (ks: string[]) => ks.some((k) => perms.set.has(k)), all: perms.set }),
}));
vi.mock("@/hooks/useRealtimeRefresh", () => ({ useRealtimeRefresh: () => {} }));
vi.mock("@/hooks/useLiveLeads", () => ({ syncLeadsNow: vi.fn() }));
vi.mock("@/providers/UiPrefsProvider", () => ({
  useUiPrefs: () => ({ density: "comfortable", columns: {}, setTableColumns: () => {} }),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }));
const nav = vi.hoisted(() => ({ path: "/hitlist", search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => nav.path,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { LeadsTable } from "@/components/leads/LeadsTable";
import { ToastProvider } from "@/components/common/Toast";

const lead = (id: string, name: string, phone: string, line: "direct" | "not_direct" | null = null): Lead =>
  ({
    id, business_name: name, business_email: null, business_phone: phone, status: "Ready", agent_id: null,
    created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z", site_type: null, platform: null,
    last_followup_status: null, no_pickup_streak: 0, follow_up_time: null, rating: null, price_quoted: null,
    website_link: null, tag_ids: [], line_type: line,
  }) as unknown as Lead;

const LEADS = [
  lead("a", "Alpha Roofing", "(212) 555-0100"), // Eastern, not set
  lead("b", "Bravo Plumbing", "(503) 555-0100", "direct"), // Pacific
  lead("c", "Charlie Electric", "(512) 555-0100", "not_direct"), // Central
];
const HIT = { a: 5, b: 4, c: 3 };
const CLOSER = ["leads.view", "leads.cat_view.ready", "hitlist.view"];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sessionStorage.clear();
  nav.path = "/hitlist";
  nav.search = "";
  fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.startsWith("/api/me/views")) return new Response(JSON.stringify({ views: [] }));
    return new Response(JSON.stringify({ ok: true }));
  });
  vi.stubGlobal("fetch", fetchMock);
});

function mount(p: { perms?: string[]; hitlist?: Record<string, number>; mode?: "leads" | "hitlist" } = {}) {
  perms.set = new Set(p.perms ?? CLOSER);
  return render(
    <ToastProvider>
      <LeadsTable
        leads={LEADS}
        agentNameById={{}}
        salesAgents={[]}
        tags={[]}
        canViewTags={false}
        canManageTags={false}
        canShareTags={false}
        currentUserId="me"
        hitlist={p.hitlist ?? HIT}
        canManageHitlist={false}
        mode={p.mode ?? "hitlist"}
      />
    </ToastProvider>,
  );
}

const rowOf = (name: string) => screen.getByText(name).closest("tr")!;
const lineCalls = () => fetchMock.mock.calls.filter(([u]) => /\/api\/hitlist\/[^/]+\/line$/.test(String(u)));
const pill = (name: string, label: RegExp) => within(within(rowOf(name)).getByRole("group", { name: new RegExp(`line for ${name}`, "i") })).getByRole("button", { name: label });

describe("Direct Line tag on the HitList", () => {
  it("shows every row's tag in the table — no need to open the lead", () => {
    mount();
    expect(screen.getByRole("columnheader", { name: "Line" })).toBeTruthy();
    expect(pill("Bravo Plumbing", /^direct$/i)).toHaveAttribute("aria-pressed", "true");
    expect(pill("Charlie Electric", /not direct/i)).toHaveAttribute("aria-pressed", "true");
    expect(pill("Alpha Roofing", /^direct$/i)).toHaveAttribute("aria-pressed", "false");
    expect(pill("Alpha Roofing", /not direct/i)).toHaveAttribute("aria-pressed", "false");
  });

  it("one click tags a lead (anyone who sees the HitList): shown at once, saved behind it", async () => {
    mount();
    fireEvent.click(pill("Alpha Roofing", /^direct$/i));
    expect(pill("Alpha Roofing", /^direct$/i)).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(lineCalls()[0]).toEqual(["/api/hitlist/a/line", expect.objectContaining({ method: "PUT", body: JSON.stringify({ line_type: "direct" }) })]),
    );
  });

  it("one click switches it; clicking the lit pill clears it", async () => {
    mount();
    fireEvent.click(pill("Bravo Plumbing", /not direct/i));
    expect(pill("Bravo Plumbing", /not direct/i)).toHaveAttribute("aria-pressed", "true");
    expect(pill("Bravo Plumbing", /^direct$/i)).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(pill("Charlie Electric", /not direct/i));
    expect(pill("Charlie Electric", /not direct/i)).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(lineCalls().map(([, init]) => (init as RequestInit).body)).toEqual([
      JSON.stringify({ line_type: "not_direct" }),
      JSON.stringify({ line_type: null }),
    ]));
  });

  it("a refused save puts the old tag back and says why", async () => {
    fetchMock.mockImplementation(async (url: RequestInfo | URL) =>
      /\/line$/.test(String(url)) ? new Response(JSON.stringify({ error: "Only people who can see the HitList can tag leads there." }), { status: 403 }) : new Response(JSON.stringify({ views: [] })),
    );
    mount();
    fireEvent.click(pill("Alpha Roofing", /^direct$/i));
    await waitFor(() => expect(screen.getByText(/only people who can see the hitlist/i)).toBeTruthy());
    expect(pill("Alpha Roofing", /^direct$/i)).toHaveAttribute("aria-pressed", "false");
  });

  it("the Line filter shows only Direct Line leads", () => {
    nav.search = "line=direct";
    mount();
    expect(screen.queryByText("Bravo Plumbing")).toBeTruthy();
    expect(screen.queryByText("Alpha Roofing")).toBeNull();
    expect(screen.queryByText("Charlie Electric")).toBeNull();
  });

  it("…or the ones not tagged yet", () => {
    nav.search = "line=__none";
    mount();
    expect(screen.queryByText("Alpha Roofing")).toBeTruthy();
    expect(screen.queryByText("Bravo Plumbing")).toBeNull();
  });

  it("the Line filter is offered on the HitList, not on Leads", () => {
    mount();
    expect(screen.getByRole("button", { name: /^line/i })).toBeTruthy();
  });

  it("on the Leads page the Line column and filter stay out of the way", () => {
    nav.path = "/leads";
    mount({ mode: "leads" });
    expect(screen.queryByRole("columnheader", { name: "Line" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^line/i })).toBeNull();
  });
});

describe("Timezone filter", () => {
  it("on the HitList: only leads whose region is in that timezone", () => {
    nav.search = "tzone=pacific";
    mount();
    expect(screen.queryByText("Bravo Plumbing")).toBeTruthy();
    expect(screen.queryByText("Alpha Roofing")).toBeNull();
    expect(screen.queryByText("Charlie Electric")).toBeNull();
  });

  it("on Leads too, and several timezones at once", () => {
    nav.path = "/leads";
    nav.search = "tzone=eastern,central";
    mount({ mode: "leads" });
    expect(screen.queryByText("Alpha Roofing")).toBeTruthy();
    expect(screen.queryByText("Charlie Electric")).toBeTruthy();
    expect(screen.queryByText("Bravo Plumbing")).toBeNull();
  });

  it("is offered on both pages, with counts", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^timezone/i }));
    expect(screen.getByText("Pacific (PT)")).toBeTruthy();
    expect(screen.getByText("Eastern (ET)")).toBeTruthy();
  });
});
