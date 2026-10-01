import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/common/Toast";
import { DomainDetailView } from "@/components/domains/DomainDetail";
import { DomainAnalyticsView } from "@/components/domains/DomainAnalytics";
import { computeDomainAnalytics, type AnalyticsRow } from "@/lib/domains/analytics";
import type { DomainDetail } from "@/lib/domains/detail";
import type { ClientDomainRow } from "@/lib/domains/types";

/**
 * The domain page manages the domain end to end — renew (with the price stated
 * first), auto-renew, DNS, registrar settings — and says plainly what the
 * registrar's API can't do. The analytics page turns the rows into figures.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), back: vi.fn() }), usePathname: () => "/domains" }));
beforeAll(() => {
  // Recharts' ResponsiveContainer measures itself; jsdom has no ResizeObserver
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

const row = (over: Partial<ClientDomainRow> = {}): ClientDomainRow & { leads: { business_name: string } | null } => ({
  id: "11111111-1111-1111-1111-111111111111",
  domain: "acme.com",
  registrar: "hostinger",
  origin: "imported",
  lead_id: "lead-1",
  status: "connected",
  step: null,
  steps: {},
  last_error: null,
  next_run_at: null,
  claim_id: null,
  claimed_at: null,
  attempts: 0,
  cf_zone_id: null,
  hosting_username: "u447231526",
  hostinger_order_id: null,
  hostinger_subscription_id: "sub-1",
  registration_cost_cents: null,
  renewal_cost_cents: 2019,
  currency: "USD",
  auto_renew: false,
  expires_at: inDays(6),
  purchased_by: null,
  purchased_at: null,
  created_by: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  registrar_status: "active",
  registered_at: "2025-10-08T00:00:00Z",
  next_billing_at: null,
  synced_at: null,
  details: { subscription_status: "non_renewing" },
  health_state: "up",
  health: {
    state: "up",
    summary: "Up — answered in 420 ms",
    http_status: 200,
    final_url: "https://acme.com/",
    ms: 420,
    ssl: { valid: true, valid_to: inDays(80), issuer: "Let's Encrypt", error: null },
    dns: { apex: ["76.13.203.71"], www: ["76.13.203.71"] },
    consecutive_failures: 0,
    since: inDays(-3),
  },
  health_checked_at: inDays(0),
  leads: { business_name: "Acme Roofing" },
  ...over,
});

const detail = (over: Partial<ClientDomainRow> = {}): DomainDetail => ({
  domain: row(over),
  activity: [{ id: "a1", action: "domain.dns_changed", at: inDays(-1), by: "Admin", value: { change: "added", after: { type: "TXT", name: "@", content: "v=spf1" } } }],
  checks: [
    { at: inDays(-1), state: "up", http_status: 200, ms: 400, error: null },
    { at: inDays(0), state: "up", http_status: 200, ms: 420, error: null },
  ],
  uptime30: 100,
  avgMs30: 410,
});

const SETTINGS = {
  registrar: "hostinger",
  locked: true,
  lockable: true,
  privacy: true,
  privacyAllowed: true,
  nameservers: ["ns1.dns-parking.com", "ns2.dns-parking.com"],
  nameserversEditable: true,
  forwarding: null,
  forwardingSupported: true,
  move: null,
  moveSupported: true,
  authCodeSupported: true,
  renewSupported: true,
  dashboardUrl: "https://hpanel.hostinger.com/domains",
  message: null,
};

function stubApi(calls: { url: string; method: string; body?: unknown }[], settings: Record<string, unknown> = SETTINGS) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/dns") && method === "GET") {
        return Response.json({
          ok: true,
          dns: {
            rows: [{ id: "ALIAS|@|acme.com.cdn.hstgr.net.", type: "ALIAS", name: "@", content: "acme.com.cdn.hstgr.net.", raw: "acme.com.cdn.hstgr.net.", ttl: 300, priority: null, proxied: null, editable: true }],
            supportsReset: true,
            supportsSnapshots: true,
            supportsProxy: false,
          },
        });
      }
      if (url.endsWith("/registrar")) return Response.json({ ok: true, settings });
      if (url.endsWith("/renew")) return Response.json({ ok: true, pending: false, totalCents: 2019 });
      if (url === "/api/domains/sync") return Response.json({ added: 0, refreshed: 1 });
      if (url.startsWith("/api/domains/")) return Response.json(detail({ expires_at: inDays(371) }));
      throw new Error(`unexpected ${method} ${url}`);
    }),
  );
}

describe("DomainDetailView", () => {
  it("shows renewal, health, DNS and registrar settings — and renews only after stating the price", async () => {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    stubApi(calls);
    render(
      <ToastProvider>
        <DomainDetailView initial={detail()} canManage canPurchase />
      </ToastProvider>,
    );
    expect(screen.getByRole("heading", { name: /acme\.com/ })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Auto-renew" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("$20.19 / year")).toBeInTheDocument();
    expect(screen.getByText("Up — answered in 420 ms")).toBeInTheDocument();
    expect(screen.getByText("100% up")).toBeInTheDocument();
    expect(await screen.findByText("acme.com.cdn.hstgr.net.")).toBeInTheDocument();
    expect(await screen.findByText("Transfer lock")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Get transfer code/ })).toBeInTheDocument();
    expect(screen.getByText(/DNS record added: TXT @ → v=spf1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Renew a year now" }));
    expect(calls.some((c) => c.url.endsWith("/renew"))).toBe(false); // not before confirming
    fireEvent.click(await screen.findByRole("button", { name: "Renew for $20.19" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/renew") && c.method === "POST")).toBe(true));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/domains/sync")).toBe(true));
  });

  it("a Cloudflare domain links to Cloudflare for what its API can't do", async () => {
    stubApi([], { ...SETTINGS, registrar: "cloudflare", nameserversEditable: false, forwardingSupported: false, moveSupported: false, authCodeSupported: false, renewSupported: false, dashboardUrl: "https://dash.cloudflare.com/?to=/:account/registrar/domains" });
    render(
      <ToastProvider>
        <DomainDetailView initial={detail({ registrar: "cloudflare", hostinger_subscription_id: null, renewal_cost_cents: 1046 })} canManage canPurchase />
      </ToastProvider>,
    );
    expect(screen.getByRole("link", { name: /Renew in Cloudflare/ })).toHaveAttribute("href", expect.stringContaining("dash.cloudflare.com"));
    expect(screen.queryByRole("button", { name: /Renew a year now/ })).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Get it in Cloudflare/ })).toBeInTheDocument();
  });

  it("an expired domain says so and offers the renewal up front", () => {
    stubApi([]);
    render(
      <ToastProvider>
        <DomainDetailView initial={detail({ registrar_status: "expired", expires_at: inDays(-9) })} canManage canPurchase />
      </ToastProvider>,
    );
    expect(screen.getByText(/This domain expired/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Renew now" })).toBeInTheDocument();
  });

  it("without the buy permission there is no renew button", () => {
    stubApi([]);
    render(
      <ToastProvider>
        <DomainDetailView initial={detail()} canManage canPurchase={false} />
      </ToastProvider>,
    );
    expect(screen.queryByRole("button", { name: /Renew/ })).not.toBeInTheDocument();
  });
});

describe("DomainAnalyticsView", () => {
  it("renders the headline figures and the action list", () => {
    const rows = [
      row({ id: "a", domain: "a.com" }) as AnalyticsRow,
      row({ id: "b", domain: "b.com", auto_renew: true, registrar: "cloudflare", renewal_cost_cents: 1046, expires_at: inDays(200) }) as AnalyticsRow,
    ];
    const data = computeDomainAnalytics(rows, [], [], new Date());
    render(<DomainAnalyticsView data={data} />);
    expect(screen.getByText("Domain analytics")).toBeInTheDocument();
    expect(screen.getByText("1 Hostinger · 1 Cloudflare")).toBeInTheDocument();
    expect(screen.getByText("Renewing automatically")).toBeInTheDocument();
    // a.com expires in 6 days with auto-renew off → the top action
    expect(screen.getByRole("link", { name: "a.com" })).toHaveAttribute("href", "/domains/a");
    expect(screen.getByText(/Expires in 6 days — auto-renew is off/)).toBeInTheDocument();
  });
});
