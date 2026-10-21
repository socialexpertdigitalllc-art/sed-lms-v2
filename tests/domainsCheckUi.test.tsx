import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DomainChecker } from "@/components/domains/DomainChecker";
import { DomainsTabs } from "@/components/domains/DomainsTabs";

/** Check a name: sales type a name on a call and see at once whether that exact name is free. */

const nav = vi.hoisted(() => ({ path: "/domains/check" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const answer = {
  query: "ABC Construction",
  exact: { domain: "abcconstruction.com", assumedTld: true, offer: { domain: "abcconstruction.com", registrar: "cloudflare", available: false, reason: "Taken", registrationCents: null, renewalCents: null, currency: "USD" } },
  otherEndings: [{ domain: "abcconstruction.net", registrar: "cloudflare", available: true, reason: null, registrationCents: 1100, renewalCents: 1100, currency: "USD" }],
  similar: [{ domain: "abccontractor.com", registrar: "cloudflare", available: true, reason: null, registrationCents: 1044, renewalCents: 1044, currency: "USD" }],
};

describe("DomainChecker", () => {
  it("checks the typed name: the exact match on its own (taken), then other endings, then different names — read only", async () => {
    const fetchMock = vi.fn(async () => Response.json(answer));
    vi.stubGlobal("fetch", fetchMock);
    render(<DomainChecker canPurchase={false} />);
    fireEvent.change(screen.getByLabelText("Name or domain to check"), { target: { value: "ABC Construction" } });
    fireEvent.click(screen.getByRole("button", { name: /Check/ }));
    const exact = await screen.findByRole("region", { name: "Exact match" });
    expect(fetchMock).toHaveBeenCalledWith("/api/domains/check?q=ABC%20Construction&registrar=cloudflare");
    expect(exact.textContent).toMatch(/abcconstruction\.com/);
    expect(exact.textContent).toMatch(/Taken — someone already owns this name/);
    expect(exact.textContent).toMatch(/no ending typed, so \.com was checked/);
    expect(screen.getByRole("region", { name: "Same name, other endings" }).textContent).toMatch(/abcconstruction\.net/);
    const others = screen.getByRole("region", { name: "Other suggestions" });
    expect(others.querySelector("ul mark")?.textContent).toBe("tractor"); // abccon[tractor] vs abccon[struction]: what differs is marked
    // read only: nothing to pick or buy, a copy button per name
    expect(screen.queryByRole("button", { name: /Continue/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Copy / })).toHaveLength(3);
  });

  it("keeps recent searches on this device, one click to run again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(answer)));
    render(<DomainChecker canPurchase={false} />);
    fireEvent.change(screen.getByLabelText("Name or domain to check"), { target: { value: "ABC Construction" } });
    fireEvent.click(screen.getByRole("button", { name: /Check/ }));
    await screen.findByRole("region", { name: "Exact match" });
    await waitFor(() => expect(JSON.parse(localStorage.getItem("sed.domainCheck.recent") ?? "[]")).toEqual(["ABC Construction"]));
    expect(screen.getByRole("button", { name: "ABC Construction" })).toBeTruthy();
  });

  it("says why when the check fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "That's a lot of checks in a few minutes — wait a moment and try again." }, { status: 429 })));
    render(<DomainChecker canPurchase={false} />);
    fireEvent.change(screen.getByLabelText("Name or domain to check"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: /Check/ }));
    expect(await screen.findByText(/a lot of checks/)).toBeTruthy();
  });
});

describe("DomainsTabs", () => {
  it("Check a name is its own tab; All domains isn't lit on it", () => {
    nav.path = "/domains/check";
    render(<DomainsTabs />);
    expect(screen.getByRole("link", { name: /Check a name/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /All domains/ }).getAttribute("aria-current")).toBeNull();
  });
});
