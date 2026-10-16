import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StatusHoverPill } from "@/components/leads/StatusHoverPill";
import { StatusTimeline } from "@/components/leads/StatusTimeline";
import { formatDateTimeLong } from "@/lib/leads/format";
import type { StatusHistory } from "@/lib/leads/statusHistory";

/**
 * The table pill answers "since when?" on hover; the lead page lists every
 * change and lets an admin move one. Fixtures are built from LOCAL clock
 * times so the hour boxes mean the same thing in any timezone.
 */

const local = (d: number, h: number) => new Date(2026, 9, d, h, 0).toISOString(); // October 2026

const history = (): StatusHistory => ({
  leadId: "lead-1",
  status: "Closed",
  submittedAt: local(1, 8),
  events: [
    { id: "e1", from_status: "Not Ready", to_status: "Ready", changed_at: local(2, 9), by: "Sam", source: "app", correction: null },
    { id: "e2", from_status: "Ready", to_status: "Closed", changed_at: local(2, 10), by: "Sam", source: "app", correction: null },
  ],
});

let fetchSpy: ReturnType<typeof vi.fn>;
function mockFetch(json: unknown, ok = true) {
  fetchSpy = vi.fn(async () => ({ ok, json: async () => json }));
  vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
}
beforeEach(() => mockFetch({ history: history() }));
afterEach(() => vi.unstubAllGlobals());

describe("StatusHoverPill", () => {
  it("shows since when, the submission and the changes on hover", async () => {
    render(<StatusHoverPill leadId="lead-1" status="Closed" />);
    fireEvent.mouseEnter(screen.getByText("Closed").closest("[data-status-chip]") as HTMLElement);

    expect(await screen.findByTestId("status-since")).toHaveTextContent(formatDateTimeLong(local(2, 10)));
    expect(screen.getByText("as Not Ready")).toBeInTheDocument();
    expect(screen.getByText(formatDateTimeLong(local(1, 8)))).toBeInTheDocument();
    expect(screen.getByText("Closed 1 day after it was submitted")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith("/api/leads/lead-1/status-history");
  });

  it("fetches once per lead version", async () => {
    const view = render(<StatusHoverPill leadId="lead-1" status="Closed" version="v1" />);
    const chip = () => screen.getAllByText("Closed")[0].closest("[data-status-chip]") as HTMLElement;
    fireEvent.mouseEnter(chip());
    await screen.findByTestId("status-since");
    fireEvent.mouseLeave(chip());
    fireEvent.mouseEnter(chip());
    await screen.findByTestId("status-since");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    view.rerender(<StatusHoverPill leadId="lead-1" status="Closed" version="v2" />);
    fireEvent.mouseEnter(chip());
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });
});

describe("StatusTimeline", () => {
  it("offers no date editing without the admin flag", () => {
    render(<StatusTimeline history={history()} />);
    expect(screen.queryByRole("button", { name: /change the date/i })).not.toBeInTheDocument();
    expect(screen.getByText("Counts in October 2026")).toBeInTheDocument();
  });

  it("refuses a date before the previous change, and says why", () => {
    render(<StatusTimeline history={history()} canCorrect />);
    fireEvent.click(screen.getByRole("button", { name: "Change the date of Closed" }));
    fireEvent.change(screen.getByLabelText("Hour"), { target: { value: "8" } });
    expect(screen.getByText(/after the change before it \(Ready/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("saves a valid date and hands back the server's history", async () => {
    const after = history();
    after.events[1] = { ...after.events[1], changed_at: local(2, 11) };
    mockFetch({ ok: true, history: after });
    const onCorrected = vi.fn();
    render(<StatusTimeline history={history()} canCorrect onCorrected={onCorrected} />);

    fireEvent.click(screen.getByRole("button", { name: "Change the date of Closed" }));
    fireEvent.change(screen.getByLabelText("Hour"), { target: { value: "11" } });
    expect(screen.getByText(/reports will count this lead in/i)).toHaveTextContent("October 2026");
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onCorrected).toHaveBeenCalledWith(after, expect.objectContaining({ id: "e2" })));
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/leads/lead-1/status-history/e2",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ changed_at: local(2, 11) }) }),
    );
  });

  it("keeps the editor open with the server's reason when the save is refused", async () => {
    mockFetch({ error: "Only an admin can change when a status changed." }, false);
    render(<StatusTimeline history={history()} canCorrect />);
    fireEvent.click(screen.getByRole("button", { name: "Change the date of Closed" }));
    fireEvent.change(screen.getByLabelText("Hour"), { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/only an admin/i)).toBeInTheDocument();
  });

  it("marks a corrected change with its first recorded date", () => {
    const h = history();
    h.events[1] = { ...h.events[1], correction: { originalAt: local(5, 10), by: "Ana", at: local(6, 9) } };
    render(<StatusTimeline history={h} />);
    expect(screen.getByText(/corrected by ana/i)).toHaveTextContent(`first recorded ${formatDateTimeLong(local(5, 10))}`);
  });
});
