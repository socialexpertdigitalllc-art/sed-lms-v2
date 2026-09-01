import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { TicketDetail, type SiteUpdate } from "@/components/tickets/TicketDetail";
import { ToastProvider } from "@/components/common/Toast";
import type { Ticket } from "@/lib/tickets/types";

/**
 * The resolve nudge + upload proof: resolving a ticket whose lead HAS a
 * website but with no upload recorded asks first (never blocks); a recorded
 * upload resolves straight through and renders as proof.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

function ticketFixture(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "tk-1",
    lead_id: "lead-1",
    created_by: "agent-1",
    category: "Changes",
    signature: "Agent",
    priority: "Normal",
    status: "In Progress",
    assigned_to: "tech-1",
    title: "Fix the phone number",
    resolution_note: null,
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
    resolved_at: null,
    resolved_by: null,
    due_date: null,
    escalated_at: null,
    ...overrides,
  };
}

function mount(siteUpdates: SiteUpdate[]) {
  return render(
    <ToastProvider>
      <TicketDetail
        ticket={ticketFixture()}
        items={[]}
        lead={{
          id: "lead-1",
          business_name: "Green Lawn",
          agent_id: "agent-1",
          closed_by: null,
          status: "Closed",
          website_link: "https://greenlawn.dmviral.com",
        }}
        names={{ "tech-1": "Terry Tech", "agent-1": "Amy Agent" }}
        techMembers={[]}
        canAssign={false}
        canResolve={true}
        canViewAgentRuns={true}
        isCreator={false}
        siteUpdates={siteUpdates}
      />
    </ToastProvider>,
  );
}

function startResolving() {
  fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
  fireEvent.change(screen.getByPlaceholderText("Describe what was done…"), {
    target: { value: "Fixed the phone number site-wide." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm resolve" }));
}

describe("TicketDetail resolve nudge", () => {
  /** TicketDetail now mounts the AI developer panel, which fetches its own
   *  agent-runs list — the nudge's assertions are about the RESOLVE call, so
   *  count only PATCHes to the ticket itself. */
  const resolveCalls = (spy: ReturnType<typeof vi.fn>) =>
    spy.mock.calls.filter(([url]) => String(url) === "/api/tickets/tk-1");

  it("asks before resolving when no files were uploaded, and 'Resolve anyway' proceeds", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);

    mount([]);
    startResolving();

    // nudge shown, nothing sent yet
    expect(screen.getByRole("dialog", { name: "No updated files were uploaded" })).toBeInTheDocument();
    expect(resolveCalls(fetchSpy)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Resolve anyway" }));
    await waitFor(() => expect(resolveCalls(fetchSpy)).toHaveLength(1));
    const [url, init] = resolveCalls(fetchSpy)[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tickets/tk-1");
    expect(JSON.parse(String(init.body))).toMatchObject({ action: "resolve" });
  });

  it("'Go back' keeps the ticket unresolved", () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);

    mount([]);
    startResolving();
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));

    expect(screen.queryByRole("dialog", { name: "No updated files were uploaded" })).not.toBeInTheDocument();
    expect(resolveCalls(fetchSpy)).toHaveLength(0);
  });

  it("resolves straight through when an upload is recorded, and shows it as proof", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);

    mount([
      { by: "tech-1", at: "2026-08-14T12:00:00.000Z", site: "greenlawn.dmviral.com", files: 4, zipName: "fixed.zip" },
    ]);

    // proof card ("Terry Tech" also appears as the header's assignee — scope to the card)
    const card = screen.getByText("Website updates").closest("div") as HTMLElement;
    expect(within(card).getByText(/4 file\(s\)/)).toBeInTheDocument();
    expect(within(card).getByText(/Terry Tech/)).toBeInTheDocument();

    startResolving();
    expect(screen.queryByRole("dialog", { name: "No updated files were uploaded" })).not.toBeInTheDocument();
    await waitFor(() => expect(resolveCalls(fetchSpy)).toHaveLength(1));
  });
});
