import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const live = vi.hoisted(() => ({ leads: [] as Record<string, unknown>[] }));
vi.mock("@/hooks/useLiveLeads", () => ({
  useLiveLeads: () => ({ status: "ready", leads: live.leads, error: null, fromCache: false, retry: () => {} }),
  syncLeadsNow: () => {},
}));

const router = vi.hoisted(() => ({ prefetch: vi.fn(), push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/by-agent", useSearchParams: () => new URLSearchParams() }));

import { ByAgentBoard } from "@/components/leads/ByAgentBoard";

const lead = (id: string, agent: string | null, status: string, price: number) => ({
  id,
  agent_id: agent,
  business_name: `Biz ${id}`,
  status,
  price_quoted: price,
  created_at: "2026-11-05T10:00:00Z",
});

describe("By Agent on the live leads copy", () => {
  it("groups the live leads by owner, busiest first, with totals", () => {
    live.leads = [lead("1", "a", "Ready", 500), lead("2", "a", "Closed", 1500), lead("3", "b", "Ready", 0), lead("4", null, "Ready", 0)];
    render(<ByAgentBoard nameById={{ a: "Asha", b: "Bilal" }} />);
    const names = screen.getAllByText(/^(Asha|Bilal|Unassigned)$/).map((n) => n.textContent);
    expect(names[0]).toBe("Asha");
    expect(screen.getByText("2 leads")).toBeTruthy();
    expect(screen.getAllByText("1 lead")).toHaveLength(2);
    expect(screen.getByText("Biz 2").closest("a")?.getAttribute("href")).toBe("/leads/2");
  });

  it("says so when there are no leads", () => {
    live.leads = [];
    render(<ByAgentBoard nameById={{}} />);
    expect(screen.getByText("No leads yet.")).toBeTruthy();
  });
});
