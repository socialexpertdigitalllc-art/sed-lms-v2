import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FollowUpModal } from "@/components/leads/FollowUpModal";
import { PermissionProvider } from "@/providers/PermissionProvider";

/**
 * The two follow-up rules an agent feels every day:
 *  - "Specific time" marks a slot the CLIENT asked for, and must reach the API;
 *  - dropping a lead must not demand a future follow-up time (agents were
 *    inventing throwaway times to satisfy the form).
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
});
afterEach(() => vi.unstubAllGlobals());

function mount() {
  return render(
    <PermissionProvider value={["leads.followup", "leads.status_change", "leads.set_status.dropped"]}>
      <FollowUpModal leadId="lead-1" businessName="Acme" open onClose={vi.fn()} />
    </PermissionProvider>,
  );
}

const body = () => JSON.parse(String((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body));

describe("FollowUpModal", () => {
  it("sends is_specific_time when the box is ticked", async () => {
    mount();
    fireEvent.click(screen.getByText("Pickup"));
    const when = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16);
    fireEvent.change(document.querySelector('input[type="datetime-local"]') as HTMLInputElement, {
      target: { value: when },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /specific time/i }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(body()).toMatchObject({ fu_status: "Pickup", is_specific_time: true });
  });

  it("defaults the flag to false", async () => {
    mount();
    fireEvent.click(screen.getByText("Pickup"));
    const when = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16);
    fireEvent.change(document.querySelector('input[type="datetime-local"]') as HTMLInputElement, {
      target: { value: when },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(body().is_specific_time).toBe(false);
  });
});
