import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/common/Toast";
import { BuyDomainDialog } from "@/components/domains/BuyDomainDialog";
import { LeadDomainCard } from "@/components/domains/LeadDomainCard";
import { DomainsBoard } from "@/components/domains/DomainsBoard";
import type { ClientDomainRow } from "@/lib/domains/types";

/**
 * The buying screen asks twice on purpose: pick, then confirm the exact
 * first-year and renewal price — and it sends that confirmed price, so the
 * server can refuse if it moved. The lead card shows the live checklist.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());

const offers = [
  { domain: "acmeroofing.com", registrar: "cloudflare", available: true, reason: null, registrationCents: 1046, renewalCents: 1046, currency: "USD" },
  { domain: "acmeroofing.net", registrar: "cloudflare", available: false, reason: "Taken", registrationCents: null, renewalCents: null, currency: "USD" },
];

describe("BuyDomainDialog", () => {
  it("searches from the lead's name, then confirms the exact price before buying", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url.startsWith("/api/domains/search")) return Response.json({ results: offers });
        if (url === "/api/domains/purchase") return Response.json({ domain: { id: "d1", domain: "acmeroofing.com", status: "purchasing" } });
        throw new Error(`unexpected ${url}`);
      }),
    );
    const onBought = vi.fn();
    render(
      <ToastProvider>
        <BuyDomainDialog leadId="lead-1" leadName="Acme Roofing" initialQuery="acme roofing" sandbox={false} onClose={() => {}} onBought={onBought} />
      </ToastProvider>,
    );

    await screen.findByText("acmeroofing.com");
    expect(calls[0].url).toBe("/api/domains/search?q=acme%20roofing&registrar=cloudflare");
    // a taken name can't be picked
    expect(screen.getByText("acmeroofing.net").closest("button")).toBeDisabled();

    fireEvent.click(screen.getByText("acmeroofing.com"));
    fireEvent.click(screen.getByRole("button", { name: /Continue with acmeroofing.com/ }));
    // confirmation shows both prices and the refund warning
    expect(screen.getByText("$10.46 / year, automatically")).toBeInTheDocument();
    expect(screen.getByText(/can't be refunded/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Buy for $10.46" }));
    await waitFor(() => expect(onBought).toHaveBeenCalled());
    expect(calls.find((c) => c.url === "/api/domains/purchase")?.body).toEqual({
      domain: "acmeroofing.com",
      registrar: "cloudflare",
      leadId: "lead-1",
      expectedCents: 1046,
    });
  });

  it("switching to Hostinger searches Hostinger", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (urls.push(url), Response.json({ results: [] }))));
    render(
      <ToastProvider>
        <BuyDomainDialog leadId={null} leadName={null} initialQuery="acme" sandbox={false} onClose={() => {}} onBought={() => {}} />
      </ToastProvider>,
    );
    await waitFor(() => expect(urls).toHaveLength(1));
    fireEvent.click(screen.getByText("Hostinger"));
    await waitFor(() => expect(urls[1]).toBe("/api/domains/search?q=acme&registrar=hostinger"));
  });
});

const row = (over: Partial<ClientDomainRow> = {}): ClientDomainRow => ({
  id: "d1", domain: "acmeroofing.com", registrar: "cloudflare", origin: "purchased", lead_id: "lead-1",
  status: "setting_up", step: "dns",
  steps: {
    registration: { state: "done", at: "2026-10-02T00:00:00Z", detail: "Registered on Cloudflare" },
    zone: { state: "done", at: "2026-10-02T00:00:00Z", detail: "Cloudflare zone active" },
    hosting: { state: "done", at: "2026-10-02T00:00:00Z", detail: "Hosting created on Hostinger" },
    dns: { state: "running", at: "2026-10-02T00:00:00Z" },
  },
  last_error: null, next_run_at: null, claim_id: null, claimed_at: null, attempts: 0, cf_zone_id: "z1",
  hosting_username: "u447231526", hostinger_order_id: null, hostinger_subscription_id: null,
  registration_cost_cents: 1046, renewal_cost_cents: 1046, currency: "USD", auto_renew: true,
  expires_at: "2027-10-02T00:00:00Z", purchased_by: "u1", purchased_at: null, created_by: "u1",
  created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", ...over,
});

describe("LeadDomainCard", () => {
  it("shows the live checklist while the domain is being set up", () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ domains: [row()] })));
    render(
      <ToastProvider>
        <LeadDomainCard leadId="lead-1" leadName="Acme" initial={row()} suggestedQuery="acme" canPurchase canManage sandbox={false} />
      </ToastProvider>,
    );
    for (const label of ["Registration", "DNS zone", "Hosting", "DNS records", "SSL certificate", "Website live"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Hosting created on Hostinger")).toBeInTheDocument();
  });

  it("a stopped setup shows the reason and a Retry", () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ domains: [] })));
    render(
      <ToastProvider>
        <LeadDomainCard
          leadId="lead-1"
          leadName="Acme"
          initial={row({ status: "needs_attention", last_error: "Could not create A acmeroofing.com: zone locked" })}
          suggestedQuery="acme"
          canPurchase
          canManage
          sandbox={false}
        />
      </ToastProvider>,
    );
    expect(screen.getByText("Could not create A acmeroofing.com: zone locked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });

  it("no domain: admins get Buy and Ours", () => {
    render(
      <ToastProvider>
        <LeadDomainCard leadId="lead-1" leadName="Acme" initial={null} suggestedQuery="acme" canPurchase canManage sandbox={false} />
      </ToastProvider>,
    );
    expect(screen.getByRole("button", { name: /Buy/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ours/ })).toBeInTheDocument();
  });
});

describe("DomainsBoard", () => {
  it("one Import button brings in both registrars and says what came from where", async () => {
    const posts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/domains/import" && init?.method === "POST") {
          posts.push(url);
          return Response.json({
            hostinger: { added: 90 }, cloudflare: { added: 0 },
            added: 90, connected: 88, unassigned: 2, linked: 3, refreshed: 16, skipped: 0,
          });
        }
        if (url === "/api/domains") {
          return Response.json({
            domains: [row({ status: "connected", lead_id: null, steps: {} })],
            canManage: true, canPurchase: false, sandbox: false, cloudflareConfigured: true, hostingerConfigured: true,
          });
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    render(
      <ToastProvider>
        <DomainsBoard />
      </ToastProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Import domains/ }));
    expect(await screen.findByText("Imported 90 new domains (90 from Hostinger, 0 from Cloudflare)")).toBeInTheDocument();
    expect(posts).toHaveLength(1);
  });

  it("flags a domain expiring soon unless auto-renew is known to be on", async () => {
    const soon = new Date(Date.now() + 6 * 86_400_000).toISOString();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          domains: [
            // Hostinger doesn't report auto-renew: unknown -> flagged
            row({ id: "h1", domain: "lapsing.com", registrar: "hostinger", status: "connected", auto_renew: null, expires_at: soon, steps: {} }),
            row({ id: "c1", domain: "renewing.com", status: "connected", auto_renew: true, expires_at: soon, steps: {} }),
          ],
          canManage: true, canPurchase: false, sandbox: false, cloudflareConfigured: true, hostingerConfigured: true,
        }),
      ),
    );
    render(
      <ToastProvider>
        <DomainsBoard />
      </ToastProvider>,
    );
    expect(await screen.findByText(/1 domain expires within 30 days/)).toBeInTheDocument();
    expect(screen.getAllByText("in 6d")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Expiring soon" }));
    expect(screen.getByText("lapsing.com")).toBeInTheDocument();
    expect(screen.queryByText("renewing.com")).not.toBeInTheDocument();
  });
});
