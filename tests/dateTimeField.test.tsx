/**
 * The shared date/time inputs that replaced every native `<input type="date|
 * time|datetime-local">` in the dashboard. What matters is the CONTRACT:
 * callers still receive the native string formats (`YYYY-MM-DD`, `HH:MM`
 * 24-hour, `YYYY-MM-DDTHH:MM`), so nothing downstream — API validators,
 * `new Date(value)`, the follow-up presets — had to change.
 */
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  DatePicker,
  DateTimeField,
  DateTimePicker,
  nextRoundTime,
  TimeField,
  formatDateLabel,
  parseDateValue,
  parseTimeValue,
} from "@/components/common/DateTimeField";

describe("value parsing", () => {
  it("reads and labels a date", () => {
    expect(parseDateValue("2026-09-04")).toEqual({ y: 2026, m: 9, d: 4 });
    expect(parseDateValue("2026-02-30")).toBeNull();
    expect(parseDateValue("")).toBeNull();
    expect(formatDateLabel("2026-09-04")).toBe("Sep 4, 2026");
  });
  it("splits a 24-hour time into 12-hour parts", () => {
    expect(parseTimeValue("00:05")).toEqual({ h12: 12, minute: 5, period: "AM" });
    expect(parseTimeValue("12:30")).toEqual({ h12: 12, minute: 30, period: "PM" });
    expect(parseTimeValue("17:45")).toEqual({ h12: 5, minute: 45, period: "PM" });
    expect(parseTimeValue("24:00")).toBeNull();
  });
});

