import type { SupabaseClient } from "@supabase/supabase-js";
import { allowedFormScope, endpointInScope, submissionInScope } from "@/lib/forms/access";
import { allowedTicketScope, canActOnTicket } from "@/lib/tickets/scope";
import { ActionFailure } from "./errors";
import type { ActionContext, RefKind } from "./types";

/**
 * Finding the record a person means — "Jumbo's", "Sara", "jumbospizza.com" —
 * for an action field that points at one. SERVER ONLY.
 *
 * People name things; actions need ids. Each kind below knows its table, how
 * to fetch one by id, how to search by what people call it, and how to label
 * it so the card says exactly which record will change. One clear match is
 * used; several come back as a question ("Jumbo's Pizza (Sam) or Jumbo's
 * Grill (Ali)?"); none is said plainly.
 *
 * VISIBILITY. Leads, pre-leads, tags and notifications are read through the
 * person's own client, so a record they cannot open cannot be named either.
 * Everything else is read with the service role — as the screens for those
 * records (domains, mailboxes, deployments…) do — behind the same rules those
 * screens apply: `gate` is the permission(s) that open the screen at all, and
 * `visible` the row rule (Tickets' scope, Forms' lead scope, own mailbox).
 * Without them a record can't be named or found, so nobody learns through
 * SED AI what the app would not show them.
 */

export interface RefHit {
  id: string;
  label: string;
  /** "Ready · Sam" — what tells two similar names apart. */
  detail?: string;
  href?: string;
}

export type RefResult = { ok: true; hit: RefHit } | { ok: false; message: string; choices?: string[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s.trim());
/** The same test without narrowing (for a string that may also be something else). */
export const looksLikeUuid = (s: string): boolean => UUID_RE.test(s.trim());

/** Escape a search term for PostgREST ilike (its own wildcards and the or() syntax). */
export function likeTerm(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()]/g, " ").trim();
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type Row = Record<string, unknown>;

interface KindSpec {
  noun: string;
  /** Rows matching an id. */
  byId: (ctx: ActionContext, id: string) => Promise<Row | null>;
  /** Up to ~8 rows matching a name. */
  search: (ctx: ActionContext, q: string, filter?: string) => Promise<Row[]>;
  hit: (row: Row, ctx: ActionContext) => RefHit | Promise<RefHit>;
  /** The text a name is compared with for an exact match. */
  name: (row: Row) => string;
  /** Can this person use this record at all (beyond what the query enforces)? */
  visible?: (row: Row, ctx: ActionContext) => Promise<boolean>;
  /** Permissions that open these records' screen — one is needed to look them up at all. */
  gate?: readonly string[];
}

/** The scope rules, worked out once per context object. */
const ticketScopes = new WeakMap<ActionContext, ReturnType<typeof allowedTicketScope>>();
function ticketScope(ctx: ActionContext) {
  let s = ticketScopes.get(ctx);
  if (!s) ticketScopes.set(ctx, (s = allowedTicketScope(ctx.admin, ctx.userId, ctx.perms)));
  return s;
}
const formScopes = new WeakMap<ActionContext, ReturnType<typeof allowedFormScope>>();
function formScope(ctx: ActionContext) {
  let s = formScopes.get(ctx);
  if (!s) formScopes.set(ctx, (s = allowedFormScope(ctx.admin, ctx.userId, ctx.perms)));
  return s;
}

type TicketRow = { created_by: string | null; lead_id: string; assigned_to: string | null };
async function ticketVisible(ticket: Row | null, ctx: ActionContext): Promise<boolean> {
  return Boolean(ticket) && canActOnTicket(ticket as TicketRow, ctx.userId, await ticketScope(ctx));
}

const TICKETS = ["tickets.view", "tickets.view_all"] as const;
const WEBSITE = ["website.view", "website.manage"] as const;
const FORMS = ["forms.view", "forms.manage"] as const;

async function one(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Row | null> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as Row | null) ?? null;
}

