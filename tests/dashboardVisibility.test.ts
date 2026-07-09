import { describe, it, expect } from "vitest";
import { dashboardVisibility, anyDashboardVisible } from "@/lib/dashboard/visibility";

describe("dashboardVisibility", () => {
  it("maps keys to flags", () => {
    const v = dashboardVisibility(new Set(["dashboard.kpi.total_leads", "dashboard.chart.revenue_by_status"]));
    expect(v.totalLeads).toBe(true);
    expect(v.revenueByStatus).toBe(true);
    expect(v.quotedRevenue).toBe(false);
    expect(v.ticketStatusSplit).toBe(false);
  });
  it("anyDashboardVisible false when nothing granted", () => {
    expect(anyDashboardVisible(dashboardVisibility(new Set()))).toBe(false);
  });
  it("anyDashboardVisible true with one flag", () => {
    expect(anyDashboardVisible(dashboardVisibility(new Set(["dashboard.strip.status"])))).toBe(true);
  });
});
