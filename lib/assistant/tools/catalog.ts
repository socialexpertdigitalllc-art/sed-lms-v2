/**
 * Everything in the LMS the assistant can read, and who may read it.
 *
 * One entry per dataset (a table, under a name the model can use). The rule
 * is the app's own: a person's assistant reads exactly what that person could
 * open by hand, and an Admin-department member's assistant reads everything.
 *
 *   via "rls"     — read through the person's own database client, so
 *                   Postgres row-level security decides what is visible.
 *   via "service" — the table has no read policy (the app's pages serve it
 *                   through the service role after a permission check), so
 *                   the same check is made here first; rows tied to a lead
 *                   are then cut down to the leads the person can see.
 *
 * Admins always read through the service role, unfiltered. Only the columns
 * listed are ever selected, so secrets (passwords, keys, tokens, claim ids)
 * cannot reach the model whatever it asks for.
 */

export type ColumnType = "text" | "number" | "time" | "bool" | "json";

export interface DatasetAccess {
  perms: Set<string>;
  isAdmin: boolean;
}

export interface Dataset {
  /** The name the model uses. */
  key: string;
  table: string;
  /** One line for the model: what a row is. */
  about: string;
  columns: Record<string, ColumnType>;
  /** Who may read it (admins always may). */
  canRead: (perms: Set<string>) => boolean;
  via: "rls" | "service";
  /** The column naming the row's lead: lead visibility applies, and include_lead works. */
  leadColumn?: string;
  /** false: rows are the person's own already (RLS), so lead visibility isn't applied on top. */
  leadScoped?: boolean;
  /** Columns holding a person's id: answers carry their names too. */
  userColumns?: string[];
  /** Stable order for paging through every row (unique together). */
  order: string[];
  /** Hidden unless asked for: soft-deleted rows. */
  softDelete?: string;
}

const T: Record<string, ColumnType> = { s: "text", n: "number", t: "time", b: "bool", j: "json" };

/** "id:s,created_at:t" → { id: "text", created_at: "time" } */
function cols(spec: string): Record<string, ColumnType> {
  const out: Record<string, ColumnType> = {};
  for (const part of spec.split(",")) {
    const [name, t] = part.trim().split(":");
    if (name) out[name] = T[t] ?? "text";
  }
  return out;
}

const any = (...keys: string[]) => (perms: Set<string>) => keys.some((k) => perms.has(k));
const everyone = () => true;
const DEVELOPERS = any("tickets.resolve", "studio.manage");

/** Never selected, whatever a catalog entry says: belt and braces for secrets. */
export const SECRET_COLUMN = /password|secret|(^|_)token$|api_?key|access_key|encrypted|claim_id|_hash$/i;

