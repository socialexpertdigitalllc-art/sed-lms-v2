export interface DashboardVisibility {
  totalLeads: boolean;
  quotedRevenue: boolean;
  ready: boolean;
  avgRating: boolean;
  closedRevenue: boolean;
  recurringRevenue: boolean;
  avgDealSize: boolean;
  conversionRate: boolean;
  newThisWeek: boolean;
  overdueFollowups: boolean;
  pickupRate: boolean;
  openTickets: boolean;
  overdueTickets: boolean;
  avgResolutionTime: boolean;
  statusStrip: boolean;
  leadsOverTime: boolean;
  pipelineByStatus: boolean;
  leadsByAgent: boolean;
  siteTypeSplit: boolean;
  ratingDistribution: boolean;
  freshVsFollowup: boolean;
  revenueByStatus: boolean;
  ticketStatusSplit: boolean;
}

const KEYMAP: [keyof DashboardVisibility, string][] = [
  ["totalLeads", "dashboard.kpi.total_leads"],
  ["quotedRevenue", "dashboard.kpi.quoted_revenue"],
  ["ready", "dashboard.kpi.ready"],
  ["avgRating", "dashboard.kpi.avg_rating"],
  ["closedRevenue", "dashboard.kpi.closed_revenue"],
  ["recurringRevenue", "dashboard.kpi.recurring_revenue"],
  ["avgDealSize", "dashboard.kpi.avg_deal_size"],
  ["conversionRate", "dashboard.kpi.conversion_rate"],
  ["newThisWeek", "dashboard.kpi.new_this_week"],
  ["overdueFollowups", "dashboard.kpi.overdue_followups"],
  ["pickupRate", "dashboard.kpi.pickup_rate"],
  ["openTickets", "dashboard.kpi.open_tickets"],
  ["overdueTickets", "dashboard.kpi.overdue_tickets"],
  ["avgResolutionTime", "dashboard.kpi.avg_resolution_time"],
  ["statusStrip", "dashboard.strip.status"],
  ["leadsOverTime", "dashboard.chart.leads_over_time"],
  ["pipelineByStatus", "dashboard.chart.pipeline_by_status"],
  ["leadsByAgent", "dashboard.chart.leads_by_agent"],
  ["siteTypeSplit", "dashboard.chart.site_type_split"],
  ["ratingDistribution", "dashboard.chart.rating_distribution"],
  ["freshVsFollowup", "dashboard.chart.fresh_vs_followup"],
  ["revenueByStatus", "dashboard.chart.revenue_by_status"],
  ["ticketStatusSplit", "dashboard.chart.ticket_status_split"],
];

export function dashboardVisibility(perms: Set<string>): DashboardVisibility {
  const v = {} as DashboardVisibility;
  for (const [flag, key] of KEYMAP) v[flag] = perms.has(key);
  return v;
}

export function anyDashboardVisible(v: DashboardVisibility): boolean {
  return Object.values(v).some(Boolean);
}