async function many(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Row[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as Row[] | null) ?? [];
}

/** Display names, cached per context object. */
const nameCache = new WeakMap<ActionContext, Map<string, string>>();
async function personName(ctx: ActionContext, id: unknown): Promise<string | null> {
  if (typeof id !== "string" || !id) return null;
  let cache = nameCache.get(ctx);
  if (!cache) nameCache.set(ctx, (cache = new Map()));
  if (cache.has(id)) return cache.get(id)!;
  const row = await one(ctx.admin.from("profiles").select("display_name, email").eq("id", id).maybeSingle());
  const name = ((row?.display_name as string | null) || (row?.email as string | null) || "").trim() || null;
  if (name) cache.set(id, name);
  return name;
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

const leadCols = "id, business_name, status, agent_id, business_phone";

async function leadsByName(db: SupabaseClient, q: string): Promise<Row[]> {
  const digits = q.replace(/\D/g, "");
  const rows = await many(
    db.from("leads").select(leadCols).is("deleted_at", null).ilike("business_name", `%${likeTerm(q)}%`).order("updated_at", { ascending: false }).limit(8),
  );
  if (rows.length || digits.length < 7) return rows;
  // A phone number: the stored form is "(252) 401-2775".
  const last = digits.slice(-10);
  const pretty = last.length === 10 ? `(${last.slice(0, 3)}) ${last.slice(3, 6)}-${last.slice(6)}` : null;
  return pretty ? many(db.from("leads").select(leadCols).is("deleted_at", null).eq("business_phone", pretty).limit(8)) : [];
}

const KINDS: Record<RefKind, KindSpec> = {
  lead: {
    noun: "lead",
    byId: (ctx, id) => one(ctx.db.from("leads").select(leadCols).eq("id", id).is("deleted_at", null).maybeSingle()),
    search: (ctx, q) => leadsByName(ctx.db, q),
    name: (r) => str(r.business_name),
    hit: async (r, ctx) => {
      const agent = await personName(ctx, r.agent_id);
      return { id: str(r.id), label: str(r.business_name), detail: [r.status, agent].filter(Boolean).join(" · "), href: `/leads/${r.id}` };
    },
  },
  pre_lead: {
    noun: "pre-lead",
    byId: (ctx, id) => one(ctx.db.from("pre_leads").select("id, business_name, status, agent_id").eq("id", id).is("deleted_at", null).maybeSingle()),
    search: (ctx, q) =>
      many(ctx.db.from("pre_leads").select("id, business_name, status, agent_id").is("deleted_at", null).ilike("business_name", `%${likeTerm(q)}%`).limit(8)),
    name: (r) => str(r.business_name),
    hit: async (r, ctx) => ({
      id: str(r.id),
      label: str(r.business_name),
      detail: [r.status, await personName(ctx, r.agent_id)].filter(Boolean).join(" · "),
      href: `/pre-leads/${r.id}`,
    }),
  },
  ticket: {
    noun: "ticket",
    byId: (ctx, id) => one(ctx.admin.from("lead_tickets").select("id, title, status, lead_id, created_by, assigned_to, leads(business_name)").eq("id", id).maybeSingle()),
    search: async (ctx, q) => {
      const term = likeTerm(q);
      const byTitle = await many(
        ctx.admin.from("lead_tickets").select("id, title, status, lead_id, created_by, assigned_to, leads(business_name)").ilike("title", `%${term}%`).order("created_at", { ascending: false }).limit(8),
      );
      // "the ticket on Jumbo's": tickets of leads with that name.
      const leads = await many(ctx.admin.from("leads").select("id").is("deleted_at", null).ilike("business_name", `%${term}%`).limit(20));
      const byLead = leads.length
        ? await many(
            ctx.admin
              .from("lead_tickets")
              .select("id, title, status, lead_id, created_by, assigned_to, leads(business_name)")
              .in("lead_id", leads.map((l) => l.id as string))
              .neq("status", "Resolved")
              .order("created_at", { ascending: false })
              .limit(8),
          )
        : [];
      const seen = new Set<string>();
      return [...byTitle, ...byLead].filter((r) => !seen.has(str(r.id)) && seen.add(str(r.id)));
    },
    name: (r) => str(r.title),
    gate: TICKETS,
    visible: (r, ctx) => ticketVisible(r, ctx),
    hit: (r) => {
      const lead = r.leads as { business_name?: string } | { business_name?: string }[] | null;
      const business = Array.isArray(lead) ? lead[0]?.business_name : lead?.business_name;
      return { id: str(r.id), label: str(r.title) || `Ticket on ${business ?? "a lead"}`, detail: [r.status, business].filter(Boolean).join(" · "), href: `/tickets/${r.id}` };
    },
  },
  ticket_item: {
    noun: "ticket item",
    byId: (ctx, id) => one(ctx.admin.from("ticket_items").select("id, body, ticket_id, is_done").eq("id", id).maybeSingle()),
    search: async () => [],
    name: (r) => str(r.body),
    gate: TICKETS,
    // An item is as visible as its ticket.
    visible: async (r, ctx) => ticketVisible(await one(ctx.admin.from("lead_tickets").select("id, created_by, lead_id, assigned_to").eq("id", str(r.ticket_id)).maybeSingle()), ctx),
    hit: (r) => ({ id: str(r.id), label: str(r.body).slice(0, 80), detail: r.is_done ? "Done" : "Open", href: `/tickets/${r.ticket_id}` }),
  },
  user: {
    noun: "person",
    byId: (ctx, id) => one(ctx.admin.from("profiles").select("id, display_name, email, username, is_active").eq("id", id).maybeSingle()),
    search: async (ctx, q, filter) => {
      const term = likeTerm(q);
      let rows = await many(
        ctx.admin
          .from("profiles")
          .select("id, display_name, email, username, is_active")
          .or(`display_name.ilike.%${term}%,email.ilike.%${term}%,username.ilike.%${term}%,full_name.ilike.%${term}%`)
          .limit(12),
      );
      if (filter === "active") rows = rows.filter((r) => r.is_active !== false);
      if (filter?.startsWith("dept:")) {
        const slug = filter.slice(5);
        const { data: dept } = await ctx.admin.from("departments").select("id").eq("slug", slug).maybeSingle();
        if (dept) {
          const members = await many(ctx.admin.from("department_members").select("user_id").eq("department_id", (dept as Row).id as string));
          const ids = new Set(members.map((m) => m.user_id as string));
          rows = rows.filter((r) => ids.has(str(r.id)));
        }
      }
      return rows;
    },
    name: (r) => str(r.display_name || r.email),
    // Colleagues' names are on every screen; their email addresses only on the user admin's.
    hit: (r, ctx) => ({
      id: str(r.id),
      label: str(r.display_name || r.email),
      detail: [ctx.perms.has("admin.users.view") ? r.email : null, r.is_active === false ? "deactivated" : null].filter(Boolean).join(" · "),
    }),
  },
  department: {
    noun: "department",
    byId: (ctx, id) => one(ctx.admin.from("departments").select("id, name, slug").eq("id", id).maybeSingle()),
    search: (ctx, q) => many(ctx.admin.from("departments").select("id, name, slug").or(`name.ilike.%${likeTerm(q)}%,slug.ilike.%${likeTerm(q)}%`).limit(8)),
    name: (r) => str(r.name),
    hit: (r) => ({ id: str(r.id), label: str(r.name), detail: str(r.slug) }),
  },
  tag: {
    noun: "tag",
    byId: (ctx, id) => one(ctx.db.from("lead_tags").select("id, name, color").eq("id", id).maybeSingle()),
    search: (ctx, q) => many(ctx.db.from("lead_tags").select("id, name, color").ilike("name", `%${likeTerm(q)}%`).limit(8)),
    name: (r) => str(r.name),
    hit: (r) => ({ id: str(r.id), label: str(r.name), detail: str(r.color) }),
  },
  builder_template: {
    noun: "Site Builder template",
    byId: (ctx, id) => one(ctx.admin.from("builder_templates").select("id, name").eq("id", id).maybeSingle()),
    search: (ctx, q) => many(ctx.admin.from("builder_templates").select("id, name").ilike("name", `%${likeTerm(q)}%`).limit(8)),
    name: (r) => str(r.name),
    // The catalogue is picked from on the lead form as well as in the Studio.
    gate: ["studio.manage", "leads.create", "leads.edit"],
    hit: (r) => ({ id: str(r.id), label: str(r.name) }),
  },
  site_run: {
    noun: "Site Builder run",
    byId: (ctx, id) => one(ctx.admin.from("builder_runs").select("id, status, lead_id, created_at, leads(business_name)").eq("id", id).maybeSingle()),
    search: async (ctx, q) => {
      const leads = await many(ctx.admin.from("leads").select("id").is("deleted_at", null).ilike("business_name", `%${likeTerm(q)}%`).limit(20));
      if (!leads.length) return [];
      return many(
        ctx.admin
          .from("builder_runs")
          .select("id, status, lead_id, created_at, leads(business_name)")
          .in("lead_id", leads.map((l) => l.id as string))
          .order("created_at", { ascending: false })
          .limit(8),
      );
    },
    name: (r) => joinedName(r),
    gate: ["studio.manage"],
    hit: (r) => ({ id: str(r.id), label: `${joinedName(r) || "Run"} — ${str(r.status)}`, detail: shortDate(r.created_at), href: `/ai-tools/site-builder/runs/${r.id}` }),
  },
  agent_run: {
    noun: "AI developer run",
    byId: (ctx, id) => one(ctx.admin.from("site_agent_runs").select("id, status, lead_id, ticket_id, site_host, created_at, created_by, leads(business_name)").eq("id", id).maybeSingle()),
    search: async (ctx, q) => {
      const term = likeTerm(q);
      const leads = await many(ctx.admin.from("leads").select("id").is("deleted_at", null).ilike("business_name", `%${term}%`).limit(20));
      const byLead = leads.length
        ? await many(
            ctx.admin
              .from("site_agent_runs")
              .select("id, status, lead_id, ticket_id, site_host, created_at, created_by, leads(business_name)")
              .in("lead_id", leads.map((l) => l.id as string))
              .order("created_at", { ascending: false })
              .limit(8),
          )
        : [];
      if (byLead.length) return byLead;
      return many(
        ctx.admin
          .from("site_agent_runs")
          .select("id, status, lead_id, ticket_id, site_host, created_at, created_by, leads(business_name)")
          .ilike("site_host", `%${term}%`)
          .order("created_at", { ascending: false })
          .limit(8),
      );
    },
    name: (r) => joinedName(r) || str(r.site_host),
    // lib/site-agent/access.ts: Studio managers reach every run; others a
    // run on a ticket within their reach, or one with no ticket.
    gate: ["studio.manage", "tickets.resolve"],
    visible: async (r, ctx) =>
      ctx.perms.has("studio.manage") ||
      !r.ticket_id ||
      ticketVisible(await one(ctx.admin.from("lead_tickets").select("id, created_by, lead_id, assigned_to").eq("id", str(r.ticket_id)).maybeSingle()), ctx),
    hit: (r) => ({
      id: str(r.id),
      label: `${joinedName(r) || str(r.site_host)} — ${str(r.status)}`,
      detail: [str(r.site_host), shortDate(r.created_at)].filter(Boolean).join(" · "),
      href: r.ticket_id ? `/tickets/${r.ticket_id}` : r.lead_id ? `/leads/${r.lead_id}` : undefined,
    }),
  },
  deployment: {
    noun: "website",
    byId: (ctx, id) => one(ctx.admin.from("studio_deployments").select("id, subdomain, url, status, lead_id, leads(business_name)").eq("id", id).maybeSingle()),
    search: async (ctx, q) => {
      const term = likeTerm(q.replace(/^https?:\/\//i, "").replace(/\/.*$/, ""));
      const direct = await many(
        ctx.admin.from("studio_deployments").select("id, subdomain, url, status, lead_id, leads(business_name)").or(`subdomain.ilike.%${term}%,url.ilike.%${term}%`).limit(8),
      );
      if (direct.length) return direct;
      const leads = await many(ctx.admin.from("leads").select("id").is("deleted_at", null).ilike("business_name", `%${likeTerm(q)}%`).limit(20));
      return leads.length
        ? many(ctx.admin.from("studio_deployments").select("id, subdomain, url, status, lead_id, leads(business_name)").in("lead_id", leads.map((l) => l.id as string)).limit(8))
        : [];
    },
    name: (r) => str(r.subdomain),
    // The Deployments board's file tools also serve tech users resolving tickets.
    gate: ["studio.manage", "tickets.resolve"],
    hit: (r) => ({ id: str(r.id), label: str(r.url || r.subdomain), detail: [joinedName(r), r.status].filter(Boolean).join(" · ") }),
  },
  domain: {
    noun: "domain",
    byId: (ctx, id) => one(ctx.admin.from("client_domains").select("id, domain, status, lead_id, leads(business_name)").eq("id", id).maybeSingle()),
    search: (ctx, q) =>
      many(
        ctx.admin
          .from("client_domains")
          .select("id, domain, status, lead_id, leads(business_name)")
          .ilike("domain", `%${likeTerm(q.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))}%`)
          .limit(8),
      ),
    name: (r) => str(r.domain),
    gate: ["domains.view", "domains.manage", "domains.purchase"],
    hit: (r) => ({ id: str(r.id), label: str(r.domain), detail: [joinedName(r), r.status].filter(Boolean).join(" · "), href: `/domains/${r.id}` }),
  },
  mailbox: {
    noun: "mailbox",
    byId: (ctx, id) => one(ctx.admin.from("company_mailboxes").select("id, email_address, display_name, user_id, status").eq("id", id).maybeSingle()),
    search: (ctx, q) =>
      many(
        ctx.admin
          .from("company_mailboxes")
          .select("id, email_address, display_name, user_id, status")
          .or(`email_address.ilike.%${likeTerm(q)}%,display_name.ilike.%${likeTerm(q)}%`)
          .limit(8),
      ),
    name: (r) => str(r.email_address),
    visible: async (r, ctx) => r.user_id === ctx.userId || ctx.perms.has("mail.manage"),
    hit: (r) => ({ id: str(r.id), label: str(r.email_address), detail: [str(r.display_name), str(r.status)].filter(Boolean).join(" · ") }),
  },
  receipt: {
    noun: "receipt",
    byId: (ctx, id) => one(ctx.admin.from("lead_receipts").select("id, receipt_no, total, lead_id, sent_at, leads(business_name)").eq("id", id).maybeSingle()),
    search: async (ctx, q) => {
      const byNo = await many(ctx.admin.from("lead_receipts").select("id, receipt_no, total, lead_id, sent_at, leads(business_name)").ilike("receipt_no", `%${likeTerm(q)}%`).limit(8));
      if (byNo.length) return byNo;
      const leads = await many(ctx.admin.from("leads").select("id").is("deleted_at", null).ilike("business_name", `%${likeTerm(q)}%`).limit(20));
      return leads.length
        ? many(
            ctx.admin
              .from("lead_receipts")
              .select("id, receipt_no, total, lead_id, sent_at, leads(business_name)")
              .in("lead_id", leads.map((l) => l.id as string))
              .order("created_at", { ascending: false })
              .limit(8),
          )
        : [];
    },
    name: (r) => str(r.receipt_no),
    gate: ["receipts.send", "payments.view", "payments.manage"],
    hit: (r) => ({
      id: str(r.id),
      label: `${str(r.receipt_no)} — ${joinedName(r)}`,
      detail: [`$${Number(r.total ?? 0).toLocaleString("en-US")}`, r.sent_at ? "sent" : "not sent"].join(" · "),
      href: `/leads/${r.lead_id}`,
    }),
  },
  contract: {
    noun: "contract",
    byId: (ctx, id) => one(ctx.admin.from("contracts").select("id, business_name, status, lead_id, created_at").eq("id", id).maybeSingle()),
    search: (ctx, q) =>
      many(ctx.admin.from("contracts").select("id, business_name, status, lead_id, created_at").ilike("business_name", `%${likeTerm(q)}%`).order("created_at", { ascending: false }).limit(8)),
    name: (r) => str(r.business_name),
    gate: ["contracts.view", "contracts.send"],
    hit: (r) => ({ id: str(r.id), label: `Contract — ${str(r.business_name)}`, detail: [str(r.status), shortDate(r.created_at)].join(" · "), href: `/contracts` }),
  },
  form_endpoint: {
    noun: "contact form",
    byId: (ctx, id) => one(ctx.admin.from("form_endpoints").select("id, name, status, lead_id").eq("id", id).maybeSingle()),
    search: (ctx, q) => many(ctx.admin.from("form_endpoints").select("id, name, status, lead_id").ilike("name", `%${likeTerm(q)}%`).limit(8)),
    name: (r) => str(r.name),
    gate: FORMS,
    visible: async (r, ctx) => endpointInScope(r as { lead_id: string | null }, await formScope(ctx)),
    hit: (r) => ({ id: str(r.id), label: str(r.name), detail: str(r.status), href: `/forms/endpoints/${r.id}` }),
  },
  form_submission: {
    noun: "form submission",
    byId: (ctx, id) =>
      one(ctx.admin.from("form_submissions").select("id, subject, submitter_name, submitter_email, delivery_status, created_at, lead_id").eq("id", id).maybeSingle()),
    search: (ctx, q) =>
      many(
        ctx.admin
          .from("form_submissions")
          .select("id, subject, submitter_name, submitter_email, delivery_status, created_at, lead_id")
          .or(`submitter_name.ilike.%${likeTerm(q)}%,submitter_email.ilike.%${likeTerm(q)}%,subject.ilike.%${likeTerm(q)}%`)
          .order("created_at", { ascending: false })
          .limit(8),
      ),
    name: (r) => str(r.submitter_name || r.subject),
    gate: FORMS,
    visible: async (r, ctx) => submissionInScope(r as { lead_id: string | null }, await formScope(ctx)),
    hit: (r) => ({
      id: str(r.id),
      label: `${str(r.submitter_name || r.submitter_email || "Submission")} — ${str(r.subject)}`.slice(0, 120),
      detail: [str(r.delivery_status), shortDate(r.created_at)].join(" · "),
      href: `/forms`,
    }),
  },
  website_lead: {
    noun: "website enquiry",
    byId: (ctx, id) => one(ctx.admin.from("website_leads").select("id, name, email, status, submitted_at").eq("id", id).maybeSingle()),
    search: (ctx, q) =>
      many(
        ctx.admin
          .from("website_leads")
          .select("id, name, email, status, submitted_at")
          .or(`name.ilike.%${likeTerm(q)}%,email.ilike.%${likeTerm(q)}%`)
          .order("submitted_at", { ascending: false })
          .limit(8),
      ),
    name: (r) => str(r.name),
    gate: WEBSITE,
    hit: (r) => ({ id: str(r.id), label: str(r.name), detail: [str(r.email), str(r.status)].join(" · "), href: `/website/leads` }),
  },
  coupon: {
    noun: "coupon",
    byId: (ctx, id) => one(ctx.admin.from("website_coupons").select("id, code, label, active").eq("id", id).maybeSingle()),
    search: (ctx, q) => many(ctx.admin.from("website_coupons").select("id, code, label, active").ilike("code", `%${likeTerm(q)}%`).limit(8)),
    name: (r) => str(r.code),
    gate: WEBSITE,
    hit: (r) => ({ id: str(r.id), label: str(r.code), detail: [str(r.label), r.active ? "active" : "inactive"].filter(Boolean).join(" · "), href: `/website/coupons` }),
  },
  notification: {
    noun: "notification",
    byId: (ctx, id) => one(ctx.db.from("notifications").select("id, title, body, read_at").eq("id", id).eq("user_id", ctx.userId).maybeSingle()),
    search: (ctx, q) =>
      many(
        ctx.db
          .from("notifications")
          .select("id, title, body, read_at")
          .eq("user_id", ctx.userId)
          .or(`title.ilike.%${likeTerm(q)}%,body.ilike.%${likeTerm(q)}%`)
          .order("created_at", { ascending: false })
          .limit(8),
      ),
    name: (r) => str(r.title),
    hit: (r) => ({ id: str(r.id), label: str(r.title), detail: str(r.body).slice(0, 80) }),
  },
  upload: {
    noun: "attached file",
    byId: (ctx, id) => one(ctx.admin.from("assistant_uploads").select("id, name, mime, size_bytes, user_id").eq("id", id).eq("user_id", ctx.ownerId ?? ctx.userId).maybeSingle()),
    search: (ctx, q) =>
      many(ctx.admin.from("assistant_uploads").select("id, name, mime, size_bytes, user_id").eq("user_id", ctx.ownerId ?? ctx.userId).ilike("name", `%${likeTerm(q)}%`).order("created_at", { ascending: false }).limit(8)),
    name: (r) => str(r.name),
    hit: (r) => ({ id: str(r.id), label: str(r.name), detail: str(r.mime) }),
  },
  reminder: {
    noun: "reminder",
    byId: (ctx, id) => one(ctx.admin.from("assistant_reminders").select("id, text, remind_at, status").eq("id", id).eq("user_id", ctx.ownerId ?? ctx.userId).maybeSingle()),
    search: (ctx, q) =>
      many(ctx.admin.from("assistant_reminders").select("id, text, remind_at, status").eq("user_id", ctx.ownerId ?? ctx.userId).eq("status", "pending").ilike("text", `%${likeTerm(q)}%`).limit(8)),
    name: (r) => str(r.text),
    hit: (r) => ({ id: str(r.id), label: str(r.text).slice(0, 80), detail: shortDate(r.remind_at) }),
  },
  rule: {
    noun: "standing rule",
    byId: (ctx, id) => one(ctx.admin.from("assistant_rules").select("id, name, enabled").eq("id", id).eq("user_id", ctx.ownerId ?? ctx.userId).maybeSingle()),
    search: (ctx, q) => many(ctx.admin.from("assistant_rules").select("id, name, enabled").eq("user_id", ctx.ownerId ?? ctx.userId).ilike("name", `%${likeTerm(q)}%`).limit(8)),
    name: (r) => str(r.name),
    hit: (r) => ({ id: str(r.id), label: str(r.name), detail: r.enabled ? "on" : "off" }),
  },
  handoff: {
    noun: "handover",
    byId: (ctx, id) => one(ctx.admin.from("assistant_handoffs").select("id, to_agent, ends_at, status, user_id").eq("id", id).eq("user_id", ctx.ownerId ?? ctx.userId).maybeSingle()),
    search: async () => [],
    name: () => "",
    hit: async (r, ctx) => ({ id: str(r.id), label: `Handover to ${(await personName(ctx, r.to_agent)) ?? "someone"}`, detail: `until ${shortDate(r.ends_at)} · ${str(r.status)}` }),
  },
};

function joinedName(r: Row): string {
  const lead = r.leads as { business_name?: string } | { business_name?: string }[] | null | undefined;
  return (Array.isArray(lead) ? lead[0]?.business_name : lead?.business_name) ?? "";
}

function shortDate(v: unknown): string {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : "";
}

export function refNoun(kind: RefKind): string {
  return KINDS[kind].noun;
}

/** Why this person can't look these records up at all, or null when they can. */
export function refBlocked(kind: RefKind, ctx: ActionContext): string | null {
  const spec = KINDS[kind];
  if (!spec.gate || spec.gate.some((p) => ctx.perms.has(p))) return null;
  return `Your account can't see ${spec.noun}s in the app, so SED AI can't look them up for you.`;
}

/**
 * The record `input` names: an id, a name, or {id}/{name}. "me" names the
 * person themselves for user fields.
 */
export async function resolveRef(kind: RefKind, input: unknown, ctx: ActionContext, filter?: string): Promise<RefResult> {
  const spec = KINDS[kind];
  let q: string | null = null;
  if (typeof input === "string" || typeof input === "number") q = String(input).trim();
  else if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    q = typeof o.id === "string" ? o.id : typeof o.name === "string" ? o.name : typeof o.label === "string" ? o.label : null;
  }
  if (!q) return { ok: false, message: `Say which ${spec.noun}.` };
  const blocked = refBlocked(kind, ctx);
  if (blocked) return { ok: false, message: blocked };

  if (kind === "user" && /^(me|myself|i|mine|my)$/i.test(q)) q = ctx.userId;

  const check = async (row: Row | null): Promise<RefResult | null> => {
    if (!row) return null;
    if (spec.visible && !(await spec.visible(row, ctx))) return null;
    return { ok: true, hit: await spec.hit(row, ctx) };
  };

  if (isUuid(q)) {
    const found = await check(await spec.byId(ctx, q.toLowerCase()));
    return found ?? { ok: false, message: `No ${spec.noun} with that id is visible to you.` };
  }

  let rows = await spec.search(ctx, q, filter);
  // "status:review" (or "status:queued|running"): when the name matches several
  // records, the ones in that state are the ones meant — "approve the run on
  // Jumbo's" is the run waiting for review, not last month's.
  if (filter?.startsWith("status:")) {
    const wanted = filter.slice(7).split("|");
    const narrowed = rows.filter((r) => wanted.includes(String(r.status)));
    if (narrowed.length) rows = narrowed;
  }
  if (spec.visible) {
    const keep: Row[] = [];
    for (const r of rows) if (await spec.visible(r, ctx)) keep.push(r);
    rows = keep;
  }
  if (!rows.length) return { ok: false, message: `No ${spec.noun} called "${q}" was found among the ones you can see.` };
  const exact = rows.filter((r) => norm(spec.name(r)) === norm(q!));
  const pick = exact.length === 1 ? exact[0] : rows.length === 1 ? rows[0] : null;
  if (pick) return { ok: true, hit: await spec.hit(pick, ctx) };
  const hits = await Promise.all((exact.length ? exact : rows).slice(0, 6).map((r) => spec.hit(r, ctx)));
  return {
    ok: false,
    message: `"${q}" matches ${exact.length || rows.length} ${spec.noun}s — which one?`,
    choices: hits.map((h) => `${h.label}${h.detail ? ` (${h.detail})` : ""} [id ${h.id}]`),
  };
}

/** Search for the find_records tool: up to `limit` matches, labelled. */
export async function searchRefs(kind: RefKind, q: string, ctx: ActionContext, limit = 8): Promise<RefHit[]> {
  const spec = KINDS[kind];
  const blocked = refBlocked(kind, ctx);
  if (blocked) throw new ActionFailure(blocked, 403);
  if (isUuid(q)) {
    const row = await spec.byId(ctx, q.trim().toLowerCase());
    if (!row || (spec.visible && !(await spec.visible(row, ctx)))) return [];
    return [await spec.hit(row, ctx)];
  }
  const rows = await spec.search(ctx, q);
  const out: RefHit[] = [];
  for (const r of rows) {
    if (out.length >= limit) break;
    if (spec.visible && !(await spec.visible(r, ctx))) continue;
    out.push(await spec.hit(r, ctx));
  }
  return out;
}

export const REF_KINDS = Object.keys(KINDS) as RefKind[];
