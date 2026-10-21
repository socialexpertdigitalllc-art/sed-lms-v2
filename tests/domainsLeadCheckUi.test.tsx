import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/common/Toast";
import { LeadDomainCard } from "@/components/domains/LeadDomainCard";
import type { LeadDomainCheck } from "@/lib/domains/leadCheck";

/**
 * Before a lead has a domain, its Domain card says whether the business's
 * exact name is free as a .com — even with the card collapsed.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());

const check = (over: Partial<LeadDomainCheck> = {}): LeadDomainCheck => ({
  lead_id: "L1",
  domain: "acmeroofing.com",
  available: true,
  reason: null,
  registration_cents: 1044,
  renewal_cents: 1044,
  currency: "USD",
  registrar: "cloudflare",
  error: null,
  checked_at: new Date().toISOString(),
  ...over,
});

const card = (over: Partial<Parameters<typeof LeadDomainCard>[0]> = {}) => (
  <ToastProvider>
    <LeadDomainCard leadId="L1" leadName="Acme Roofing" initial={null} suggestedQuery="acme roofing" canPurchase={false} canManage={false} sandbox={false} exactDomain="acmeroofing.com" exactCheck={check()} leadReady {...over} />
  </ToastProvider>
);

describe("LeadDomainCard — exact name", () => {
  it("the collapsed summary already says it: available with the price, or taken", () => {
    const { unmount } = render(card());
    expect(screen.getByText(/no domain yet · acmeroofing\.com available/)).toBeTruthy();
    unmount();
    render(card({ exactCheck: check({ available: false, reason: "Taken" }) }));
    expect(screen.getByText(/acmeroofing\.com taken/)).toBeTruthy();
  });

  it("opened: the name, the verdict, the price and 'Check again', which asks now", async () => {
    const fetchMock = vi.fn(async () => Response.json({ check: check({ available: false, reason: "Taken" }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(card());
    fireEvent.click(screen.getByText("Domain"));
    const box = await screen.findByTestId("exact-name-check");
    expect(box.textContent).toMatch(/acmeroofing\.com/);
    expect(box.textContent).toMatch(/Available/);
    expect(box.textContent).toMatch(/\$10\.44 first year/);
    fireEvent.click(screen.getByRole("button", { name: /Check again/ }));
    await waitFor(() => expect(box.textContent).toMatch(/Taken/));
    expect(fetchMock).toHaveBeenCalledWith("/api/leads/L1/domain-check", { method: "POST" });
  });

  it("a Ready lead with no answer yet waits for the check that's on its way", async () => {
    render(card({ exactCheck: null }));
    fireEvent.click(screen.getByText("Domain"));
    expect((await screen.findByTestId("exact-name-check")).textContent).toMatch(/Checking…/);
  });

  it("not Ready yet: says when it will be checked, and offers to check now", async () => {
    render(card({ exactCheck: null, leadReady: false }));
    fireEvent.click(screen.getByText("Domain"));
    const box = await screen.findByTestId("exact-name-check");
    expect(box.textContent).toMatch(/Checked automatically when the lead is Ready/);
    expect(screen.getByRole("button", { name: /Check now/ })).toBeTruthy();
  });
});
