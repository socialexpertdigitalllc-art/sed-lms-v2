/**
 * The shared date/time inputs that replaced every native `<input type="date|
 * time|datetime-local">` in the dashboard. What matters is the CONTRACT:
 * callers still receive the native string formats (`YYYY-MM-DD`, `HH:MM`
 * 24-hour, `YYYY-MM-DDTHH:MM`), so nothing downstream — API validators,
 * `new Date(value)`, the follow-up presets — had to change.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  DatePicker,
  DateTimeField,
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