export const DATASETS: Dataset[] = [
  {
    key: "leads",
    table: "leads",
    about: "Every field of a lead (the CRM record of a business). The lead tools are better for analysis; use this for fields they don't show.",
    columns: cols(
      "id:s,business_name:s,status:s,agent_id:s,closed_by:s,created_by:s,category:s,site_type:s,platform:s,no_platform:b,price_quoted:n,yearly_price:s,rating:n,fresh_or_followup:s,last_followup_status:s,no_pickup_streak:n,follow_up_time:t,follow_up_is_specific:b,follow_up_set_at:t,business_phone:s,business_email:s,no_email:b,owner_name:s,business_profile_link:s,website_link:s,logo_link:s,logo_via_sms:b,color_scheme:s,color_same_as_logo:b,color_see_instructions:b,services:j,service_areas:j,has_service_areas:b,custom_area:s,num_webpages:n,specify_pages:j,add_ons:j,client_experience:n,direct_line_saved:b,about_business:s,comments:s,developer_instructions:s,social_profiles:j,design_reference_links:j,reference_link:s,recommended_template_id:s,hero_video_request:b,hero_video_note:s,first_touch_at:t,closed_at:t,dropped_at:t,created_at:t,updated_at:t,deleted_at:t",
    ),
    canRead: any("leads.view"),
    via: "rls",
    leadColumn: "id",
    userColumns: ["agent_id", "closed_by", "created_by"],
    order: ["created_at", "id"],
    softDelete: "deleted_at",
  },
  {
    key: "hitlist",
    table: "lead_hitlist",
    about: "The HitList: leads an admin starred as priority targets. priority = stars, 1 (low) to 5 (top).",
    columns: cols("lead_id:s,priority:n,added_by:s,created_at:t,updated_at:t"),
    canRead: any("hitlist.view"),
    via: "rls",
    leadColumn: "lead_id",
    userColumns: ["added_by"],
    order: ["lead_id"],
  },
  {
    key: "follow_ups",
    table: "lead_follow_ups",
    about: "Every follow-up call logged on a lead: the outcome (fu_status), comments, the next follow-up set, and any status change.",
    columns: cols("id:s,lead_id:s,user_id:s,fu_status:s,comments:s,next_follow_up_time:t,is_specific_time:b,status_change:s,created_at:t"),
    canRead: any("leads.view"),
    via: "rls",
    leadColumn: "lead_id",
    userColumns: ["user_id"],
    order: ["created_at", "id"],
  },
  {
    key: "status_history",
    table: "lead_status_events",
    about: "Every lead status change: from_status → to_status, who, when, and from where (source).",
    columns: cols("id:s,lead_id:s,from_status:s,to_status:s,changed_by:s,changed_at:t,source:s"),
    canRead: any("leads.view"),
    via: "service",
    leadColumn: "lead_id",
    userColumns: ["changed_by"],
    order: ["changed_at", "id"],
  },
  {
    key: "tickets",
    table: "lead_tickets",
    about: "Website change tickets on leads: category, priority, status, who opened / is assigned / resolved it, due and resolved dates.",
    columns: cols(
      "id:s,lead_id:s,title:s,category:s,priority:s,status:s,created_by:s,assigned_to:s,resolved_by:s,resolution_note:s,due_date:t,escalated_at:t,resolved_at:t,created_at:t,updated_at:t",
    ),
    canRead: any("tickets.view"),
    via: "rls",
    leadColumn: "lead_id",
    userColumns: ["created_by", "assigned_to", "resolved_by"],
    order: ["created_at", "id"],
  },
  {
    key: "ticket_items",
    table: "ticket_items",
    about: "The individual changes asked for inside a ticket (ticket_id), and whether each is done.",
    columns: cols("id:s,ticket_id:s,body:s,is_done:b,done_at:t,done_by:s,sort:n,created_at:t"),
    canRead: any("tickets.view"),
    via: "rls",
    userColumns: ["done_by"],
    order: ["created_at", "id"],
  },
  {
    key: "contracts",
    table: "contracts",
    about: "Contracts sent to clients: one-time and yearly price, status, when sent, to whom, payment plan.",
    columns: cols(
      "id:s,lead_id:s,business_name:s,status:s,one_time_price:n,yearly_price:n,agent_name:s,contract_date:t,recipient_email:s,sent_at:t,payment_plan:j,created_by:s,created_at:t,edited_at:t",
    ),
    canRead: any("contracts.view", "contracts.send"),
    via: "rls",
    leadColumn: "lead_id",
    userColumns: ["created_by"],
    order: ["created_at", "id"],
  },
  {
    key: "receipts",
    table: "lead_receipts",
    about: "Payment receipts issued to clients: receipt number, items, subtotal, discount, tax, total, paid date, payment method.",
    columns: cols(
      "id:s,lead_id:s,receipt_no:s,bill_to_name:s,bill_to_business:s,bill_to_email:s,project_title:s,items:j,subtotal:n,discount:n,tax_rate:n,tax_amount:n,total:n,currency:s,paid_on:t,payment_method:s,payment_reference:s,sent_to:s,sent_at:t,created_by:s,sent_by:s,created_at:t",
    ),
    canRead: any("receipts.send", "payments.view", "payments.manage"),
    via: "service",
    leadColumn: "lead_id",
    userColumns: ["created_by", "sent_by"],
    order: ["created_at", "id"],
  },
  {
    key: "payment_links",
    table: "payment_links",
    about: "The company's saved payment links (label, amount, category, provider, active).",
    columns: cols("id:s,label:s,amount:n,currency:s,category:s,url:s,notes:s,provider:s,is_active:b,created_by:s,created_at:t,updated_at:t"),
    canRead: any("payments.view", "payments.manage"),
    via: "rls",
    userColumns: ["created_by"],
    order: ["created_at", "id"],
  },
  {
    key: "pre_leads",
    table: "pre_leads",
    about: "Pre-leads: businesses an agent is warming up before they become a full lead.",
    columns: cols(
      "id:s,agent_id:s,business_name:s,phone_number:s,email:s,owner_name:s,google_yelp_link:s,areas:j,services:j,service_offered:s,service_type:s,pricing:n,lead_category:s,status:s,follow_up_time:t,comments:s,last_updated_by:s,created_at:t,updated_at:t,deleted_at:t",
    ),
    canRead: any("pre_leads.view"),
    via: "rls",
    userColumns: ["agent_id", "last_updated_by"],
    order: ["created_at", "id"],
    softDelete: "deleted_at",
  },
  {
    key: "forms",
    table: "form_endpoints",
    about: "Contact-form endpoints set up on clients' websites (Form Relay): name, where submissions are emailed, daily limit, status.",
    columns: cols("id:s,lead_id:s,name:s,to_emails:j,subject_template:s,daily_limit:n,status:s,created_by:s,created_at:t,updated_at:t"),
    canRead: any("forms.view", "forms.manage"),
    via: "service",
    leadColumn: "lead_id",
    userColumns: ["created_by"],
    order: ["created_at", "id"],
  },
  {
    key: "form_submissions",
    table: "form_submissions",
    about: "Messages visitors sent through clients' website contact forms: who, the message, spam or not, delivery status.",
    columns: cols(
      "id:s,endpoint_id:s,lead_id:s,subject:s,submitter_name:s,submitter_email:s,payload:j,origin:s,is_spam:b,spam_reason:s,delivery_status:s,delivered_at:t,read_at:t,created_at:t",
    ),
    canRead: any("forms.view", "forms.manage"),
    via: "rls",
    leadColumn: "lead_id",
    order: ["created_at", "id"],
  },
  {
    key: "domains",
    table: "client_domains",
    about: "Clients' domains: registrar, status and setup step, costs (cents), renewal and expiry dates, health.",
    columns: cols(
      "id:s,domain:s,lead_id:s,registrar:s,origin:s,status:s,step:s,last_error:s,registration_cost_cents:n,renewal_cost_cents:n,currency:s,auto_renew:b,registrar_status:s,registered_at:t,expires_at:t,next_billing_at:t,purchased_by:s,purchased_at:t,health_state:s,health_checked_at:t,created_by:s,created_at:t,updated_at:t",
    ),
    canRead: any("domains.view", "domains.manage", "domains.purchase"),
    via: "service",
    leadColumn: "lead_id",
    userColumns: ["purchased_by", "created_by"],
    order: ["created_at", "id"],
  },
  {
    key: "domain_checks",
    table: "lead_domain_checks",
    about: "The exact-.com availability check on each lead: the domain, available or not, price (cents).",
    columns: cols("lead_id:s,domain:s,available:b,reason:s,registration_cents:n,renewal_cents:n,currency:s,registrar:s,error:s,checked_at:t"),
    canRead: any("domains.view", "domains.manage", "domains.purchase"),
    via: "service",
    leadColumn: "lead_id",
    order: ["lead_id"],
  },
  {
    key: "websites",
    table: "studio_deployments",
    about: "Every website deployed on the hosting: subdomain, url, status (live / taken_down / failed), how it got there (origin), when.",
    columns: cols("id:s,lead_id:s,subdomain:s,url:s,status:s,origin:s,deployed_by:s,deployed_at:t,taken_down_at:t,created_at:t,updated_at:t"),
    canRead: any("tickets.resolve", "studio.manage", "templates.deploy"),
    via: "service",
    leadColumn: "lead_id",
    userColumns: ["deployed_by"],
    order: ["created_at", "id"],
  },
  {
    key: "site_builds",
    table: "builder_runs",
    about: "Site Builder runs: the template, status, the deployed url, errors, who started it.",
    columns: cols("id:s,lead_id:s,template_id:s,status:s,deployed_url:s,error:s,created_by:s,created_at:t,updated_at:t"),
    canRead: any("tickets.resolve", "studio.manage", "templates.generate", "templates.deploy"),
    via: "service",
    leadColumn: "lead_id",
    userColumns: ["created_by"],
    order: ["created_at", "id"],
  },
  {
    key: "template_generations",
    table: "template_generations",
    about: "Template-engine website generations: status, step, pages built, time and cost, deployed url.",
    columns: cols(
      "id:s,lead_id:s,template_id:s,tool:s,model:s,status:s,current_step:s,pages_built:n,images_used:n,total_ms:n,tokens_used:n,cost_usd:n,deployed_url:s,error:s,created_by:s,created_at:t,updated_at:t",
    ),
    canRead: any("templates.generate", "templates.manage", "templates.deploy", "studio.manage"),
    via: "service",
    leadColumn: "lead_id",
    userColumns: ["created_by"],
    order: ["created_at", "id"],
  },
  {
    key: "ai_developer_runs",
    table: "site_agent_runs",
    about: "AI developer runs on clients' websites: the site, the task, status, summary of what it changed, errors.",
    columns: cols("id:s,ticket_id:s,lead_id:s,site_host:s,status:s,task_text:s,summary:s,error:s,model:s,created_by:s,created_at:t,updated_at:t"),
    canRead: DEVELOPERS,
    via: "service",
    leadColumn: "lead_id",
    userColumns: ["created_by"],
    order: ["created_at", "id"],
  },
  {
    key: "sites_in_review",
    table: "lead_site_reviews",
    about: "Websites published and waiting for a developer to finalize them (sales don't see these links yet).",
    columns: cols("lead_id:s,url:s,source:s,published_by:s,published_at:t"),
    canRead: DEVELOPERS,
    via: "rls",
    leadColumn: "lead_id",
    userColumns: ["published_by"],
    order: ["lead_id"],
  },
  {
    key: "tags",
    table: "lead_tags",
    about: "Lead tags (labels people put on leads).",
    columns: cols("id:s,name:s,color:s,owner_id:s,created_by:s,created_at:t"),
    canRead: any("leads.tags.view", "leads.tags.manage"),
    via: "rls",
    userColumns: ["owner_id", "created_by"],
    order: ["created_at", "id"],
  },
  {
    key: "tag_links",
    table: "lead_tag_links",
    about: "Which tag (tag_id) is on which lead.",
    columns: cols("id:s,lead_id:s,tag_id:s,added_by:s,added_at:t"),
    canRead: any("leads.tags.view", "leads.tags.manage"),
    via: "rls",
    leadColumn: "lead_id",
    userColumns: ["added_by"],
    order: ["added_at", "id"],
  },
  {
    key: "closer_teams",
    table: "closer_assignments",
    about: "Which sales agent (agent_id) reports to which closer (closer_id).",
    columns: cols("agent_id:s,closer_id:s,assigned_by:s,created_at:t"),
    canRead: any("leads.view"),
    via: "rls",
    userColumns: ["agent_id", "closer_id", "assigned_by"],
    order: ["agent_id", "closer_id"],
  },
  {
    key: "people",
    table: "profiles",
    about: "Everyone with an account: name, username, email, active or not, joined when.",
    columns: cols("id:s,display_name:s,full_name:s,username:s,email:s,is_active:b,created_at:t"),
    canRead: everyone,
    via: "rls",
    order: ["created_at", "id"],
  },
  {
    key: "departments",
    table: "departments",
    about: "The company's departments (Admin, Sales, Closing, Tech…).",
    columns: cols("id:s,name:s,slug:s,description:s,is_active:b,created_at:t"),
    canRead: everyone,
    via: "rls",
    order: ["created_at", "id"],
  },
  {
    key: "department_members",
    table: "department_members",
    about: "Who is in which department (department_id), and their role there.",
    columns: cols("id:s,user_id:s,department_id:s,dept_role:s,added_at:t"),
    canRead: everyone,
    via: "rls",
    userColumns: ["user_id"],
    order: ["added_at", "id"],
  },
  {
    key: "activity_log",
    table: "activity_log",
    about: "The audit trail: every change anyone made (action, what it was on, old and new values, when).",
    columns: cols("id:s,user_id:s,action:s,entity_type:s,entity_id:s,old_value:j,new_value:j,created_at:t"),
    canRead: any("admin.logs.view"),
    via: "service",
    userColumns: ["user_id"],
    order: ["created_at", "id"],
  },
  {
    key: "sign_ins",
    table: "user_sessions",
    about: "Sign-in sessions: when each person signed in and out, last seen, and why the session ended (attendance).",
    columns: cols("id:s,user_id:s,signed_in_at:t,signed_out_at:t,last_seen_at:t,end_reason:s,created_at:t"),
    canRead: any("admin.logs.view"),
    via: "service",
    userColumns: ["user_id"],
    order: ["signed_in_at", "id"],
  },
  {
    key: "app_usage",
    table: "user_activity",
    about: "App usage: which pages and features each person opened, and when.",
    columns: cols("id:s,user_id:s,type:s,path:s,label:s,created_at:t"),
    canRead: any("admin.logs.view"),
    via: "service",
    userColumns: ["user_id"],
    order: ["created_at", "id"],
  },
  {
    key: "notifications",
    table: "notifications",
    about: "Notifications sent (the bell): event, title, body, lead, read or not. A person sees their own; admins see everyone's.",
    columns: cols("id:s,user_id:s,event_key:s,lead_id:s,title:s,body:s,bell:s,target_url:s,read_at:t,created_at:t"),
    canRead: everyone,
    via: "rls",
    leadColumn: "lead_id",
    leadScoped: false,
    userColumns: ["user_id"],
    order: ["created_at", "id"],
  },
  {
    key: "feedback",
    table: "feedback",
    about: "Bug reports and suggestions people sent about the app, and how they were resolved.",
    columns: cols("id:s,user_id:s,type:s,title:s,description:s,status:s,resolution_note:s,resolved_by:s,resolved_at:t,created_at:t"),
    canRead: everyone,
    via: "rls",
    userColumns: ["user_id", "resolved_by"],
    order: ["created_at", "id"],
  },
  {
    key: "logo_generations",
    table: "lead_logo_generations",
    about: "AI logo designs made for leads: status, the text, which design was accepted.",
    columns: cols("id:s,lead_id:s,user_id:s,mode:s,logo_text:s,instructions:s,status:s,stage:s,images_drawn:n,accepted_index:n,accepted_url:s,accepted_at:t,error:s,created_at:t"),
    canRead: any("leads.view"),
    via: "rls",
    leadColumn: "lead_id",
    userColumns: ["user_id"],
    order: ["created_at", "id"],
  },
  {
    key: "email_checks",
    table: "email_verifications",
    about: "Email address checks: the verdict (valid / invalid / risky) and why.",
    columns: cols("id:s,normalized_email:s,domain:s,provider:s,provider_status:s,verdict:s,reasons:j,verified_at:t,created_by:s"),
    canRead: any("leads.view"),
    via: "rls",
    userColumns: ["created_by"],
    order: ["verified_at", "id"],
  },
  {
    key: "website_inquiries",
    table: "website_leads",
    about: "Inquiries from the company's own website: name, contact, service and tier wanted, coupon, UTM source, status.",
    columns: cols(
      "id:s,name:s,email:s,phone:s,message:s,service_slug:s,tier_name:s,coupon:s,coupon_valid:b,source_page:s,referrer:s,utm_source:s,utm_medium:s,utm_campaign:s,is_spam:b,status:s,notes:s,assigned_to:s,contacted_at:t,submitted_at:t,created_at:t",
    ),
    canRead: any("website.view", "website.manage"),
    via: "service",
    userColumns: ["assigned_to"],
    order: ["created_at", "id"],
  },
  {
    key: "website_services",
    table: "website_services",
    about: "Services and price tiers offered on the company's own website.",
    columns: cols("id:s,slug:s,name:s,tagline:s,tiers:j,quote_based:b,starting_at:s,active:b,sort_order:n,updated_at:t"),
    canRead: any("website.view", "website.manage"),
    via: "service",
    order: ["sort_order", "id"],
  },
  {
    key: "website_portfolio",
    table: "website_portfolio",
    about: "Client sites shown in the company website's portfolio.",
    columns: cols("id:s,client_name:s,industry:s,state:s,live_url:s,featured:b,active:b,created_at:t"),
    canRead: any("website.view", "website.manage"),
    via: "service",
    order: ["created_at", "id"],
  },
  {
    key: "website_testimonials",
    table: "website_testimonials",
    about: "Client testimonials on the company website: quote, rating, approved.",
    columns: cols("id:s,client_name:s,business:s,quote:s,rating:n,approved:b,created_at:t"),
    canRead: any("website.view", "website.manage"),
    via: "service",
    order: ["created_at", "id"],
  },
  {
    key: "website_coupons",
    table: "website_coupons",
    about: "Discount coupons on the company website: code, type, amount, active, expiry.",
    columns: cols("id:s,code:s,label:s,discount_type:s,amount:n,service_slugs:j,active:b,expires_at:t,created_at:t"),
    canRead: any("website.view", "website.manage"),
    via: "service",
    order: ["created_at", "id"],
  },
  {
    key: "add_ons",
    table: "website_addons",
    about: "Website add-ons sold with a site, and their prices.",
    columns: cols("id:s,label:s,price:n,is_active:b,sort:n,created_at:t"),
    canRead: everyone,
    via: "rls",
    order: ["sort", "id"],
  },
  {
    key: "assistant_actions",
    table: "assistant_actions",
    about: "Changes SED AI prepared or made: which action, status (proposed / done / failed / cancelled), when. A person sees their own; admins see everyone's.",
    columns: cols("id:s,user_id:s,action_key:s,title:s,risk:s,status:s,source:s,error:s,created_at:t,executed_at:t"),
    canRead: everyone,
    via: "rls",
    userColumns: ["user_id"],
    order: ["created_at", "id"],
  },
  {
    key: "cms_links",
    table: "sedcms_links",
    about: "Leads whose website is connected to SED CMS: the site host, when linked or revoked.",
    columns: cols("id:s,lead_id:s,host:s,linked_by:s,linked_at:t,revoked_at:t,revoked_by:s"),
    canRead: DEVELOPERS,
    via: "service",
    leadColumn: "lead_id",
    userColumns: ["linked_by", "revoked_by"],
    order: ["linked_at", "id"],
  },
];

export const DATASET_KEYS = DATASETS.map((d) => d.key);

/** May this person's assistant read it? Admins read everything. */
export function canReadDataset(d: Dataset, a: DatasetAccess): boolean {
  return a.isAdmin || d.canRead(a.perms);
}

/** The datasets this person's assistant may read. */
export function readableDatasets(a: DatasetAccess): Dataset[] {
  return DATASETS.filter((d) => canReadDataset(d, a));
}

export function findDataset(key: string): Dataset | undefined {
  const k = key.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return DATASETS.find((d) => d.key === k || d.table === k);
}

/** The columns that may be selected (secrets never, whatever the entry says). */
export function readableColumns(d: Dataset): string[] {
  return Object.keys(d.columns).filter((c) => !SECRET_COLUMN.test(c));
}
