import { describe, it, expect } from "vitest";
import { DASHBOARD_LEAD_COLUMNS, DASHBOARD_LEAD_SELECT } from "@/lib/dashboard/columns";

/** The dashboard reads a column list, not `*`; the literal select string and
 *  the typed column array must stay the same list. */
describe("dashboard lead columns", () => {
  it("select string matches the typed column list", () => {
    expect(DASHBOARD_LEAD_SELECT).toBe(DASHBOARD_LEAD_COLUMNS.join(", "));
  });
  it("covers every field the metrics read", () => {
    for (const c of ["status", "created_at", "price_quoted", "yearly_price", "rating", "closed_at", "dropped_at", "first_touch_at", "follow_up_time", "agent_id", "site_type", "fresh_or_followup", "business_phone", "custom_area", "id"]) {
      expect(DASHBOARD_LEAD_COLUMNS).toContain(c);
    }
  });
});
