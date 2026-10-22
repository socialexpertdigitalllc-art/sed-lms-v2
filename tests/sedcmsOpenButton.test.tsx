import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OpenInCmsButton } from "@/components/leads/OpenInCmsButton";
import { TicketDetail } from "@/components/tickets/TicketDetail";
import { ToastProvider } from "@/components/common/Toast";
import type { Ticket } from "@/lib/tickets/types";

/**
 * The "Open in CMS" button (launch plan L7): it asks the LMS for the CMS's
 * one-time sign-in link, then goes there. It sits beside the site-file icons
 * on the lead and ticket pages, for studio.manage or tickets.resolve.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const LEAD = "11111111-1111-4111-8111-111111111111";
const LINK = "https://cms.sedsolutions.online/api/auth/lms-sso/redeem?token=abc";

afterEach(() => vi.unstubAllGlobals());

function stubOpen(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => Response.json(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("OpenInCmsButton", () => {
  it("posts the lead's id as JSON, then follows the link it gets back", async () => {
    const fetchMock = stubOpen(200, { url: LINK });
    const navigate = vi.fn();
    render(
      <ToastProvider>
        <OpenInCmsButton leadId={LEAD} navigate={navigate} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open in CMS" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(LINK));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/sedcms/open");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ leadId: LEAD });
  });

  it("shows the LMS's message, the developer's id included, and goes nowhere", async () => {
    const message = "Ask Aqib to link your LMS account (your LMS id: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa)";
    stubOpen(403, { code: "UNKNOWN_DEVELOPER", error: message });
    const navigate = vi.fn();
    render(
      <ToastProvider>
        <OpenInCmsButton leadId={LEAD} navigate={navigate} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open in CMS" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("never follows a link that isn't http(s)", async () => {
    stubOpen(200, { url: "javascript:alert(1)" });
    const navigate = vi.fn();
    render(
      <ToastProvider>
        <OpenInCmsButton leadId={LEAD} navigate={navigate} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open in CMS" }));
    expect(await screen.findByText("Couldn't open the CMS")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("where the button shows", () => {
  const ticket: Ticket = {
    id: "tk-1",
    lead_id: LEAD,
    created_by: null,
    category: "Changes",
    signature: "Agent",
    priority: "Normal",
    status: "Open",
    assigned_to: null,
    title: "Fix the phone number",
    resolution_note: null,
    created_at: "2026-10-23T00:00:00.000Z",
    updated_at: "2026-10-23T00:00:00.000Z",
    resolved_at: null,
    resolved_by: null,
    due_date: null,
    escalated_at: null,
  };

  function ticketPage(canViewAgentRuns: boolean, website_link: string | null) {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ runs: [] })));
    return render(
      <ToastProvider>
        <TicketDetail
          ticket={ticket}
          items={[]}
          lead={{ id: LEAD, business_name: "Acme", agent_id: null, closed_by: null, status: "Closed", website_link }}
          names={{}}
          techMembers={[]}
          canAssign={false}
          canResolve={false}
          canViewAgentRuns={canViewAgentRuns}
          isCreator={false}
        />
      </ToastProvider>,
    );
  }

  it("on a ticket: with studio.manage or tickets.resolve, when the lead has a website", () => {
    ticketPage(true, "https://acme.dmviral.com").unmount();
    ticketPage(true, "https://acme.dmviral.com");
    expect(screen.getByRole("button", { name: "Open in CMS" })).toBeInTheDocument();
  });

  it("on a ticket: not without the permission, nor without a website", () => {
    const a = ticketPage(false, "https://acme.dmviral.com");
    expect(screen.queryByRole("button", { name: "Open in CMS" })).toBeNull();
    a.unmount();
    ticketPage(true, null);
    expect(screen.queryByRole("button", { name: "Open in CMS" })).toBeNull();
  });

  it("on a lead: beside the site-file icons, inside the studio.manage / tickets.resolve gate", () => {
    const src = readFileSync("components/leads/LeadDetail.tsx", "utf8");
    expect(src).toContain('const canSiteAgent = has("tickets.resolve") || has("studio.manage");');
    const display = src.slice(src.indexOf('label="Website link"'), src.indexOf('label="Logo link"'));
    const gate = display.indexOf("{canSiteAgent && (");
    const button = display.indexOf("<OpenInCmsButton leadId={lead.id}");
    expect(gate).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(gate);
    expect(display.indexOf("lead.website_link ? (")).toBeLessThan(gate);
  });
});