describe("TimeField", () => {
  it("emits HH:MM (24h) from typed hour, minute and a chosen period", () => {
    const onChange = vi.fn();
    render(<TimeField value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Hour"), { target: { value: "3" } });
    expect(onChange).toHaveBeenLastCalledWith("03:00"); // no minute yet → :00
    fireEvent.change(screen.getByLabelText("Minute"), { target: { value: "7" } });
    expect(onChange).toHaveBeenLastCalledWith("03:07");
    fireEvent.change(screen.getByLabelText("AM or PM"), { target: { value: "PM" } });
    expect(onChange).toHaveBeenLastCalledWith("15:07");
  });
  it("12 AM is midnight and 12 PM is noon", () => {
    const onChange = vi.fn();
    render(<TimeField value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Hour"), { target: { value: "12" } });
    expect(onChange).toHaveBeenLastCalledWith("00:00");
    fireEvent.change(screen.getByLabelText("AM or PM"), { target: { value: "PM" } });
    expect(onChange).toHaveBeenLastCalledWith("12:00");
  });
  it("an hour outside 1–12 clears the value instead of emitting nonsense", () => {
    const onChange = vi.fn();
    render(<TimeField value="09:30" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Hour"), { target: { value: "13" } });
    expect(onChange).toHaveBeenLastCalledWith("");
  });
  it("shows an outside value in 12-hour form and follows outside changes", () => {
    const { rerender } = render(<TimeField value="17:45" onChange={() => {}} />);
    expect(screen.getByLabelText("Hour")).toHaveValue("5");
    expect(screen.getByLabelText("Minute")).toHaveValue("45");
    expect(screen.getByLabelText("AM or PM")).toHaveValue("PM");
    rerender(<TimeField value="08:05" onChange={() => {}} />);
    expect(screen.getByLabelText("Hour")).toHaveValue("8");
    expect(screen.getByLabelText("AM or PM")).toHaveValue("AM");
  });
  it("only digits, at most two, land in the boxes", () => {
    render(<TimeField value="" onChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Minute"), { target: { value: "1a2b3" } });
    expect(screen.getByLabelText("Minute")).toHaveValue("12");
  });
});

describe("DatePicker", () => {
  it("opens a calendar and emits the picked day as YYYY-MM-DD", () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-09-04" onChange={onChange} aria-label="From" />);
    expect(screen.getByRole("button", { name: "From" })).toHaveTextContent("Sep 4, 2026");
    fireEvent.click(screen.getByRole("button", { name: "From" }));
    fireEvent.click(screen.getByRole("button", { name: "September 18, 2026" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-09-18");
    expect(screen.queryByRole("dialog")).toBeNull(); // closes on pick
  });
  it("steps months and can clear", () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-01-31" onChange={onChange} aria-label="To" />);
    fireEvent.click(screen.getByRole("button", { name: "To" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("December 2025");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});

describe("DateTimeField", () => {
  it("emits the datetime-local format once both halves exist", () => {
    const onChange = vi.fn();
    render(<DateTimeField value="2026-09-04T09:30" onChange={onChange} aria-label="Follow up" />);
    fireEvent.change(screen.getByLabelText("Hour"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("AM or PM"), { target: { value: "PM" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-09-04T14:30");
  });
  it("picking a day with no time fills in the current time so one click completes the field", () => {
    const onChange = vi.fn();
    render(<DateTimeField value="" onChange={onChange} aria-label="Due" />);
    fireEvent.click(screen.getByRole("button", { name: "Due date" }));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    const v = onChange.mock.calls.at(-1)?.[0] as string;
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
  it("retyping the hour keeps the date: the value blanks, the day does not", () => {
    const onChange = vi.fn();
    render(<DateTimeField value="2026-09-04T09:30" onChange={onChange} aria-label="Due" />);
    fireEvent.change(screen.getByLabelText("Hour"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith("");
    fireEvent.change(screen.getByLabelText("Hour"), { target: { value: "4" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-09-04T04:30");
  });
  it("follows an outside value, e.g. a quick preset", () => {
    const { rerender } = render(<DateTimeField value="" onChange={() => {}} aria-label="Due" />);
    rerender(<DateTimeField value="2026-12-25T18:00" onChange={() => {}} aria-label="Due" />);
    expect(screen.getByRole("button", { name: "Due date" })).toHaveTextContent("Dec 25, 2026");
    expect(screen.getByLabelText("Hour")).toHaveValue("6");
    expect(screen.getByLabelText("AM or PM")).toHaveValue("PM");
  });
});

describe("DateTimePicker — the time is picked inside the calendar", () => {
  function Harness({ initial = "" }: { initial?: string }) {
    const [v, setV] = useState(initial);
    return (
      <>
        <DateTimePicker aria-label="Follow up" value={v} onChange={setV} />
        <output data-testid="v">{v}</output>
      </>
    );
  }
  const val = () => screen.getByTestId("v").textContent;

  it("one field: opens a calendar that also has hour, minutes and AM/PM", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Follow up" }));
    const dialog = screen.getByRole("dialog", { name: "Choose a date and time" });
    expect(within(dialog).getByLabelText("Hour")).toBeTruthy();
    expect(within(dialog).getByLabelText("Minutes")).toBeTruthy();
    expect(within(dialog).getByLabelText("AM or PM")).toBeTruthy();
    expect(screen.queryByPlaceholderText("hh")).toBeNull(); // no separate typed time boxes
  });

  it("picking a day fills a time at once; changing the time updates the value; Done closes", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Follow up" }));
    const dialog = screen.getByRole("dialog", { name: "Choose a date and time" });
    const day = within(dialog).getAllByRole("button").find((b) => /\d+, \d{4}$/.test(b.getAttribute("aria-label") ?? ""))!;
    fireEvent.click(day);
    expect(val()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const datePart = val()!.slice(0, 10);
    fireEvent.change(within(dialog).getByLabelText("Hour"), { target: { value: "3" } });
    fireEvent.change(within(dialog).getByLabelText("Minutes"), { target: { value: "30" } });
    fireEvent.change(within(dialog).getByLabelText("AM or PM"), { target: { value: "PM" } });
    expect(val()).toBe(`${datePart}T15:30`);
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Choose a date and time" })).toBeNull();
    expect(screen.getByRole("button", { name: "Follow up" }).textContent).toMatch(/3:30 PM/);
  });

  it("12 AM is midnight and 12 PM is noon", () => {
    render(<Harness initial="2026-11-20T09:00" />);
    fireEvent.click(screen.getByRole("button", { name: "Follow up" }));
    const dialog = screen.getByRole("dialog", { name: "Choose a date and time" });
    fireEvent.change(within(dialog).getByLabelText("Hour"), { target: { value: "12" } });
    expect(val()).toBe("2026-11-20T00:00");
    fireEvent.change(within(dialog).getByLabelText("AM or PM"), { target: { value: "PM" } });
    expect(val()).toBe("2026-11-20T12:00");
  });

  it("shows an existing value, keeps an odd minute, and can be cleared", () => {
    render(<Harness initial="2026-11-20T14:07" />);
    expect(screen.getByRole("button", { name: "Follow up" }).textContent).toMatch(/Nov 20, 2026 · 2:07 PM/);
    fireEvent.click(screen.getByRole("button", { name: "Follow up" }));
    expect((screen.getByLabelText("Minutes") as HTMLSelectElement).value).toBe("7");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear date and time" }));
    expect(val()).toBe("");
  });

  it("nextRoundTime rounds up to the next whole 5 minutes", () => {
    expect(nextRoundTime(new Date(2026, 10, 20, 9, 2))).toBe("09:05");
    expect(nextRoundTime(new Date(2026, 10, 20, 9, 5))).toBe("09:10");
    expect(nextRoundTime(new Date(2026, 10, 20, 23, 58))).toBe("00:00");
  });
});
