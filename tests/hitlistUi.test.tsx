import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import type { Lead } from "@/lib/leads/types";

const perms = vi.hoisted(() => ({ set: new Set<string>() }));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ has: (k: string) => perms.set.has(k), hasAny: (ks: string[]) => ks.some((k) => perms.set.has(k)), all: perms.set }),
}));
vi.mock("@/hooks/useRealtimeRefresh", () => ({ useRealtimeRefresh: () => {} }));
vi.mock("@/providers/UiPrefsProvider", () => ({
  useUiPrefs: () => ({ density: "comfortable", columns: {}, setTableColumns: () => {} }),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }));
const nav = vi.hoisted(() => ({ path: "/leads" }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => nav.path,
  useSearchParams: () => new URLSearchParams(),
}));

import { LeadsTable } from "@/components/leads/LeadsTable";
import { ToastProvider } from "@/components/common/Toast";

const lead = (id: string, name: string, created: string): Lead =>
  ({
    id, business_name: name, business_email: null, business_phone: null, status: "Ready", agent_id: null,
    created_at: created, updated_at: created, site_type: null, platform: null, last_followup_status: null,
    no_pickup_streak: 0, follow_up_time: null, rating: null, price_quoted: null, website_link: null, tag_ids: [],
  }) as unknown as Lead;

const LEADS = [
  lead("a", "Alpha Roofing", "2026-10-20T10:00:00Z"),
  lead("b", "Bravo Plumbing", "2026-10-19T10:00:00Z"),
  lead("c", "Charlie Electric", "2026-10-18T10:00:00Z"),
];

const ADMIN = ["leads.view", "leads.cat_view.ready", "hitlist.view", "hitlist.manage"];
const CLOSER = ["leads.view", "leads.cat_view.ready", "hitlist.view"];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sessionStorage.clear();
  nav.path = "/leads";
  fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.startsWith("/api/me/views")) return new Response(JSON.stringify({ views: [] }));
    return new Response(JSON.stringify({ ok: true }));
  });
  vi.stubGlobal("fetch", fetchMock);
});

function mount(p: { perms: string[]; hitlist?: Record<string, number>; canManage?: boolean; mode?: "leads" | "hitlist" }) {
  perms.set = new Set(p.perms);
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
        hitlist={p.hitlist}
        canManageHitlist={p.canManage}
        mode={p.mode}
      />
    </ToastProvider>,
  );
}

const rowOf = (name: string) => screen.getByText(name).closest("tr")!;
const hitCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith("/api/hitlist/"));

describe("HitList star — admin", () => {
  it("an empty star opens the 5-star popup at once, with no request", () => {
    mount({ perms: ADMIN, hitlist: {}, canManage: true });
    fireEvent.click(within(rowOf("Alpha Roofing")).getByRole("button", { name: /add alpha roofing to the hit list/i }));
    const pop = screen.getByTestId("hit-popover");
    expect(within(pop).getAllByRole("radio")).toHaveLength(5);
    expect(hitCalls()).toHaveLength(0);
  });

  it("one click on a star adds the lead: golden at once, saved behind it", async () => {
    mount({ perms: ADMIN, hitlist: {}, canManage: true });
    fireEvent.click(within(rowOf("Alpha Roofing")).getByRole("button", { name: /add alpha roofing/i }));
    fireEvent.click(within(screen.getByTestId("hit-popover")).getByRole("radio", { name: "4 stars" }));
    expect(screen.queryByTestId("hit-popover")).toBeNull();
    const star = within(rowOf("Alpha Roofing")).getByRole("button", { name: /remove alpha roofing from the hit list/i });
    expect(star).toHaveAttribute("aria-pressed", "true");
    expect(star.textContent).toContain("4");
    await waitFor(() => expect(hitCalls()).toHaveLength(1));
    const [url, init] = hitCalls()[0];
    expect(url).toBe("/api/hitlist/a");
    expect(init).toMatchObject({ method: "PUT", body: JSON.stringify({ priority: 4 }) });
  });

  it("keys 1–5 pick in the popup; Esc closes it without adding", async () => {
    mount({ perms: ADMIN, hitlist: {}, canManage: true });
    fireEvent.click(within(rowOf("Bravo Plumbing")).getByRole("button", { name: /add bravo/i }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("hit-popover")).toBeNull();
    expect(hitCalls()).toHaveLength(0);
    fireEvent.click(within(rowOf("Bravo Plumbing")).getByRole("button", { name: /add bravo/i }));
    fireEvent.keyDown(window, { key: "5" });
    await waitFor(() => expect(hitCalls()).toHaveLength(1));
    expect(hitCalls()[0][1]).toMatchObject({ method: "PUT", body: JSON.stringify({ priority: 5 }) });
  });

  it("a click on the golden star removes the lead in one click", async () => {
    mount({ perms: ADMIN, hitlist: { b: 3 }, canManage: true });
    fireEvent.click(within(rowOf("Bravo Plumbing")).getByRole("button", { name: /remove bravo plumbing/i }));
    expect(within(rowOf("Bravo Plumbing")).getByRole("button", { name: /add bravo plumbing/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("hit-popover")).toBeNull();
    await waitFor(() => expect(hitCalls()).toHaveLength(1));
    expect(hitCalls()[0]).toEqual(["/api/hitlist/b", { method: "DELETE" }]);
  });

  it("a failed save puts the star back and says why", async () => {
    fetchMock.mockImplementation(async (url: RequestInfo | URL) =>
      String(url).startsWith("/api/hitlist/")
        ? new Response(JSON.stringify({ error: "Only admins can change the hit list." }), { status: 403 })
        : new Response(JSON.stringify({ views: [] })),
    );
    mount({ perms: ADMIN, hitlist: {}, canManage: true });
    fireEvent.click(within(rowOf("Alpha Roofing")).getByRole("button", { name: /add alpha roofing/i }));
    fireEvent.click(within(screen.getByTestId("hit-popover")).getByRole("radio", { name: "2 stars" }));
    await waitFor(() =>
      expect(within(rowOf("Alpha Roofing")).getByRole("button", { name: /add alpha roofing/i })).toHaveAttribute("aria-pressed", "false"),
    );
    expect(await screen.findByText("Only admins can change the hit list.")).toBeTruthy();
  });
});

describe("HitList star — closer and others", () => {
  it("a closer sees the golden star, read-only, and no empty stars", () => {
    mount({ perms: CLOSER, hitlist: { c: 5 }, canManage: false });
    const stars = screen.getAllByTestId("hit-star");
    expect(stars).toHaveLength(1);
    expect(within(rowOf("Charlie Electric")).getByTestId("hit-star").tagName).toBe("SPAN");
    expect(within(rowOf("Charlie Electric")).getByLabelText(/on the hit list, 5 stars/i)).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /^(add|remove) .* hit list$/i })).toHaveLength(0);
    // …but the hit-list filter is there for them.
    expect(screen.getByRole("button", { name: /^hit list/i })).toBeTruthy();
  });

  it("without hitlist.view there is no star and no hit-list filter", () => {
    mount({ perms: ["leads.view", "leads.cat_view.ready"], hitlist: undefined });
    expect(screen.queryAllByTestId("hit-star")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /hit list/i })).toBeNull();
    expect(screen.queryByRole("option", { name: "Hit list priority" })).toBeNull();
  });

  it("with hitlist.view the sort offers hit-list priority", () => {
    mount({ perms: CLOSER, hitlist: {}, canManage: false });
    expect(screen.getByRole("option", { name: "Hit list priority" })).toBeTruthy();
  });
});

