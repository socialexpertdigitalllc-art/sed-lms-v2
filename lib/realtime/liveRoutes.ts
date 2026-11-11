import type { TablePayload } from "./tableTicks";

/**
 * Which tables each screen shows, so the layout's live refresher
 * (components/layout/LiveRouteRefresh.tsx) can re-render exactly that screen
 * when one of them changes — for EVERY screen in the app.
 *
 * Screens that keep themselves live are listed with `self: true` and no
 * tables: the leads screens (the live leads store), the lead page
 * (LeadLiveRefresh), the notifications inbox, and the boards that load their
 * own data in the browser (domains, Site Builder, Site Studio, SED AI actions —
 * they reload on ticks themselves through hooks/useTableTicks.ts).
 *
 * `match` narrows a detail page to its own rows (the id from the URL).
 * `minGapMs` slows the busiest tables down.
 */
export type LiveRoute = {
  pattern: RegExp;
  tables?: string[];
  match?: (p: TablePayload, params: string[]) => boolean;
  minGapMs?: number;
  self?: true;
};

const byId = (p: TablePayload, [id]: string[]) => !p.id || p.id === id;

export const LIVE_ROUTES: LiveRoute[] = [
  // Leads screens: the rows come from the live store; the page refresh brings
  // the small extras (stars, contract badges, tag catalogue, names).
  { pattern: /^\/(leads|hitlist)$/, tables: ["lead_hitlist", "contracts", "lead_tags", "lead_tag_shares", "profiles"] },
  { pattern: /^\/leads\/follow-ups$/, tables: ["profiles"] },
  { pattern: /^\/leads\/new$/, tables: ["website_addons", "departments", "department_members", "profiles"] },
  {
    pattern: /^\/leads\/([^/]+)\/tickets$/,
    tables: ["lead_tickets", "ticket_items", "ticket_item_attachments", "profiles"],
    match: (p, [leadId]) => p.table !== "lead_tickets" || !p.lead_id || p.lead_id === leadId,
  },
  { pattern: /^\/leads\/[^/]+$/, self: true },
  { pattern: /^\/dashboard$/, tables: ["profiles", "departments", "department_members"] },
  { pattern: /^\/by-agent$/, tables: ["profiles"] },

  { pattern: /^\/tickets$/, tables: ["lead_tickets", "ticket_items", "profiles"] },
  {
    pattern: /^\/tickets\/([^/]+)$/,
    tables: ["lead_tickets", "ticket_items", "ticket_item_attachments", "profiles"],
    match: (p, [id]) =>
      p.table === "lead_tickets" ? !p.id || p.id === id : p.table === "ticket_items" ? !p.ticket_id || p.ticket_id === id : true,
  },

  { pattern: /^\/pre-leads(\/all)?$/, tables: ["pre_leads", "profiles"] },
  { pattern: /^\/pre-leads\/new$/, tables: [] },
  { pattern: /^\/pre-leads\/([^/]+)$/, tables: ["pre_leads"], match: byId },

  { pattern: /^\/feedback$/, tables: ["feedback", "profiles"] },
  { pattern: /^\/payments$/, tables: ["payment_links", "company_mailboxes"] },
  { pattern: /^\/contracts$/, tables: ["contracts", "profiles"] },
  { pattern: /^\/forms$/, tables: ["form_endpoints"] },
  { pattern: /^\/forms\/endpoints$/, tables: ["form_endpoints", "form_submissions"] },
  { pattern: /^\/forms\/endpoints\/new$/, tables: [] },
  { pattern: /^\/forms\/endpoints\/([^/]+)$/, tables: ["form_endpoints"], match: byId },

  { pattern: /^\/domains\/analytics$/, tables: ["client_domains"], minGapMs: 30_000 },
  { pattern: /^\/domains(\/.*)?$/, self: true },

  { pattern: /^\/website$/, tables: ["website_services"] },
  { pattern: /^\/website\/coupons$/, tables: ["website_coupons", "website_services"] },
  { pattern: /^\/website\/offers$/, tables: ["website_offers", "website_services"] },
  { pattern: /^\/website\/portfolio$/, tables: ["website_portfolio"] },
  { pattern: /^\/website\/testimonials$/, tables: ["website_testimonials"] },
  { pattern: /^\/website\/leads$/, tables: ["website_leads"] },
  { pattern: /^\/website\/settings$/, tables: ["website_settings"] },

  { pattern: /^\/notifications$/, self: true },

  { pattern: /^\/admin\/users$/, tables: ["profiles", "departments", "department_members"] },
  {
    pattern: /^\/admin\/users\/([^/]+)$/,
    tables: ["profiles", "departments", "department_members", "department_permissions", "user_permission_overrides", "permissions"],
    match: (p, [id]) => p.table !== "profiles" || !p.id || p.id === id,
  },
  { pattern: /^\/admin\/departments$/, tables: ["departments", "department_members"] },
  {
    pattern: /^\/admin\/departments\/[^/]+$/,
    tables: ["departments", "department_members", "department_permissions", "closer_assignments", "permissions", "profiles"],
  },
  { pattern: /^\/admin\/permissions$/, tables: ["permissions", "department_permissions"] },
  { pattern: /^\/admin\/logs$/, tables: ["activity_log", "profiles"], minGapMs: 10_000 },
  { pattern: /^\/admin\/mail$/, tables: ["company_mailboxes", "profiles"] },
  { pattern: /^\/admin\/notifications$/, tables: ["notification_rules", "profiles"] },
  { pattern: /^\/admin\/settings$/, tables: ["company_mailboxes"] },
  { pattern: /^\/admin\/contract-templates$/, tables: ["contract_templates", "contract_placeholders"] },
  { pattern: /^\/admin\/image-hosts$/, tables: ["image_hosts"] },
  { pattern: /^\/admin\/ai-models$/, tables: ["ai_providers", "ai_task_assignments"] },
  { pattern: /^\/admin\/email-providers$/, tables: ["email_verify_providers"] },
  { pattern: /^\/admin\/add-ons$/, tables: ["website_addons"] },
  { pattern: /^\/admin\/import$/, tables: [] },

  { pattern: /^\/account$/, tables: ["profiles"] },
  { pattern: /^\/account\/signature$/, tables: ["user_signatures"] },

  { pattern: /^\/ai-tools(\/analytics)?$/, tables: ["ai_generations"] },
  { pattern: /^\/ai-tools\/generations\/([^/]+)$/, tables: ["ai_generations"], match: byId },
  { pattern: /^\/ai-tools\/(webcraft|deepseek)$/, tables: ["ai_generations"] },
  { pattern: /^\/ai-tools\/wge$/, tables: ["wge_queue", "wge_config"] },
  { pattern: /^\/ai-tools\/template-engine$/, tables: ["website_templates"] },
  { pattern: /^\/ai-tools\/template-engine\/deployments$/, tables: ["template_generations", "studio_deployments"] },
  { pattern: /^\/ai-tools\/template-engine\/([^/]+)$/, tables: ["template_generations"], match: byId },
  { pattern: /^\/ai-tools\/(site-builder|site-studio)\/deployments$/, tables: ["studio_deployments"] },
  { pattern: /^\/ai-tools\/(templates|site-builder|site-studio)(\/.*)?$/, self: true },

  { pattern: /^\/assistant(\/.*)?$/, self: true },
  // On-demand tools: their numbers are computed when asked, not stored.
  { pattern: /^\/(reports\/agent|verify|mailbox|changelog|docs)(\/.*)?$/, tables: [] },
];

/** The route rule for a path, and the URL params its pattern captured. */
export function liveRouteFor(pathname: string): { route: LiveRoute; params: string[] } | null {
  for (const route of LIVE_ROUTES) {
    const m = route.pattern.exec(pathname);
    if (m) return { route, params: m.slice(1).filter((x): x is string => typeof x === "string") };
  }
  return null;
}
