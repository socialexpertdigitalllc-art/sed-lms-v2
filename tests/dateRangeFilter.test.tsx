import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { inRange, localBoundMs } from "@/lib/analytics/dateScope";
import { MonthFilter } from "@/components/common/MonthFilter";

/**
 * The month presets cover most asks in one click; the custom range covers
 * every other one — "since Tuesday afternoon", "the first two weeks of the
 * quarter" — with the dashboard's own date-time picker.
 */

// A fixed local instant, expressed the way the picker emits it and the way
// the database stores it, so the assertions do not depend on the machine's
// timezone.
const at = (local: string) => new Date(local).toISOString();

describe("inRange", () => {
  it("matches everything when both bounds are empty, like MONTH_ALL", () => {
    expect(inRange(at("2026-09-04T10:00"), "", "")).toBe(true);
    expect(inRange(null, "", "")).toBe(true);
  });

  it("is inclusive at the start", () => {
    expect(inRange(at("2026-09-04T10:00"), "2026-09-04T10:00", "")).toBe(true);
    expect(inRange(at("2026-09-04T09:59"), "2026-09-04T10:00", "")).toBe(false);
  });

  it('reads "to 5:00 PM" as through the whole of that minute', () => {
    expect(inRange(at("2026-09-04T17:00:45"), "", "2026-09-04T17:00")).toBe(true);
    expect(inRange(at("2026-09-04T17:01:00"), "", "2026-09-04T17:00")).toBe(false);
  });

  it("applies both bounds together", () => {
    const from = "2026-09-01T00:00";
    const to = "2026-09-15T23:59";
    expect(inRange(at("2026-09-08T12:00"), from, to)).toBe(true);
    expect(inRange(at("2026-08-31T23:59"), from, to)).toBe(false);
    expect(inRange(at("2026-09-16T00:00"), from, to)).toBe(false);
  });

  it("leaves a bound open while it is still being typed, rather than blanking the table", () => {
    expect(inRange(at("2026-09-04T10:00"), "not a date", "")).toBe(true);
    expect(inRange(at("2026-09-04T10:00"), "", "2026-13-99T00:00")).toBe(true);
  });

  it("excludes a row with no created_at once a bound is set", () => {
    expect(inRange(null, "2026-09-01T00:00", "")).toBe(false);
  });

  it("reads a bare date as LOCAL midnight, not UTC", () => {
    expect(localBoundMs("2026-09-04")).toBe(new Date("2026-09-04T00:00").getTime());
  });
});

describe("MonthFilter with a custom range", () => {
  const options = [{ value: "2026-09", label: "September 2026" }];

  it("keeps the plain month control when no range is wired (the dashboard)", () => {
    render(<MonthFilter options={options} value="" onChange={vi.fn()} />);
    expect(screen.queryByRole("option", { name: /custom range/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("created-range")).not.toBeInTheDocument();
  });

  it("choosing Custom range clears the month and reveals from/to pickers", () => {
    const onChange = vi.fn();
    const onRangeChange = vi.fn();
    render(
      <MonthFilter options={options} value="2026-09" onChange={onChange} range={{ from: "", to: "" }} onRangeChange={onRangeChange} />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Created" }), { target: { value: "__custom__" } });

    expect(onChange).toHaveBeenCalledWith("");
    const range = screen.getByTestId("created-range");
    // Two date-time pickers — DateTimeField marks its root — one per bound.
    expect(range.querySelectorAll("[data-datetime-field]")).toHaveLength(2);
  });

  it("shows the pickers already open when a range arrives from the URL", () => {
    render(
      <MonthFilter options={options} value="" onChange={vi.fn()} range={{ from: "2026-09-01T00:00", to: "" }} onRangeChange={vi.fn()} />,
    );
    expect(screen.getByTestId("created-range")).toBeInTheDocument();
    expect((screen.getByRole("combobox", { name: "Created" }) as HTMLSelectElement).value).toBe("__custom__");
  });

  it("picking a month again clears the range so the two scopes never overlap", () => {
    const onChange = vi.fn();
    const onRangeChange = vi.fn();
    render(
      <MonthFilter options={options} value="" onChange={onChange} range={{ from: "2026-09-01T00:00", to: "2026-09-15T23:59" }} onRangeChange={onRangeChange} />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Created" }), { target: { value: "2026-09" } });

    expect(onRangeChange).toHaveBeenCalledWith({ from: "", to: "" });
    expect(onChange).toHaveBeenCalledWith("2026-09");
  });
});
