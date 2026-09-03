import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FuStatusHoverChip } from "@/components/leads/FuStatusHoverChip";
import { formatDateTime } from "@/lib/leads/format";

/**
 * Agents read the pill to decide whether a lead is worth another call. The
 * comment behind it is the whole reason the pill matters, and comments only
 * ever live on a PICKUP (the API nulls them for "No Pickup"), so a No Pickup
 * pill has to reach back to the last pickup that actually said something.
 */

let fetchSpy: ReturnType<typeof vi.fn>;

function mockPickup(pickup: unknown) {
  fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ pickup }) }));
  vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
}

beforeEach(() => mockPickup(null));
afterEach(() => vi.unstubAllGlobals());

const hover = (label: string) =>
  fireEvent.mouseEnter(screen.getByText(label).closest("[data-fu-chip]") as HTMLElement);

describe("FuStatusHoverChip", () => {
  it("shows the last follow-up's comments when the pill reads Pickup", async () => {
    mockPickup({ comments: "Wants the quote by Friday", created_at: "2026-08-12T15:40:00.000Z" });
    render(<FuStatusHoverChip leadId="lead-1" status="Pickup" />);

    hover("Pickup");

    expect(await screen.findByText("Wants the quote by Friday")).toBeInTheDocument();
    expect(screen.getByText(/last follow-up/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith("/api/leads/lead-1/follow-ups/last-pickup"),
    );
  });

  it("labels the No Pickup tooltip as the last pickup's comments, dated", async () => {
    mockPickup({ comments: "Asked us to call back next week", created_at: "2026-08-12T15:40:00.000Z" });
    render(<FuStatusHoverChip leadId="lead-2" status="No Pickup" />);

    hover("No Pickup");

    expect(await screen.findByText("Asked us to call back next week")).toBeInTheDocument();
    expect(screen.getByText(/last pickup comments/i)).toBeInTheDocument();
    // The date sits above the comment so a stale note is obvious at a glance.
    expect(screen.getByTestId("fu-tooltip-date")).toHaveTextContent(
      formatDateTime("2026-08-12T15:40:00.000Z"),
    );
  });

  it("says so when no pickup was ever logged", async () => {
    mockPickup(null);
    render(<FuStatusHoverChip leadId="lead-3" status="No Pickup" />);

    hover("No Pickup");

    expect(await screen.findByText(/no pickup logged yet/i)).toBeInTheDocument();
  });

  it("says so when the last pickup carried no comment", async () => {
    mockPickup({ comments: "   ", created_at: "2026-08-12T15:40:00.000Z" });
    render(<FuStatusHoverChip leadId="lead-4" status="Pickup" />);

    hover("Pickup");

    expect(await screen.findByText(/no comments recorded/i)).toBeInTheDocument();
  });

  it("hides the tooltip again on mouse leave", async () => {
    mockPickup({ comments: "Send the invoice", created_at: "2026-08-12T15:40:00.000Z" });
    render(<FuStatusHoverChip leadId="lead-5" status="Pickup" />);

    hover("Pickup");
    await screen.findByText("Send the invoice");

    fireEvent.mouseLeave(screen.getByText("Pickup").closest("[data-fu-chip]") as HTMLElement);
    await waitFor(() => expect(screen.queryByText("Send the invoice")).not.toBeInTheDocument());
  });

  it("does not refetch on a second hover of the same pill", async () => {
    mockPickup({ comments: "Send the invoice", created_at: "2026-08-12T15:40:00.000Z" });
    const chip = render(<FuStatusHoverChip leadId="lead-6" status="Pickup" />);

    hover("Pickup");
    await screen.findByText("Send the invoice");
    fireEvent.mouseLeave(screen.getByText("Pickup").closest("[data-fu-chip]") as HTMLElement);
    hover("Pickup");
    await screen.findByText("Send the invoice");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    chip.unmount();
  });

  it("refetches once the lead itself changes", async () => {
    mockPickup({ comments: "First note", created_at: "2026-08-12T15:40:00.000Z" });
    const view = render(
      <FuStatusHoverChip leadId="lead-7" status="Pickup" version="2026-08-12T15:40:00.000Z" />,
    );

    hover("Pickup");
    await screen.findByText("First note");

    // A newly logged follow-up bumps leads.updated_at (trg_leads_touch), which
    // is the only signal a still-mounted row gets that its comment is stale.
    mockPickup({ comments: "Second note", created_at: "2026-08-13T10:00:00.000Z" });
    view.rerender(
      <FuStatusHoverChip leadId="lead-7" status="Pickup" version="2026-08-13T10:00:00.000Z" />,
    );
    hover("Pickup");

    expect(await screen.findByText("Second note")).toBeInTheDocument();
  });
});
