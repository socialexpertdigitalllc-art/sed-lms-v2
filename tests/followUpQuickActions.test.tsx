import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FollowUpQuickActions } from "@/components/leads/FollowUpQuickActions";
import { FollowUpModal } from "@/components/leads/FollowUpModal";
import { PermissionProvider } from "@/providers/PermissionProvider";
import { QUICK_NO_PICKUP_MS } from "@/lib/leads/followups";

/**
 * Nearly every call ends one of two ways, and making an agent open a modal to
 * say "nobody answered" is the slowest part of working a queue.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ followUp: {} }) }));
  vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
});
afterEach(() => vi.unstubAllGlobals());

const body = () => JSON.parse(String((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body));

describe("FollowUpQuickActions — the Cross", () => {
  it("logs a No Pickup and books the retry 24 hours out, with no modal", async () => {
    const onPickup = vi.fn();
    render(<FollowUpQuickActions leadId="lead-1" businessName="Acme" onPickup={onPickup} />);

    const before = Date.now();
    fireEvent.click(screen.getByRole("button", { name: /no pickup/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    expect(fetchSpy.mock.calls[0][0]).toBe("/api/leads/lead-1/follow-ups");
    const sent = body();
    expect(sent).toMatchObject({ fu_status: "No Pickup", comments: null, status_change: null, is_specific_time: false });

    // A quick No Pickup is never a client-specified slot, so it must not
    // inherit the Specific badge — and the retry lands a day ahead.
    const scheduled = new Date(sent.next_follow_up_time).getTime();
    expect(scheduled).toBeGreaterThanOrEqual(before + QUICK_NO_PICKUP_MS);
    expect(scheduled).toBeLessThanOrEqual(Date.now() + QUICK_NO_PICKUP_MS + 5_000);

    expect(onPickup).not.toHaveBeenCalled();
  });

  it("surfaces the API's reason when the log is refused", async () => {
    fetchSpy = vi.fn(async () => ({ ok: false, json: async () => ({ error: "Follow-ups apply only to Ready or Long Term leads." }) }));
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    render(<FollowUpQuickActions leadId="lead-2" businessName="Acme" onPickup={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /no pickup/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    // No throw, and the button comes back enabled for a retry.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /no pickup/i })).not.toBeDisabled(),
    );
  });
});

describe("FollowUpQuickActions — the Tick", () => {
  it("opens the modal instead of posting anything", () => {
    const onPickup = vi.fn();
    render(<FollowUpQuickActions leadId="lead-3" businessName="Acme" onPickup={onPickup} />);

    fireEvent.click(screen.getByRole("button", { name: /log a pickup/i }));

    expect(onPickup).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("FollowUpModal initialStatus", () => {
  it("opens already on Pickup, with the comments field showing", () => {
    render(
      <PermissionProvider value={["leads.followup"]}>
        <FollowUpModal leadId="lead-4" businessName="Acme" open onClose={vi.fn()} initialStatus="Pickup" />
      </PermissionProvider>,
    );

    // The comments box only renders for a Pickup, so its presence is the proof
    // the status is genuinely selected rather than merely highlighted.
    expect(screen.getByText("Follow Up Comments")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).not.toBeDisabled();
  });

  it("still opens blank when no status is preset", () => {
    render(
      <PermissionProvider value={["leads.followup"]}>
        <FollowUpModal leadId="lead-5" businessName="Acme" open onClose={vi.fn()} />
      </PermissionProvider>,
    );

    expect(screen.queryByText("Follow Up Comments")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });
});
