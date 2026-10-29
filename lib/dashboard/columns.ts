import type { Lead } from "@/lib/leads/types";

/**
 * The lead columns the dashboard actually computes from — see
 * lib/leads/analytics.ts, lib/dashboard/metrics.ts, lib/geo/regions.ts and
 * lib/analytics/dateScope.ts. Everything else on a lead (comments, about
 * text, image / reference links, services, add-ons, social profiles …) is
 * the bulk of its ~1.5 KB and was being read from the database, serialised
 * into the RSC payload and shipped to the browser on every dashboard view
 * for nothing. Add a column here when a dashboard metric starts using it.
 */
export const DASHBOARD_LEAD_COLUMNS = [
  "id",
  "status",
  "agent_id",
  "created_at",
  "closed_at",
  "dropped_at",
  "first_touch_at",
  "follow_up_time",
  "price_quoted",
  "yearly_price",
  "rating",
  "site_type",
  "fresh_or_followup",
  "business_phone",
  "custom_area",
] as const satisfies readonly (keyof Lead)[];

export type DashboardLead = Pick<Lead, (typeof DASHBOARD_LEAD_COLUMNS)[number]>;

/**
 * The same list as one literal: supabase-js parses the select string at the
 * TYPE level and a computed `string` would type the rows as an error. A unit
 * test (tests/dashboardColumns.test.ts) keeps the two in step.
 */
export const DASHBOARD_LEAD_SELECT =
  "id, status, agent_id, created_at, closed_at, dropped_at, first_touch_at, follow_up_time, price_quoted, yearly_price, rating, site_type, fresh_or_followup, business_phone, custom_area";

/** By-agent cards: grouping, counts, revenue and the five most recent names. */
export const BY_AGENT_LEAD_SELECT = "id, agent_id, business_name, status, price_quoted, created_at";
