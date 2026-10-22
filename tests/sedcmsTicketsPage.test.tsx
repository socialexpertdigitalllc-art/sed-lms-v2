import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TicketDetail } from "@/components/tickets/TicketDetail";
import { ToastProvider } from "@/components/common/Toast";
import type { Ticket, TicketItem } from "@/lib/tickets/types";

/**
 * A change request from SED CMS stores the client's text as given (launch
 * plan L6). The ticket page must show it as text, never as markup.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const hostile = '<script>window.__pwned = 1</script><img src="x" onerror="window.__pwned = 2">';

const ticket: Ticket = {
  id: "tk-1",
  lead_id: "lead-1",
  created_by: null,
  category: "Changes",
  signature: "Agent",
  priority: "Normal",
  status: "Open",
  assigned_to: null,
  title: "Change request from Acme Roofing (SED CMS)",
  resolution_note: null,
  created_at: "2026-10-23T00:00:00.000Z",
  updated_at: "2026-10-23T00:00:00.000Z",
  resolved_at: null,
  resolved_by: null,
  due_date: null,
  escalated_at: null,
};

const item = (id: string, body: string, sort: number) =>
  ({ id, ticket_id: "tk-1", body, is_done: false, done_at: null, done_by: null, sort, created_at: "2026-10-23T00:00:00.000Z", attachments: [] }) as unknown as TicketItem;

describe("a CMS change request on the ticket page", () => {
  it("shows the client's text as text: no script runs, no element is made", () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ runs: [] })));
    const { container } = render(
      <ToastProvider>
        <TicketDetail
          ticket={ticket}
          items={[item("i1", hostile, 0), item("i2", "Plain request", 1)]}
          lead={{ id: "lead-1", business_name: "Acme Roofing", agent_id: null, closed_by: null, status: "Closed", website_link: null }}
          names={{}}
          techMembers={[]}
          canAssign={false}
          canResolve={false}
          canViewAgentRuns={false}
          isCreator={false}
        />
      </ToastProvider>,
    );
    expect(screen.getByText(hostile)).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
