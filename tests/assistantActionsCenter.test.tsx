import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActionCard } from "@/lib/assistant/actions/card";
import { ActionsCenter } from "@/components/assistant/ActionsCenter";

/**
 * The Approvals tab: an approver runs someone else's request as themselves —
 * so a high-impact one asks them for its name typed out, as it asked the
 * requester, and their own requests wait for another approver.
 */

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

type Row = ActionCard & { conversationId: string | null; source: string; requester: { id: string; name: string }; approver: null; executedAt: null };

const row = (over: Partial<Row>): Row => ({
  id: "r1",
  key: "domain.buy",
  title: "Buy jumbospizza.com",
  group: "Websites & domains",
  risk: "critical",
  status: "awaiting_approval",
  confirmLabel: "Buy domain",
  fields: [],
  confirmPhrase: "jumbospizza.com",
  approval: { reason: "Your account doesn't have “Buy Domains”.", note: "Customer paid" },
  createdAt: "2026-10-14T10:00:00Z",
  conversationId: null,
  source: "chat",
  requester: { id: "sam", name: "Sam" },
  approver: null,
  executedAt: null,
  ...over,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("Approvals", () => {
  it("asks the approver to type a high-impact change's name, and sends it", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (url.startsWith("/api/assistant/actions?scope=approvals")) {
        return json({ actions: [row({}), row({ id: "r2", title: "Turn off Lead imports", risk: "standard", confirmPhrase: undefined, requester: { id: "boss", name: "Boss" } })], nextBefore: null });
      }
      if (url === "/api/assistant/actions/r1/decide") return json({ card: { ...row({}), status: "done", result: { message: "Bought jumbospizza.com." } } });
      return json({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ActionsCenter userId="boss" canAct={false} canManage initialTab="approvals" />);

    expect(await screen.findByText("Buy jumbospizza.com")).toBeInTheDocument();
    // Their own request: no Approve for them.
    expect(screen.getByText(/your own request — another admin has to approve it/)).toBeInTheDocument();
    const approve = screen.getAllByRole("button", { name: /Approve & run as me/ });
    expect(approve).toHaveLength(1);
    expect(approve[0]).toBeDisabled();

    await userEvent.type(screen.getByRole("textbox", { name: "Confirmation words" }), "JumbosPizza.com");
    expect(approve[0]).toBeEnabled();
    await userEvent.click(approve[0]);
    const call = fetchMock.mock.calls.find(([u]) => u === "/api/assistant/actions/r1/decide");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ approve: true, phrase: "JumbosPizza.com" });
  });
});
