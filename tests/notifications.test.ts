import { describe, it, expect } from "vitest";
import { effectiveSetting, shouldRemind } from "@/lib/notifications/logic";

describe("effectiveSetting", () => {
  it("falls back to event defaults when no row", () => {
    expect(effectiveSetting("followup_reminder", undefined)).toEqual({ enabled: true, leadTimeMinutes: 15 });
  });
  it("uses the row when present", () => {
    expect(effectiveSetting("followup_reminder", { enabled: false, lead_time_minutes: 30 }))
      .toEqual({ enabled: false, leadTimeMinutes: 30 });
  });
  it("unknown event with no row → enabled true, 15 default", () => {
    expect(effectiveSetting("nope", undefined)).toEqual({ enabled: true, leadTimeMinutes: 15 });
  });
});

describe("shouldRemind", () => {
  const now = new Date("2026-07-08T12:00:00");
  it("fires inside the window", () => {
    expect(shouldRemind("2026-07-08T12:10:00", 15, now)).toBe(true);
  });
  it("does not fire before the window opens", () => {
    expect(shouldRemind("2026-07-08T12:30:00", 15, now)).toBe(false);
  });
  it("does not fire once the follow-up time has passed", () => {
    expect(shouldRemind("2026-07-08T11:59:00", 15, now)).toBe(false);
  });
  it("fires exactly at window open, not at/after follow-up time", () => {
    expect(shouldRemind("2026-07-08T12:15:00", 15, now)).toBe(true);   // opens exactly now
    expect(shouldRemind("2026-07-08T12:00:00", 15, now)).toBe(false);  // == follow-up time (excluded)
  });
  it("null / bad time → false", () => {
    expect(shouldRemind(null, 15, now)).toBe(false);
    expect(shouldRemind("nope", 15, now)).toBe(false);
  });
});
