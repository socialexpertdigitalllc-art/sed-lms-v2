import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActionCard } from "@/lib/assistant/actions/card";
import { ActionCardView, PlanBar } from "@/components/assistant/ActionCard";
import type { CardOpResult } from "@/components/assistant/useAssistantChat";

/**
 * The confirmation card — the one thing standing between SED AI and a change.
 * Pinned here: Confirm sends exactly what the card shows (edits, ticks,
 * typed words), risky changes ask for more than a click, and an outcome
 * replaces the buttons.
 */

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const base: ActionCard = {
  id: "a1",
  key: "lead.create",
  title: "Create a lead — Jumbo's Pizza",
  group: "Leads",
  risk: "standard",
  status: "proposed",
  confirmLabel: "Create lead",
  fields: [
    { name: "business_name", label: "Business name", value: "Jumbo's Pizza", edit: { type: "text", raw: "Jumbo's Pizza" } },
    { name: "follow_up_time", label: "Follow-up", value: "Thu, Oct 15, 10:00 AM", edit: { type: "datetime", raw: "2026-10-15T10:00" } },
    { name: "site_type", label: "Site type", value: "Custom Website", edit: { type: "enum", raw: "Custom Website", options: [{ value: "Custom Website", label: "Custom Website" }, { value: "Redesign", label: "Redesign" }] } },
  ],
  warnings: ["owner@gmial.com may be a typo — did the customer mean owner@gmail.com?"],
  notes: ["The lead will be yours."],
  createdAt: "2026-10-14T10:00:00Z",
};

const ok = (card: ActionCard): CardOpResult => ({ ok: true, card });

describe("ActionCardView", () => {
  it("shows what will happen and confirms with the edits made on the card", async () => {
    const done: ActionCard = {
      ...base,
      status: "done",
      result: { message: "Created the lead Jumbo's Pizza.", link: { href: "/leads/x", label: "Open lead" } },
      undoUntil: new Date(Date.now() + 600_000).toISOString(),
    };
    const onOp = vi.fn(async () => ok(done));
    const { rerender } = render(<ActionCardView card={base} onOp={onOp} />);
    expect(screen.getByText("Create a lead — Jumbo's Pizza")).toBeInTheDocument();
    expect(screen.getByText(/may be a typo/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Change Business name" }));
    const input = screen.getByRole("textbox", { name: "Business name" });
    await userEvent.clear(input);
    await userEvent.type(input, "Jumbo's Pizza & Grill");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByRole("button", { name: /Create lead/ }));
    expect(onOp).toHaveBeenCalledWith(base, "confirm", { edits: { business_name: "Jumbo's Pizza & Grill" } });

    rerender(<ActionCardView card={done} onOp={onOp} />);
    expect(screen.getByText("Created the lead Jumbo's Pizza.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Undo · 10 min left/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create lead/ })).not.toBeInTheDocument();
  });

  it("asks for the tick on a sensitive change and the typed words on a critical one", async () => {
    const onOp = vi.fn(async () => ok(base));
    const { unmount } = render(<ActionCardView card={{ ...base, risk: "sensitive", confirmLabel: "Send" }} onOp={onOp} />);
    const send = screen.getByRole("button", { name: /Send/ });
    expect(send).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /checked the details/ }));
    expect(send).toBeEnabled();
    unmount();

    render(<ActionCardView card={{ ...base, risk: "critical", confirmLabel: "Buy domain", confirmPhrase: "jumbospizza.com" }} onOp={onOp} />);
    const buy = screen.getByRole("button", { name: /Buy domain/ });
    expect(buy).toBeDisabled();
    // A critical card is never edited in place.
    expect(screen.queryByRole("button", { name: "Change Business name" })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Confirmation words" }), "JumbosPizza.com");
    expect(buy).toBeEnabled();
    await userEvent.click(buy);
    expect(onOp).toHaveBeenLastCalledWith(expect.anything(), "confirm", { phrase: "JumbosPizza.com" });
  });

  it("sends only the records still ticked on a bulk change", async () => {
    const onOp = vi.fn(async () => ok(base));
    const card: ActionCard = {
      ...base,
      title: "Change status — 3 leads",
      fields: [],
      confirmLabel: "Apply to selected",
      items: [
        { id: "l1", label: "Jumbo's", selected: true },
        { id: "l2", label: "Old Town", selected: true },
        { id: "l3", label: "Rosales", selected: true },
      ],
    };
    render(<ActionCardView card={card} onOp={onOp} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Old Town/ }));
    expect(screen.getByText("2 of 3 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Apply to selected \(2\)/ }));
    expect(onOp).toHaveBeenCalledWith(card, "confirm", { selected: ["l1", "l3"] });
  });

  it("offers Ask an admin instead of Confirm when the person cannot do it themselves", async () => {
    const onOp = vi.fn(async () => ok({ ...base, status: "awaiting_approval" }));
    render(<ActionCardView card={{ ...base, approval: { reason: "Your account doesn't have “Assign / Reassign Lead”." } }} onOp={onOp} />);
    expect(screen.queryByRole("button", { name: /Create lead/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Note for the approver" }), "Customer is waiting");
    await userEvent.click(screen.getByRole("button", { name: /Ask an admin/ }));
    expect(onOp).toHaveBeenCalledWith(expect.anything(), "request", { note: "Customer is waiting" });
  });

  it("shows the endpoint's refusal next to the field it is about", async () => {
    const onOp = vi.fn(async (): Promise<CardOpResult> => ({ ok: false, error: "Business name is required.", problems: [{ field: "business_name", message: "Business name is required." }] }));
    render(<ActionCardView card={base} onOp={onOp} />);
    await userEvent.click(screen.getByRole("button", { name: /Create lead/ }));
    expect(await screen.findAllByText("Business name is required.")).toHaveLength(2);
  });

  it("runs a plan's waiting steps in one go, asking for the check when one of them needs it", async () => {
    const onRunAll = vi.fn(async () => ({ ok: true }));
    const plan = { id: "p1", index: 1, total: 2, title: "New client" };
    render(
      <PlanBar
        cards={[
          { ...base, plan },
          { ...base, id: "a2", risk: "sensitive", plan: { ...plan, index: 2 } },
        ]}
        onRunAll={onRunAll}
      />,
    );
    const run = screen.getByRole("button", { name: /Run all 2 steps/ });
    expect(run).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /checked every step/ }));
    await userEvent.click(run);
    expect(onRunAll).toHaveBeenCalled();
  });
});
