import { describe, it, expect } from "vitest";
import { isSpecificActive, SPECIFIC_TTL_MS } from "@/lib/leads/followups";

/**
 * "The client asked for 3:15pm Tuesday" is only true until somebody has to
 * reschedule around it. A day after it was logged with no new follow-up, the
 * lead rejoins the ordinary queue — otherwise the Specific filter fills up with
 * appointments that were never kept.
 */

const NOW = new Date("2026-09-04T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const at = (iso: string) => new Date(iso);

describe("isSpecificActive — measured from the follow-up time", () => {
  // Saved Friday 5pm for Monday 6pm (Pakistan time, UTC+5).
  const fridaySave = "2026-10-30T12:00:00.000Z"; // Fri 5:00 PM PKT
  const mondayCall = "2026-11-02T13:00:00.000Z"; // Mon 6:00 PM PKT
  const lead = { follow_up_is_specific: true, follow_up_set_at: fridaySave, follow_up_time: mondayCall };

  it("is still Specific on Saturday after 5pm (24h after it was saved)", () => {
    expect(isSpecificActive(lead, at("2026-10-31T12:30:00.000Z"))).toBe(true);
  });

  it("is still Specific at the appointment and through Tuesday before 6pm", () => {
    expect(isSpecificActive(lead, at(mondayCall))).toBe(true);
    expect(isSpecificActive(lead, at("2026-11-03T12:59:00.000Z"))).toBe(true); // Tue 5:59 PM
  });

  it("leaves Specific at Tuesday 6pm, 24h after the follow-up time", () => {
    expect(isSpecificActive(lead, at("2026-11-03T13:00:00.000Z"))).toBe(false); // Tue 6:00 PM
    expect(isSpecificActive(lead, at("2026-11-04T08:00:00.000Z"))).toBe(false);
  });

  it("a reschedule moves the clock with the new follow-up time", () => {
    const moved = { ...lead, follow_up_time: "2026-11-05T13:00:00.000Z" }; // Thu 6 PM
    expect(isSpecificActive(moved, at("2026-11-04T08:00:00.000Z"))).toBe(true);
    expect(isSpecificActive(moved, at("2026-11-06T13:00:00.000Z"))).toBe(false);
  });

  it("the follow-up time wins over an old save time", () => {
    const saved = { follow_up_is_specific: true, follow_up_set_at: ago(10 * SPECIFIC_TTL_MS), follow_up_time: ago(60_000) };
    expect(isSpecificActive(saved, NOW)).toBe(true);
  });

  it("an unparseable follow-up time never expires", () => {
    expect(isSpecificActive({ follow_up_is_specific: true, follow_up_time: "not a date" }, NOW)).toBe(true);
  });
});

describe("isSpecificActive — rows with no follow-up time fall back to the save time", () => {
  it("is false for a lead that was never specific", () => {
    expect(isSpecificActive({ follow_up_is_specific: false, follow_up_set_at: ago(0) }, NOW)).toBe(false);
  });

  it("holds for a specific follow-up logged minutes ago", () => {
    expect(isSpecificActive({ follow_up_is_specific: true, follow_up_set_at: ago(5 * 60_000) }, NOW)).toBe(true);
  });

  it("still holds just inside 24 hours", () => {
    expect(
      isSpecificActive({ follow_up_is_specific: true, follow_up_set_at: ago(SPECIFIC_TTL_MS - 60_000) }, NOW),
    ).toBe(true);
  });

  it("expires once 24 hours have passed with no new follow-up", () => {
    expect(
      isSpecificActive({ follow_up_is_specific: true, follow_up_set_at: ago(SPECIFIC_TTL_MS + 1) }, NOW),
    ).toBe(false);
  });

  it("expires exactly at the 24-hour boundary", () => {
    expect(
      isSpecificActive({ follow_up_is_specific: true, follow_up_set_at: ago(SPECIFIC_TTL_MS) }, NOW),
    ).toBe(false);
  });

  it("a newer follow-up restarts the clock", () => {
    // The second follow-up rewrites follow_up_set_at, so a lead that had aged
    // out is specific again on the strength of the NEW time, not the old one.
    const stale = { follow_up_is_specific: true, follow_up_set_at: ago(3 * SPECIFIC_TTL_MS) };
    expect(isSpecificActive(stale, NOW)).toBe(false);
    const relogged = { follow_up_is_specific: true, follow_up_set_at: ago(60_000) };
    expect(isSpecificActive(relogged, NOW)).toBe(true);
  });

  it("a later NON-specific follow-up clears the flag outright", () => {
    // The follow-up route writes follow_up_is_specific unconditionally, so a
    // loose reschedule drops the badge without waiting out any TTL.
    expect(isSpecificActive({ follow_up_is_specific: false, follow_up_set_at: ago(60_000) }, NOW)).toBe(false);
  });

  it("never expires when no set-at time was recorded", () => {
    // Rows written before migration 0073, and any environment where it has not
    // been applied — dropping their badge would read as data loss.
    expect(isSpecificActive({ follow_up_is_specific: true, follow_up_set_at: null }, NOW)).toBe(true);
    expect(isSpecificActive({ follow_up_is_specific: true }, NOW)).toBe(true);
  });

  it("treats an unparseable timestamp as never expiring", () => {
    expect(isSpecificActive({ follow_up_is_specific: true, follow_up_set_at: "not a date" }, NOW)).toBe(true);
  });
});