describe("Hit list filter on Leads", () => {
  const names = () => screen.getAllByRole("row").slice(1).map((r) => (r.textContent ?? "").match(/Alpha Roofing|Bravo Plumbing|Charlie Electric/)?.[0]);
  const pick = (label: RegExp) => fireEvent.click(screen.getByRole("checkbox", { name: label }));

  it("All hit list shows every starred lead; a star level narrows it", () => {
    mount({ perms: ADMIN, hitlist: { a: 5, c: 3 }, canManage: true });
    expect(names()).toEqual(["Alpha Roofing", "Bravo Plumbing", "Charlie Electric"]);
    fireEvent.click(screen.getByRole("button", { name: /^hit list/i }));
    pick(/all hit list/i);
    expect(names()).toEqual(["Alpha Roofing", "Charlie Electric"]);
    pick(/all hit list/i);
    pick(/^★★★☆☆/);
    expect(names()).toEqual(["Charlie Electric"]);
    pick(/^★★★★★/);
    expect(names()).toEqual(["Alpha Roofing", "Charlie Electric"]);
  });

  it("sorting by hit-list priority puts the most stars first", () => {
    mount({ perms: ADMIN, hitlist: { b: 1, c: 4 }, canManage: true });
    fireEvent.change(screen.getByDisplayValue("Submitted date"), { target: { value: "hitlist:desc" } });
    expect(names()).toEqual(["Charlie Electric", "Bravo Plumbing", "Alpha Roofing"]);
  });
});

describe("HitList tab", () => {
  it("shows only hit-listed leads, highest priority first, with a Priority column", () => {
    nav.path = "/hitlist";
    mount({ perms: ADMIN, hitlist: { c: 5, a: 2 }, canManage: true, mode: "hitlist" });
    expect(screen.getByRole("heading", { name: /hitlist/i })).toBeTruthy();
    expect(screen.queryByText("Bravo Plumbing")).toBeNull();
    const names = screen.getAllByRole("row").slice(1).map((r) => (r.textContent ?? "").match(/Alpha Roofing|Charlie Electric/)?.[0]);
    expect(names).toEqual(["Charlie Electric", "Alpha Roofing"]);
    expect(screen.getByText("Priority")).toBeTruthy();
  });

  it("un-starring a lead there takes its row off at once", async () => {
    nav.path = "/hitlist";
    mount({ perms: ADMIN, hitlist: { c: 5, a: 2 }, canManage: true, mode: "hitlist" });
    fireEvent.click(within(rowOf("Alpha Roofing")).getByRole("button", { name: /remove alpha roofing/i }));
    expect(screen.queryByText("Alpha Roofing")).toBeNull();
    await waitFor(() => expect(hitCalls()).toHaveLength(1));
  });

  it("an admin re-rates from the Priority column in one click", async () => {
    nav.path = "/hitlist";
    mount({ perms: ADMIN, hitlist: { a: 2 }, canManage: true, mode: "hitlist" });
    const group = within(rowOf("Alpha Roofing")).getByRole("radiogroup", { name: "Priority" });
    await act(async () => fireEvent.click(within(group).getByRole("radio", { name: "5 stars" })));
    expect(within(rowOf("Alpha Roofing")).getByTestId("hit-star").textContent).toContain("5");
    await waitFor(() => expect(hitCalls()[0]).toEqual(["/api/hitlist/a", expect.objectContaining({ method: "PUT", body: JSON.stringify({ priority: 5 }) })]));
  });

  it("an empty hit list says how to add to it", () => {
    nav.path = "/hitlist";
    mount({ perms: ADMIN, hitlist: {}, canManage: true, mode: "hitlist" });
    expect(screen.getByText("The hit list is empty")).toBeTruthy();
  });
});
