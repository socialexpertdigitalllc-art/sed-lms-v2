import { cloudflareConfigured, registrarSandbox } from "@/lib/cloudflare/client";
import { EDITABLE_DNS_TYPES, listDns, validateDns, type DnsInput, type DnsRow } from "@/lib/domains/manage";
import { searchOffers, type DomainOffer } from "@/lib/domains/service";
import { HEALTH_LABELS, type ClientDomainRow, type DomainHealth, type DomainRegistrar } from "@/lib/domains/types";
import { getHostingerForwarding, hostingerConfigured } from "@/lib/hostinger/client";
import { siteHostFrom } from "@/lib/site-studio/deploy/liveFiles";
import { isProtectedDomain } from "@/lib/site-studio/deploy/protected";
import { listSiteSnapshots, snapshotName, type SiteSnapshot } from "@/lib/site-studio/deploy/snapshots";
import { normalizeTargetDomain } from "@/lib/site-studio/deploy/transfer";
import { daConfigured, subFromWebsiteLink } from "@/lib/template-engine/directadmin";
import type { CardChange, CardField } from "../card";
import { formatDateTime } from "../fields";
import { isStepRef, need, str, visibleLead } from "../helpers";
import { callRoute, RouteError } from "../invoke";
import type { ActionContext, ActionDef, Problem, Values } from "../types";

/**
 * Websites & domains actions: check and buy a domain, link a domain or a
 * deployed site to a lead, DNS and forwarding, auto-renew, a health check,
 * and the deployments board's restore, transfer and takedown. Each runs
 * through the endpoint the Domains page or the Deployments board calls, so
 * the routes' own permission checks and safety rules apply unchanged.
 */

const searchRoute = () => import("@/app/api/domains/search/route");
const purchaseRoute = () => import("@/app/api/domains/purchase/route");
const domainRoute = () => import("@/app/api/domains/[id]/route");
const healthRoute = () => import("@/app/api/domains/[id]/health/route");
const dnsRoute = () => import("@/app/api/domains/[id]/dns/route");
const dnsResetRoute = () => import("@/app/api/domains/[id]/dns/reset/route");
const forwardingRoute = () => import("@/app/api/domains/[id]/forwarding/route");
const deploymentRoute = () => import("@/app/api/site-studio/deployments/[id]/route");
const linkRoute = () => import("@/app/api/site-studio/deployments/link/route");
const restoreRoute = () => import("@/app/api/site-studio/deployments/restore/route");
const transferRoute = () => import("@/app/api/site-studio/deployments/[id]/transfer/route");

const domainLink = (id: string) => (isStepRef(id) ? { href: "/domains", label: "Open domains" } : { href: `/domains/${id}`, label: "Open domain" });
const leadLink = (id: string) => ({ href: `/leads/${id}`, label: "Open lead" });
const DOMAINS_LINK = { href: "/domains", label: "Open domains" };
const BOARD_LINK = { href: "/ai-tools/site-builder/deployments", label: "Open deployments" };

/* -------------------------------------------------------------- helpers */

/** Routes that admit any of several permissions: null when one is held, else the first one named. */
function needAny(ctx: ActionContext, ...keys: string[]): string | null {
  return keys.some((k) => ctx.perms.has(k)) ? null : need(ctx, keys[0]);
}

const REGISTRARS = ["Cloudflare", "Hostinger"] as const;
const REGISTRAR_HELP = "Cloudflare (default: at-cost price, cheapest renewals) or Hostinger (when the client needs access to the domain).";
const registrarOf = (v: unknown): DomainRegistrar => (v === "Hostinger" ? "hostinger" : "cloudflare");
const REGISTRAR_NAME: Record<DomainRegistrar, string> = { cloudflare: "Cloudflare", hostinger: "Hostinger" };

/** Integer cents as money: "$10.46". */
export function cents(c: unknown, currency = "USD"): string {
  if (typeof c !== "number" || !Number.isFinite(c)) return "—";
  const amount = (c / 100).toFixed(2);
  return currency === "USD" ? `$${amount}` : `${amount} ${currency}`;
}

type Joined = { business_name?: string | null } | { business_name?: string | null }[] | null | undefined;
const joinedName = (j: Joined): string => (Array.isArray(j) ? j[0]?.business_name : j?.business_name) ?? "";

type DomainRow = ClientDomainRow & { leads?: Joined };

/** A domain as the Domains page reads it (service role, behind the domains permission). */
async function loadDomain(ctx: ActionContext, id: unknown): Promise<DomainRow | null> {
  if (typeof id !== "string" || isStepRef(id)) return null;
  const { data } = await ctx.admin.from("client_domains").select("*, leads(business_name)").eq("id", id).maybeSingle();
  return (data as DomainRow | null) ?? null;
}

interface DeploymentRow {
  id: string;
  lead_id: string | null;
  subdomain: string;
  url: string;
  status: string;
  origin: string | null;
  updated_at: string | null;
  leads?: Joined;
}

/** A deployed site as the Deployments board reads it. */
async function loadDeployment(ctx: ActionContext, id: unknown): Promise<DeploymentRow | null> {
  if (typeof id !== "string" || isStepRef(id)) return null;
  const { data } = await ctx.admin
    .from("studio_deployments")
    .select("id, lead_id, subdomain, url, status, origin, updated_at, leads(business_name)")
    .eq("id", id)
    .maybeSingle();
  return (data as DeploymentRow | null) ?? null;
}

/** A record the person named (not one an earlier plan step will create — that is only known at confirm). */
const named = (v: unknown): v is string => typeof v === "string" && !isStepRef(v);

const hostOf = (url: string) => siteHostFrom(url) ?? url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const daDomain = () => process.env.DA_DOMAIN ?? "";

/** The one other row a lead may hold (one domain per lead, one live site per lead). */
async function firstRow<T>(q: PromiseLike<{ data: unknown }>): Promise<T | null> {
  const { data } = await q;
  return ((data ?? []) as T[])[0] ?? null;
}

/* ------------------------------------------------------------ domain.check */

/** The search route's own refusals for an unconfigured registrar. */
function searchConfigProblem(registrar: DomainRegistrar): string | null {
  if (registrar === "cloudflare" && !cloudflareConfigured()) return "Cloudflare is not configured.";
  if (registrar === "hostinger" && !hostingerConfigured()) return "Hostinger is not configured.";
  return null;
}

function offerLine(o: DomainOffer): string {
  return o.available
    ? `${o.domain} is available on ${REGISTRAR_NAME[o.registrar]}: ${cents(o.registrationCents, o.currency)} for the first year, then ${cents(o.renewalCents, o.currency)} a year.`
    : `${o.domain} can't be bought on ${REGISTRAR_NAME[o.registrar]}: ${o.reason ?? "not available"}.`;
}

const bareDomain = (q: string) => q.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");

const domainCheck: ActionDef = {
  key: "domain.check",
  group: "Websites & domains",
  title: "Check a domain's availability and price",
  description:
    "Look up whether a domain can be bought and what it costs (first year and yearly renewal) — the Buy Domain search, on Cloudflare (default) or Hostinger. Give an exact name (jumbospizza.com) or a phrase (jumbos pizza austin) to get suggestions. Changes nothing; buy with domain.buy.",
  confirmLabel: "Check",
  risk: "standard",
  allowed: (ctx) => need(ctx, "domains.purchase"),
  fields: [
    { name: "query", label: "Domain or name", type: "text", required: true, max: 100, help: "An exact domain (jumbospizza.com) or the business name / a phrase to find names for." },
    { name: "registrar", label: "Registrar", type: "enum", options: REGISTRARS, default: "Cloudflare", help: REGISTRAR_HELP },
  ],
  label: (v) => str(v.query),
  minutesSaved: 2,
  async check(v) {
    const problem = searchConfigProblem(registrarOf(v.registrar));
    return { problems: problem ? [{ field: "registrar", message: problem }] : [] };
  },
  async preview(v) {
    return { title: `Check ${str(v.query)} on ${REGISTRAR_NAME[registrarOf(v.registrar)]}`, notes: ["Only looks it up — nothing is bought."] };
  },
  async execute(v) {
    const registrar = registrarOf(v.registrar);
    // A pasted address ("https://www.jumbos.com/") is looked up as the exact name; a phrase as it is.
    const raw = str(v.query).trim();
    const q = /\s/.test(raw) ? raw : bareDomain(raw);
    const res = await callRoute<{ results?: DomainOffer[] }>(searchRoute, "GET", { path: "/api/domains/search", search: { q, registrar } });
    const offers = res.results ?? [];
    const exact = offers.find((o) => o.domain === q);
    const others = offers.filter((o) => o !== exact && o.available).slice(0, exact ? 5 : 8);
    const lines: string[] = [];
    if (exact) lines.push(offerLine(exact));
    if (others.length) {
      lines.push(
        `${exact ? "Also available" : "Available"}: ${others.map((o) => `${o.domain} (${cents(o.registrationCents, o.currency)} first year, renews ${cents(o.renewalCents, o.currency)})`).join("; ")}.`,
      );
    }
    if (!lines.length) lines.push(`Nothing available for "${str(v.query)}" on ${REGISTRAR_NAME[registrar]} — try another name.`);
    return { message: lines.join(" "), data: { registrar, offers: offers.slice(0, 12) }, undoable: false };
  },
};

/* -------------------------------------------------------------- domain.buy */

const domainBuy: ActionDef = {
  key: "domain.buy",
  group: "Websites & domains",
  title: "Buy a domain",
  description:
    "Buy a domain with the company's payment method — NON-REFUNDABLE — like the Buy Domain dialog. The card shows the exact first-year and renewal price, looked up live; if the price moves before it is confirmed, nothing is bought. For a lead, the domain then sets itself up (DNS, hosting, SSL) and the lead's site goes live on it. Check the name first with domain.check when unsure.",
  confirmLabel: "Buy domain",
  risk: "critical",
  allowed: (ctx) => need(ctx, "domains.purchase"),
  fields: [
    { name: "domain", label: "Domain", type: "text", required: true, max: 253, editable: false, help: "The exact name to buy, e.g. jumbospizza.com." },
    { name: "registrar", label: "Registrar", type: "enum", options: REGISTRARS, default: "Cloudflare", editable: false, help: REGISTRAR_HELP },
    {
      name: "lead",
      label: "For lead",
      type: "ref",
      ref: "lead",
      required: (v) => v.stock !== true,
      showIf: (v) => v.stock !== true,
      editable: false,
      help: "The lead it is for — its site then goes live on the domain automatically. Ask which lead.",
    },
    {
      name: "stock",
      label: "Stock domain (no lead yet)",
      type: "boolean",
      default: false,
      editable: false,
      help: "Yes only when the person says the domain is not for a lead yet (bought to link later).",
    },
  ],
  label: (v) => str(v.__domain || v.domain),
  produces: "domain",
  minutesSaved: 5,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const values: Values = {};
    const registrar = registrarOf(v.registrar);
    const R = REGISTRAR_NAME[registrar];
    // The purchase route's own refusals, in its order (every purchase needs Hostinger: it hosts the site).
    if (registrar === "cloudflare" && !cloudflareConfigured()) problems.push({ field: "registrar", message: "Cloudflare is not configured." });
    else if (!hostingerConfigured()) problems.push({ field: "registrar", message: "Hostinger is not configured." });

    let domain: string | null = null;
    if (typeof v.domain === "string") {
      const target = normalizeTargetDomain(v.domain, daDomain());
      if (!target.ok) problems.push({ field: "domain", message: target.error });
      else {
        domain = target.domain;
        values.__domain = domain;
      }
    }

    if (typeof v.lead === "string" && !isStepRef(v.lead)) {
      const lead = await visibleLead<{ business_name: string }>(ctx, v.lead, "business_name");
      if (!lead) problems.push({ field: "lead", message: "That lead is not visible to you." });
      else values.__lead_name = lead.business_name;
      const has = await firstRow<{ domain: string }>(ctx.admin.from("client_domains").select("domain").eq("lead_id", v.lead).neq("status", "failed").limit(1));
      if (has) problems.push({ field: "lead", message: `This lead already has the domain ${has.domain} — unlink it first.` });
    }

    if (domain) {
      const ours = await firstRow<{ id: string }>(ctx.admin.from("client_domains").select("id").eq("domain", domain).neq("status", "failed").limit(1));
      if (ours) problems.push({ field: "domain", message: `${domain} is already ours (or being bought right now).` });
    }

    // The exact price, read live the way the Buy dialog reads it — the card shows it, and
    // the purchase is refused unless the registrar's price is still exactly this.
    if (domain && !problems.length) {
      const offers = await searchOffers(domain, registrar);
      const offer = offers?.find((o) => o.domain === domain);
      if (!offers || !offer) problems.push({ field: "domain", message: `Could not confirm ${domain}'s availability and price with ${R} — nothing can be bought right now; try again.` });
      else if (!offer.available || offer.registrationCents === null) {
        const alts = offers.filter((o) => o.available && o.domain !== domain && o.registrationCents !== null).slice(0, 3);
        problems.push({
          field: "domain",
          message: `${domain} can't be bought on ${R}: ${offer.reason ?? "no price"}.${alts.length ? ` Available instead: ${alts.map((o) => `${o.domain} (${cents(o.registrationCents, o.currency)})`).join(", ")}.` : ""}`,
          ...(alts.length ? { choices: alts.map((o) => o.domain) } : {}),
        });
      } else {
        values.__cents = offer.registrationCents;
        values.__renew_cents = offer.renewalCents;
        values.__currency = offer.currency;
      }
    }
    return { problems, values };
  },
  async preview(v) {
    const registrar = registrarOf(v.registrar);
    const R = REGISTRAR_NAME[registrar];
    const domain = str(v.__domain);
    const currency = str(v.__currency) || "USD";
    const leadName = str(v.__lead_name);
    const forLead = typeof v.lead === "string";
    const fields: CardField[] = [
      { name: "domain", label: "Domain", value: domain, edit: null },
      { name: "registrar", label: "Registrar", value: R, edit: null },
      { name: "first_year", label: "First year", value: cents(v.__cents, currency), edit: null },
      { name: "renews", label: "Renews at", value: `${cents(v.__renew_cents, currency)} a year, automatically`, edit: null },
      { name: "lead", label: "For", value: forLead ? leadName || "the lead from an earlier step" : "No lead (a stock domain)", edit: null },
    ];
    return {
      title: `Buy ${domain} for ${cents(v.__cents, currency)}${leadName ? ` — for ${leadName}` : ""}`,
      fields,
      warnings: [
        registrar === "cloudflare" && registrarSandbox()
          ? "Test mode: this runs in Cloudflare's sandbox — nothing is charged and the domain won't work on the internet."
          : `This charges the company's payment method on ${R}. Domain purchases can't be refunded or undone.`,
      ],
      notes: [
        forLead
          ? "After the purchase the dashboard sets up DNS, hosting and SSL, and puts the lead's site live on the domain."
          : "It goes to the Domains list — link it to a lead to set it up.",
      ],
      link: forLead && !isStepRef(v.lead) ? leadLink(str(v.lead)) : DOMAINS_LINK,
      confirmPhrase: domain,
      before: { cents: v.__cents, domain, registrar },
    };
  },
  async stale(before, v) {
    const b = (before ?? {}) as { cents?: number };
    if (typeof v.__cents !== "number") return "the price could not be confirmed just now — nothing was bought.";
    if (typeof b.cents === "number" && b.cents !== v.__cents) {
      return `the price changed from ${cents(b.cents)} to ${cents(v.__cents)} since this was proposed — nothing was bought.`;
    }
    return null;
  },
  async execute(v) {
    // Never re-priced here: expectedCents is the price the card showed (stale() refused anything else).
    if (typeof v.__cents !== "number") throw new RouteError("The price could not be confirmed — nothing was bought. Try again.", 409, null);
    const registrar = registrarOf(v.registrar);
    const res = await callRoute<{ domain: { id: string; domain: string; status: string } }>(purchaseRoute, "POST", {
      path: "/api/domains/purchase",
      body: { domain: str(v.__domain) || str(v.domain), registrar, leadId: typeof v.lead === "string" ? v.lead : null, expectedCents: v.__cents },
    });
    const row = res.domain;
    const R = REGISTRAR_NAME[registrar];
    return {
      message:
        `Bought ${row.domain} for ${cents(v.__cents, str(v.__currency) || "USD")} on ${R}.` +
        (typeof v.lead === "string"
          ? ` It now sets itself up for ${str(v.__lead_name) || "the lead"} — DNS, hosting, SSL, then the site goes live on it.`
          : " It is in the Domains list — link it to a lead to set it up.") +
        (row.status === "purchasing" ? ` ${R} is still confirming the registration.` : ""),
      link: domainLink(row.id),
      data: { id: row.id, kind: "domain", cents: v.__cents },
    };
  },
};

/* ---------------------------------------------------------- domain.health */

const domainHealth: ActionDef = {
  key: "domain.health",
  group: "Websites & domains",
  title: "Check a domain's website now",
  description:
    "Run the domain page's health check now: DNS, the SSL certificate and the home page, read as a visitor would. Reports up / down / SSL problem / parked / no DNS. Changes nothing on the site.",
  confirmLabel: "Check now",
  risk: "standard",
  allowed: (ctx) => needAny(ctx, "domains.view", "domains.manage", "domains.purchase"),
  fields: [{ name: "domain", label: "Domain", type: "ref", ref: "domain", required: true, editable: false }],
  label: (v) => str(v.__domain),
  minutesSaved: 1,
  async check(v, ctx) {
    const row = await loadDomain(ctx, v.domain);
    if (named(v.domain) && !row) return { problems: [{ field: "domain", message: "That domain no longer exists." }] };
    return { values: row ? { __domain: row.domain } : {} };
  },
  async preview(v) {
    return {
      title: `Check ${str(v.__domain) || "the new domain"}'s website now`,
      notes: ["Reads DNS, the certificate and the home page — nothing on the site changes. A second failed check in a row alerts admin to the outage."],
      link: domainLink(str(v.domain)),
    };
  },
  async execute(v) {
    const id = str(v.domain);
    const res = await callRoute<{ health: DomainHealth }>(healthRoute, "POST", { path: `/api/domains/${id}/health`, params: { id } });
    const h = res.health;
    const ssl = h.ssl?.valid && h.ssl.valid_to ? ` SSL certificate valid until ${h.ssl.valid_to.slice(0, 10)}.` : "";
    return {
      message: `${str(v.__domain)}: ${HEALTH_LABELS[h.state] ?? h.state} — ${h.summary}.${ssl}`,
      link: domainLink(id),
      data: { id, state: h.state, summary: h.summary, http_status: h.http_status, ms: h.ms },
      undoable: false,
    };
  },
};

/* ------------------------------------------------------- domain.autorenew */

const domainAutorenew: ActionDef = {
  key: "domain.autorenew",
  group: "Websites & domains",
  title: "Turn a domain's auto-renew on or off",
  description:
    "Switch yearly auto-renew on or off at the domain's registrar (the domain page's Auto-renew switch). Off means the domain expires unless someone renews it by hand.",
  confirmLabel: "Change auto-renew",
  risk: "sensitive",
  allowed: (ctx) => need(ctx, "domains.manage"),
  fields: [
    { name: "domain", label: "Domain", type: "ref", ref: "domain", required: true, editable: false },
    { name: "on", label: "Auto-renew", type: "boolean", required: true, help: "Yes = renew automatically every year (charged at the registrar); no = let it expire unless renewed by hand." },
  ],
  label: (v) => str(v.__domain),
  minutesSaved: 1,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const row = await loadDomain(ctx, v.domain);
    if (named(v.domain) && !row) problems.push({ field: "domain", message: "That domain no longer exists." });
    if (!row) return { problems };
    if (typeof v.on === "boolean" && row.auto_renew === v.on) problems.push({ field: "on", message: `Auto-renew is already ${v.on ? "on" : "off"} for ${row.domain}.` });
    if (row.registrar === "hostinger" && !row.hostinger_subscription_id) {
      problems.push({ field: "domain", message: "This domain's Hostinger subscription isn't known yet — press Sync now on the Domains page and try again." });
    }
    return {
      problems,
      values: { __domain: row.domain, __registrar: row.registrar, __expires: row.expires_at, __renew_cents: row.renewal_cost_cents, __currency: row.currency, __was: row.auto_renew },
    };
  },
  async preview(v) {
    const domain = str(v.__domain) || "the domain from an earlier step";
    const was = typeof v.__was === "boolean" ? (v.__was ? "On" : "Off") : "Unknown";
    const R = REGISTRAR_NAME[(v.__registrar as DomainRegistrar) ?? "cloudflare"] ?? "the registrar";
    const expires = typeof v.__expires === "string" ? ` on ${v.__expires.slice(0, 10)}` : "";
    return {
      title: `Turn auto-renew ${v.on ? "on" : "off"} — ${domain}`,
      fields: [],
      changes: [{ label: "Auto-renew", from: was, to: v.on ? "On" : "Off" }],
      warnings: v.on ? [] : [`${domain} expires${expires} unless someone renews it by hand — the client's site and email stop with it.`],
      notes: v.on ? [`It renews every year at ${cents(v.__renew_cents, str(v.__currency) || "USD")}, charged to the company's ${R} account.`] : [`Changed at ${R}.`],
      link: domainLink(str(v.domain)),
      before: { auto_renew: typeof v.__was === "boolean" ? v.__was : null },
    };
  },
  async stale(before, v, ctx) {
    const b = (before ?? {}) as { auto_renew?: boolean | null };
    const row = await loadDomain(ctx, v.domain);
    if (!row) return "the domain no longer exists.";
    return (b.auto_renew ?? null) !== (row.auto_renew ?? null) ? "its auto-renew was changed by someone else in the meantime." : null;
  },
  async execute(v) {
    const id = str(v.domain);
    await callRoute(domainRoute, "PATCH", { path: `/api/domains/${id}`, params: { id }, body: { autoRenew: v.on === true } });
    return { message: `Auto-renew is ${v.on ? "on" : "off"} for ${str(v.__domain)}.`, link: domainLink(id), data: { id } };
  },
  undo: {
    async run(stored) {
      const id = str(stored.input.domain);
      const before = (stored.before_state ?? {}) as { auto_renew?: boolean | null };
      const back = typeof before.auto_renew === "boolean" ? before.auto_renew : stored.input.on !== true;
      await callRoute(domainRoute, "PATCH", { path: `/api/domains/${id}`, params: { id }, body: { autoRenew: back } });
      return `auto-renew is ${back ? "on" : "off"} again.`;
    },
  },
};

/* -------------------------------------------------------------- domain.dns */

const DNS_OPERATIONS = ["Add record", "Change record", "Delete record", "Forward domain", "Stop forwarding", "Reset to defaults"] as const;
const isRecordOp = (v: Values) => v.operation === "Add record" || v.operation === "Change record" || v.operation === "Delete record";
const writesRecord = (v: Values) => v.operation === "Add record" || v.operation === "Change record";
const PROXIABLE = new Set(["A", "AAAA", "CNAME"]);

/** The records that carry the site itself (DomainDnsPanel's own rule) — a wrong value takes it offline. */
const carriesSite = (r: { name: string; type: string }) => ["@", "www"].includes(r.name) && ["A", "AAAA", "CNAME", "ALIAS"].includes(r.type);

/** "www.jumbospizza.com", "jumbospizza.com", "WWW" → the record name as the registrar lists it ("www", "@"). */
export function relativeName(input: unknown, domain: string): string {
  const s = str(input).trim().toLowerCase().replace(/\.$/, "");
  if (!s || s === "@" || s === domain) return "@";
  return s.endsWith(`.${domain}`) ? s.slice(0, -(domain.length + 1)) : s;
}

const sameContent = (a: string, b: string) => {
  const n = (s: string) => s.trim().replace(/^"|"$/g, "").replace(/\.$/, "").toLowerCase();
  return n(a) === n(b);
};

/** New records get the DNS panel's defaults: automatic TTL on Cloudflare, 4 hours on Hostinger. */
const defaultTtl = (registrar: DomainRegistrar) => (registrar === "cloudflare" ? 1 : 14400);

const ttlWords = (t: number) => (t === 1 ? "auto" : t < 3600 ? `${Math.round(t / 60)} min` : t < 86400 ? `${Math.round(t / 3600)} h` : `${Math.round(t / 86400)} d`);

function recordValue(r: { type: string; content: string; ttl: number; priority?: number | null; proxied?: boolean | null }): string {
  return `${r.type === "MX" ? `${r.priority ?? 10} ` : ""}${r.content} (TTL ${ttlWords(r.ttl)}${r.proxied ? ", proxied" : ""})`;
}

const describeRecord = (r: DnsRow) => `${r.type} ${r.name} → ${r.type === "MX" && r.priority !== null ? `${r.priority} ` : ""}${r.content}`;

/** Which field validateDns's message is about. */
function dnsField(message: string): string {
  if (/TTL/i.test(message)) return "ttl";
  if (/priority/i.test(message)) return "priority";
  if (/^Name must/i.test(message)) return "name";
  if (/can't be edited|ALIAS/i.test(message)) return "type";
  return "content";
}

const domainDns: ActionDef = {
  key: "domain.dns",
  group: "Websites & domains",
  title: "Change a domain's DNS or forwarding",
  description:
    "Change a domain's live DNS at its registrar, like the domain page's DNS panel: add, change or delete one record (A, AAAA, CNAME, ALIAS on Hostinger only, MX, TXT, CAA), or — Hostinger domains only — forward the whole domain to another address, stop forwarding, or reset the DNS to Hostinger's defaults. A record is identified by its type and host (@ for the domain itself); when several share both, ask for the current value.",
  confirmLabel: "Change DNS",
  risk: "critical",
  allowed: (ctx) => need(ctx, "domains.manage"),
  fields: [
    { name: "domain", label: "Domain", type: "ref", ref: "domain", required: true, editable: false },
    { name: "operation", label: "Change", type: "enum", options: DNS_OPERATIONS, required: true, editable: false },
    {
      name: "type",
      label: "Record type",
      type: "enum",
      options: EDITABLE_DNS_TYPES,
      required: isRecordOp,
      showIf: isRecordOp,
      editable: false,
      help: "A, AAAA, CNAME, ALIAS (Hostinger only), MX, TXT or CAA. For a change or delete: the existing record's type.",
    },
    { name: "name", label: "Host", type: "text", max: 253, default: "@", showIf: isRecordOp, editable: false, help: "@ for the domain itself (default), or the part before it: www, mail…" },
    {
      name: "content",
      label: "Value",
      type: "text",
      max: 2048,
      required: writesRecord,
      showIf: isRecordOp,
      editable: false,
      help: "Add / change: the new value — an IP address for A, a host name for CNAME/MX, the text for TXT. Delete: only needed when several records share the type and host.",
    },
    {
      name: "old_content",
      label: "Current value",
      type: "text",
      max: 2048,
      showIf: (v) => v.operation === "Change record",
      editable: false,
      help: "Only when several records share this type and host: the current value of the one to change.",
    },
    {
      name: "ttl",
      label: "TTL (seconds)",
      type: "integer",
      min: 1,
      max: 86400,
      showIf: writesRecord,
      editable: false,
      help: "Optional. 1 = automatic (Cloudflare), otherwise 60–86400. A new record gets automatic on Cloudflare and 4 hours on Hostinger; a change keeps the current TTL.",
    },
    {
      name: "priority",
      label: "MX priority",
      type: "integer",
      min: 0,
      max: 65535,
      showIf: (v) => writesRecord(v) && v.type === "MX",
      editable: false,
      help: "MX only. A new record gets 10; a change keeps the current priority.",
    },
    {
      name: "proxied",
      label: "Through Cloudflare's proxy",
      type: "boolean",
      showIf: (v) => writesRecord(v) && typeof v.type === "string" && PROXIABLE.has(v.type),
      editable: false,
      help: "Cloudflare A/AAAA/CNAME only (the orange cloud). A new record is not proxied; a change keeps the current setting.",
    },
    { name: "redirect_url", label: "Forward to", type: "url", required: (v) => v.operation === "Forward domain", showIf: (v) => v.operation === "Forward domain", editable: false },
    {
      name: "redirect_type",
      label: "Redirect",
      type: "enum",
      options: ["301", "302"],
      default: "301",
      showIf: (v) => v.operation === "Forward domain",
      editable: false,
      help: "301 = permanent (default), 302 = temporary.",
    },
  ],
  label: (v) => str(v.__domain),
  minutesSaved: 4,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const values: Values = {};
    const row = await loadDomain(ctx, v.domain);
    if (named(v.domain) && !row) problems.push({ field: "domain", message: "That domain no longer exists." });
    if (!row || typeof v.operation !== "string") return { problems, values: row ? { __domain: row.domain } : {} };
    values.__domain = row.domain;
    const op = v.operation;
    // lib/domains/manage.ts's own refusals.
    if ((op === "Forward domain" || op === "Stop forwarding") && row.registrar !== "hostinger") {
      problems.push({ field: "operation", message: "Forwarding for Cloudflare domains is set up with a redirect rule in Cloudflare, not from here." });
    }
    if (op === "Reset to defaults" && row.registrar !== "hostinger") problems.push({ field: "operation", message: "Only Hostinger zones can be reset to defaults." });
    if (!isRecordOp(v) || typeof v.type !== "string") return { problems, values };

    // The records as the DNS panel lists them (read from the registrar, like GET …/dns).
    const listing = await listDns(ctx.admin, row);
    if (!listing.ok) return { problems: [...problems, { field: "_", message: listing.error }], values };
    const type = v.type;
    const name = relativeName(v.name, row.domain);
    const same = (r: DnsRow) => r.type === type && r.name === name;

    if (op === "Add record") {
      if (typeof v.content !== "string") return { problems, values };
      const next: DnsInput = {
        type,
        name,
        content: v.content.trim(),
        ttl: typeof v.ttl === "number" ? v.ttl : defaultTtl(row.registrar),
        priority: type === "MX" ? (typeof v.priority === "number" ? v.priority : 10) : null,
        proxied: row.registrar === "cloudflare" && PROXIABLE.has(type) ? v.proxied === true : null,
      };
      const bad = validateDns(row.registrar, next);
      if (bad) problems.push({ field: dnsField(bad), message: bad });
      else if (listing.dns.rows.some((r) => same(r) && sameContent(r.content, next.content))) {
        problems.push({ field: "content", message: `${row.domain} already has that ${type} record at ${name}.` });
      }
      values.__next = next;
      return { problems, values };
    }

    // Change / delete: exactly one existing record, by type + host (+ its current value when needed).
    const filter = op === "Change record" ? v.old_content : v.content;
    const filterField = op === "Change record" ? "old_content" : "content";
    const matches = listing.dns.rows.filter((r) => same(r) && (typeof filter !== "string" || sameContent(r.content, filter) || sameContent(r.raw, filter)));
    if (!matches.length) {
      problems.push({
        field: typeof filter === "string" ? filterField : "type",
        message: `${row.domain} has no ${type} record at ${name}${typeof filter === "string" ? ` with the value ${filter}` : ""}.${op === "Change record" ? " To create one, use Add record." : ""}`,
      });
      return { problems, values };
    }
    if (matches.length > 1) {
      problems.push({
        field: typeof filter === "string" ? filterField : "_",
        message: `${row.domain} has ${matches.length} ${type} records at ${name} — which one? Say its current value.`,
        choices: matches.map(describeRecord),
      });
      return { problems, values };
    }
    const original = matches[0];
    if (!original.editable) problems.push({ field: "type", message: `That ${original.type} record can't be edited here.` });
    values.__original = original;
    if (op === "Change record" && typeof v.content === "string") {
      const next: DnsInput = {
        type: original.type,
        name: original.name,
        content: v.content.trim(),
        ttl: typeof v.ttl === "number" ? v.ttl : original.ttl,
        priority: original.type === "MX" ? (typeof v.priority === "number" ? v.priority : (original.priority ?? 10)) : null,
        proxied: typeof v.proxied === "boolean" ? v.proxied : original.proxied,
      };
      const bad = validateDns(row.registrar, next);
      if (bad) problems.push({ field: dnsField(bad), message: bad });
      else if (
        sameContent(next.content, original.content) &&
        next.ttl === original.ttl &&
        (next.priority ?? null) === (original.priority ?? null) &&
        (next.proxied ?? null) === (original.proxied ?? null)
      ) {
        problems.push({ field: "content", message: "That record already has this value." });
      }
      values.__next = next;
    }
    return { problems, values };
  },
  async preview(v) {
    const domain = str(v.__domain) || "the domain from an earlier step";
    const op = str(v.operation);
    const original = (v.__original as DnsRow | undefined) ?? null;
    const next = (v.__next as DnsInput | undefined) ?? null;
    const warnings: string[] = [];
    const changes: CardChange[] = [];
    let title = `Change ${domain}'s DNS`;
    if (op === "Add record" && next) {
      title = `Add a ${next.type} record to ${domain}`;
      changes.push({ label: `${next.type} ${next.name}`, from: "—", to: recordValue(next) });
    } else if (op === "Change record" && original && next) {
      title = `Change the ${original.type} record ${original.name} on ${domain}`;
      changes.push({ label: `${original.type} ${original.name}`, from: recordValue(original), to: recordValue(next) });
    } else if (op === "Delete record" && original) {
      title = `Delete the ${original.type} record ${original.name} on ${domain}`;
      changes.push({ label: `${original.type} ${original.name}`, from: recordValue(original), to: "—" });
    } else if (op === "Forward domain" || op === "Stop forwarding") {
      const f = await getHostingerForwarding(domain);
      const now = f === "error" ? "unknown" : f ? `${f.redirectType} → ${f.redirectUrl}` : "none";
      title = op === "Forward domain" ? `Forward ${domain} to ${str(v.redirect_url)}` : `Stop forwarding ${domain}`;
      changes.push({ label: "Forwarding", from: now, to: op === "Forward domain" ? `${str(v.redirect_type) || "301"} → ${str(v.redirect_url)}` : "none" });
      if (op === "Forward domain") warnings.push(`Every visit to ${domain} goes to ${str(v.redirect_url)} instead of the site on it.`);
    } else if (op === "Reset to defaults") {
      title = `Reset ${domain}'s DNS to Hostinger's defaults`;
      warnings.push("Custom records are replaced by Hostinger's defaults (email MX/TXT records are kept).");
    }
    const rec = next ?? original;
    if ((rec && carriesSite(rec)) || (original && carriesSite(original))) warnings.push(`This record carries ${domain}'s website — a wrong value takes the site offline.`);
    if (rec?.type === "MX") warnings.push("MX records route the client's email — a wrong value stops their email arriving.");
    return {
      title,
      fields: [],
      changes,
      warnings,
      notes: ["Live DNS changes take effect within minutes and can't be undone from here — to reverse one, make the opposite change."],
      link: domainLink(str(v.domain)),
      confirmPhrase: str(v.__domain),
      before: { original },
    };
  },
  async stale(before, v) {
    const b = (before ?? {}) as { original?: DnsRow | null };
    if (!b.original) return null;
    const now = (v.__original as DnsRow | undefined) ?? null;
    if (!now || now.id !== b.original.id || now.raw !== b.original.raw) return "that record changed at the registrar since this was proposed.";
    return null;
  },
  async execute(v) {
    const id = str(v.domain);
    const domain = str(v.__domain);
    const op = str(v.operation);
    const base = `/api/domains/${id}`;
    if (op === "Forward domain") {
      const url = str(v.redirect_url);
      await callRoute(forwardingRoute, "PUT", { path: `${base}/forwarding`, params: { id }, body: { redirectType: str(v.redirect_type) || "301", redirectUrl: url } });
      return { message: `${domain} now forwards to ${url}.`, link: domainLink(id), data: { id } };
    }
    if (op === "Stop forwarding") {
      await callRoute(forwardingRoute, "DELETE", { path: `${base}/forwarding`, params: { id } });
      return { message: `${domain} no longer forwards anywhere.`, link: domainLink(id), data: { id } };
    }
    if (op === "Reset to defaults") {
      await callRoute(dnsResetRoute, "POST", { path: `${base}/dns/reset`, params: { id } });
      return { message: `${domain}'s DNS is back to Hostinger's defaults.`, link: domainLink(id), data: { id } };
    }
    const original = (v.__original as DnsRow | undefined) ?? null;
    const next = op === "Delete record" ? null : ((v.__next as DnsInput | undefined) ?? null);
    if (!original && !next) throw new RouteError("Nothing to change.", 400, null);
    await callRoute(dnsRoute, "POST", { path: `${base}/dns`, params: { id }, body: { original, next } });
    const what = next ? `${next.type} ${next.name} → ${next.content}` : original ? describeRecord(original) : "";
    const verb = op === "Add record" ? "Added" : op === "Change record" ? "Changed" : "Deleted";
    return { message: `${verb} the DNS record ${what} on ${domain}.`, link: domainLink(id), data: { id, original, next } };
  },
};

/* --------------------------------------------------------------- site.link */

const LINK_WHAT = ["Domain", "Website"] as const;

const siteLink: ActionDef = {
  key: "site.link",
  group: "Websites & domains",
  title: "Link a domain or website to a lead",
  description:
    "Attach one of our domains (Domains page) or a deployed website (Deployments board) to a lead. Linking an unassigned domain starts its automatic setup — DNS, hosting, SSL, then the lead's site goes live on it. Linking a website sets the lead's website link to it and tells the lead's agent.",
  confirmLabel: "Link",
  risk: "sensitive",
  allowed: (ctx) => needAny(ctx, "domains.manage", "studio.manage"),
  fields: [
    { name: "lead", label: "Lead", type: "ref", ref: "lead", required: true, editable: false },
    {
      name: "what",
      label: "Link",
      type: "enum",
      options: LINK_WHAT,
      required: true,
      editable: false,
      // Implied by which one was named; both (or neither) is a question for the person.
      default: (_ctx: ActionContext, v: Values) => (v.site && !v.domain ? "Website" : v.domain && !v.site ? "Domain" : undefined),
      help: "Domain = one of our registered domains (a name like jumbospizza.com on the Domains page). Website = a deployed site on the Deployments board (e.g. jumbos-pizza.dmviral.com).",
    },
    { name: "domain", label: "Domain", type: "ref", ref: "domain", required: (v) => v.what === "Domain", showIf: (v) => v.what !== "Website", editable: false },
    { name: "site", label: "Website", type: "ref", ref: "deployment", required: (v) => v.what === "Website", showIf: (v) => v.what !== "Domain", editable: false },
  ],
  label: (v) => str(v.__lead_name),
  minutesSaved: 2,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const values: Values = {};
    if (v.what === "Domain" && !ctx.perms.has("domains.manage")) problems.push({ field: "what", message: need(ctx, "domains.manage") ?? "" });
    if (v.what === "Website" && !ctx.perms.has("studio.manage")) problems.push({ field: "what", message: need(ctx, "studio.manage") ?? "" });
    const leadId = typeof v.lead === "string" && !isStepRef(v.lead) ? v.lead : null;
    if (leadId) {
      const lead = await visibleLead<{ business_name: string; website_link: string | null }>(ctx, leadId, "business_name, website_link");
      if (!lead) problems.push({ field: "lead", message: "That lead is not visible to you." });
      else {
        values.__lead_name = lead.business_name;
        values.__lead_link = lead.website_link;
      }
    }

    if (v.what === "Domain") {
      const row = await loadDomain(ctx, v.domain);
      if (named(v.domain) && !row) problems.push({ field: "domain", message: "That domain no longer exists." });
      if (row) {
        Object.assign(values, { __domain: row.domain, __status: row.status, __prev: row.lead_id, __prev_name: joinedName(row.leads) });
        // lib/domains/service.ts assignDomain's own refusals.
        if (leadId && row.lead_id === leadId) problems.push({ field: "domain", message: `${row.domain} is already linked to this lead.` });
        else if (row.status === "purchasing" || row.status === "failed") problems.push({ field: "domain", message: "Wait for the purchase to finish before linking this domain." });
        else if (row.status === "unassigned" && row.registrar_status === "expired") problems.push({ field: "domain", message: "This domain has expired — renew it first." });
        else if (row.status === "unassigned" && row.registrar_status === "missing") problems.push({ field: "domain", message: "This domain is no longer in our registrar account." });
        if (leadId && row.lead_id !== leadId) {
          const other = await firstRow<{ domain: string }>(
            ctx.admin.from("client_domains").select("domain").eq("lead_id", leadId).neq("status", "failed").neq("id", row.id).limit(1),
          );
          if (other) problems.push({ field: "lead", message: `This lead already has the domain ${other.domain} — unlink it first.` });
        }
      }
    }

    if (v.what === "Website") {
      const row = await loadDeployment(ctx, v.site);
      if (named(v.site) && !row) problems.push({ field: "site", message: "That website is no longer on the board." });
      if (row) {
        Object.assign(values, { __url: row.url, __host: hostOf(row.url), __prev: row.lead_id, __prev_name: joinedName(row.leads) });
        if (row.status !== "live") problems.push({ field: "site", message: "Only a live site can be linked to a lead." });
        if (leadId && row.lead_id === leadId) problems.push({ field: "site", message: "This site is already linked to this lead." });
        if (leadId) {
          // The link route retires the lead's other live rows (one live site per lead).
          const { data } = await ctx.admin.from("studio_deployments").select("id, url").eq("lead_id", leadId).eq("status", "live").neq("id", row.id);
          values.__retire = ((data ?? []) as { url: string }[]).map((d) => d.url);
        }
      }
    }
    return { problems, values };
  },
  async preview(v) {
    const leadName = str(v.__lead_name) || "the lead from an earlier step";
    const prevName = str(v.__prev_name);
    const leadId = str(v.lead);
    if (v.what === "Domain") {
      const domain = str(v.__domain) || "the domain from an earlier step";
      const notes: string[] = [];
      if (v.__status === "unassigned") notes.push("Linking starts the automatic setup: DNS, hosting and SSL, then the lead's site goes live on the domain.");
      if (v.__status === "connected") notes.push("It was set up by hand, so only the link changes (the lead's website link is set to the domain if it has none).");
      return {
        title: `Link ${domain} to ${leadName}`,
        fields: [],
        changes: [{ label: "Lead", from: v.__prev ? prevName || "another lead" : "—", to: leadName }],
        warnings: v.__prev ? [`It is linked to ${prevName || "another lead"} now — that lead loses it.`] : [],
        notes,
        link: domainLink(str(v.domain)),
        before: { lead_id: v.__prev ?? null },
      };
    }
    const retire = Array.isArray(v.__retire) ? (v.__retire as string[]) : [];
    return {
      title: `Link ${str(v.__host)} to ${leadName}`,
      fields: [],
      changes: [
        { label: "Website link", from: str(v.__lead_link) || "—", to: str(v.__url) },
        ...(v.__prev ? [{ label: "Site's lead", from: prevName || "another lead", to: leadName }] : []),
      ],
      warnings: retire.length ? [`${leadName}'s current site (${retire.join(", ")}) is marked as taken down on the board — its files stay on the hosting.`] : [],
      notes: ["The lead's agent is told the website is live."],
      link: isStepRef(leadId) ? BOARD_LINK : leadLink(leadId),
      before: { lead_id: v.__prev ?? null },
    };
  },
  async stale(before, v, ctx) {
    const b = (before ?? {}) as { lead_id?: string | null };
    const row = v.what === "Domain" ? await loadDomain(ctx, v.domain) : await loadDeployment(ctx, v.site);
    if (!row) return "it no longer exists.";
    return (row.lead_id ?? null) !== (b.lead_id ?? null) ? "it was linked to another lead in the meantime." : null;
  },
  async execute(v) {
    const lead = str(v.lead);
    const leadName = str(v.__lead_name) || "the lead";
    if (v.what === "Domain") {
      const id = str(v.domain);
      await callRoute(domainRoute, "PATCH", { path: `/api/domains/${id}`, params: { id }, body: { leadId: lead } });
      return {
        message: `Linked ${str(v.__domain)} to ${leadName}.${v.__status === "unassigned" ? " Its setup has started — DNS, hosting, SSL, then the site goes live on it." : ""}`,
        link: domainLink(id),
        data: { what: "Domain", id, previous: v.__prev ?? null },
      };
    }
    const id = str(v.site);
    const res = await callRoute<{ url?: string }>(linkRoute, "POST", { path: "/api/site-studio/deployments/link", body: { leadId: lead, deploymentId: id } });
    return {
      message: `Linked ${str(v.__host)} to ${leadName} — its website link is ${res.url ?? str(v.__url)} now, and its agent was told.`,
      link: leadLink(lead),
      data: { what: "Website", id },
      // The lead's previous link, retired rows and the agent's notification have no route back.
      undoable: false,
    };
  },
  undo: {
    async run(stored) {
      const d = stored.result?.data ?? {};
      if (d.what !== "Domain" || typeof d.id !== "string") throw new RouteError("Linking a website can't be undone here.", 409, null);
      const previous = typeof d.previous === "string" ? d.previous : null;
      await callRoute(domainRoute, "PATCH", { path: `/api/domains/${d.id}`, params: { id: d.id }, body: { leadId: previous } });
      return previous ? "the domain is back with its previous lead." : "the domain is unlinked again (setup steps it already finished stay as they are).";
    },
  },
};

/* ------------------------------------------------------------ site.restore */

/** When a snapshot was taken: its storage time, else its name ("2026-10-14T18-00-00-000Z.zip"). */
export function snapshotTime(s: Pick<SiteSnapshot, "name" | "takenAt">): number {
  if (s.takenAt) {
    const t = Date.parse(s.takenAt);
    if (Number.isFinite(t)) return t;
  }
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.zip$/.exec(s.name);
  return m ? Date.parse(`${m[1]}:${m[2]}:${m[3]}.${m[4]}Z`) : NaN;
}

const siteRestore: ActionDef = {
  key: "site.restore",
  group: "Websites & domains",
  title: "Restore a website's earlier files",
  description:
    "Put a live website's files back to an earlier saved version — the Deployments board's File history → Restore. A version is saved automatically before every upload or restore; by default the most recent one is used (what the site looked like before its last upload). The current files are saved first, so this can be undone. It cannot bring back a site that was taken down.",
  confirmLabel: "Restore files",
  risk: "sensitive",
  allowed: (ctx) => needAny(ctx, "studio.manage", "tickets.resolve"),
  fields: [
    { name: "site", label: "Website", type: "ref", ref: "deployment", required: true, editable: false },
    {
      name: "when",
      label: "Version from",
      type: "datetime",
      editable: false,
      help: "Optional: restore the version saved at or just before this time (company time). Leave empty for the most recent saved version.",
    },
  ],
  label: (v) => str(v.__host),
  minutesSaved: 3,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const values: Values = {};
    const row = await loadDeployment(ctx, v.site);
    if (named(v.site) && !row) problems.push({ field: "site", message: "That website is no longer on the board." });
    if (!row) return { problems };
    Object.assign(values, { __host: hostOf(row.url), __url: row.url, __name: joinedName(row.leads) });
    if (row.status !== "live") {
      problems.push({ field: "site", message: `Only a live site's files can be restored — this one is ${row.status.replace("_", " ")}.` });
      return { problems, values };
    }
    const snaps = await listSiteSnapshots(ctx.admin, row.url);
    if (snaps === null) problems.push({ field: "_", message: "Could not read the site's file history — try again." });
    else if (!snaps.length) problems.push({ field: "site", message: "This site has no saved versions yet — one is saved automatically before every upload." });
    else {
      const when = typeof v.when === "string" ? Date.parse(v.when) : NaN;
      const pick = Number.isFinite(when) ? snaps.find((s) => snapshotTime(s) <= when) : snaps[0];
      if (!pick) {
        const oldest = snaps[snaps.length - 1];
        const t = snapshotTime(oldest);
        problems.push({
          field: "when",
          message: `There is no saved version from before then${Number.isFinite(t) ? ` — the oldest is from ${formatDateTime(new Date(t), ctx.timezone, ctx.now)}` : ""}.`,
        });
      } else {
        values.__snapshot = pick.path;
        const t = snapshotTime(pick);
        values.__snapshot_at = Number.isFinite(t) ? new Date(t).toISOString() : null;
      }
    }
    return { problems, values };
  },
  async preview(v, ctx) {
    const host = str(v.__host);
    const at = typeof v.__snapshot_at === "string" ? formatDateTime(v.__snapshot_at, ctx.timezone, ctx.now) : "the latest saved version";
    return {
      title: `Restore ${host} to its files from ${at}`,
      warnings: [`The live files of ${host} are replaced with that version.`],
      notes: ["The current files are saved to the file history first, so this can be undone."],
      link: BOARD_LINK,
      before: { snapshot: v.__snapshot },
    };
  },
  async stale(before, v) {
    const b = (before ?? {}) as { snapshot?: string };
    return b.snapshot && b.snapshot !== v.__snapshot
      ? "a newer version of the site's files was saved since this was proposed (an upload or another restore) — ask again to pick from the current history."
      : null;
  },
  async execute(v, ctx) {
    const site = str(v.__url);
    const path = str(v.__snapshot);
    const startedAt = new Date().toISOString();
    const res = await callRoute<{ url?: string; files?: number; undoable?: boolean }>(restoreRoute, "POST", {
      path: "/api/site-studio/deployments/restore",
      search: { site },
      body: { path },
    });
    // The route saves the current files first; find that copy (the newest snapshot taken since this started) for Undo.
    let undo: string | null = null;
    if (res.undoable) {
      const floor = snapshotName(startedAt);
      const after = (await listSiteSnapshots(ctx.admin, site)) ?? [];
      undo = after.find((s) => s.name >= floor && s.path !== path)?.path ?? null;
    }
    return {
      message: `Restored ${str(v.__host)}'s files${typeof res.files === "number" ? ` (${res.files} files)` : ""}.${res.undoable ? "" : " The files from before could not be saved first, so this can't be undone."}`,
      link: { href: res.url ?? site, label: "Open site" },
      data: { site, restored: path, undo },
      undoable: Boolean(undo),
    };
  },
  undo: {
    async run(stored) {
      const d = stored.result?.data ?? {};
      if (typeof d.undo !== "string" || typeof d.site !== "string") throw new RouteError("There is no saved copy of the files from before the restore.", 409, null);
      await callRoute(restoreRoute, "POST", { path: "/api/site-studio/deployments/restore", search: { site: d.site }, body: { path: d.undo } });
      return "the files from before the restore are back.";
    },
  },
};

/* ----------------------------------------------------------- site.transfer */

const siteTransfer: ActionDef = {
  key: "site.transfer",
  group: "Websites & domains",
  title: "Move a website to its own domain",
  description:
    "Put a live staging site (…dmviral.com) on the client's real domain — the Deployments board's Transfer: its current files are copied to the domain on our Hostinger plan, the lead's website link moves there and its people are told, and the staging address is deleted. The domain must be registered on our Hostinger account or already hosted on the plan; by default the domain linked to the site's lead is used.",
  confirmLabel: "Move site",
  risk: "critical",
  allowed: (ctx) => need(ctx, "studio.manage"),
  fields: [
    { name: "site", label: "Website", type: "ref", ref: "deployment", required: true, editable: false },
    {
      name: "domain",
      label: "Move to",
      type: "text",
      max: 253,
      editable: false,
      help: "The client's own domain, e.g. jumbospizza.com. Leave empty to use the domain linked to the site's lead.",
    },
  ],
  label: (v) => str(v.__host),
  minutesSaved: 4,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const warnings: string[] = [];
    const values: Values = {};
    const row = await loadDeployment(ctx, v.site);
    if (named(v.site) && !row) problems.push({ field: "site", message: "That website is no longer on the board." });
    if (!row) return { problems };
    const name = joinedName(row.leads);
    Object.assign(values, { __host: hostOf(row.url), __name: name });
    if (!daConfigured()) problems.push({ field: "_", message: "DirectAdmin is not configured." });
    if (!hostingerConfigured()) problems.push({ field: "_", message: "Hostinger is not configured." });
    // lib/site-studio/deploy/golive.ts's own refusals.
    if (row.status !== "live") problems.push({ field: "site", message: "Only a live site can be transferred." });
    else if (!subFromWebsiteLink(row.url, daDomain())) problems.push({ field: "site", message: "This site is not on a staging subdomain — it looks already transferred." });

    let target = typeof v.domain === "string" ? v.domain : null;
    if (!target && row.lead_id) {
      const own = await firstRow<{ domain: string; status: string }>(ctx.admin.from("client_domains").select("domain, status").eq("lead_id", row.lead_id).neq("status", "failed").limit(1));
      if (own) {
        target = own.domain;
        values.domain = own.domain;
        warnings.push(`Using ${own.domain}, the domain linked to ${name || "the site's lead"}.`);
        if (own.status === "setting_up" || own.status === "waiting_for_site") warnings.push("That domain's automatic setup is still running and would put the site live on it by itself.");
      }
    }
    if (!target) problems.push({ field: "domain", message: `Which domain should ${hostOf(row.url)} move to?${row.lead_id ? " Its lead has no domain linked." : ""}` });
    else {
      const t = normalizeTargetDomain(target, daDomain());
      if (!t.ok) problems.push({ field: "domain", message: t.error });
      else values.__target = t.domain;
    }
    return { problems, warnings, values };
  },
  async preview(v) {
    const host = str(v.__host);
    const target = str(v.__target);
    return {
      title: `Move ${host} to ${target}`,
      warnings: [`Whatever ${target} shows now is replaced (its current files are saved to its file history first).`, `The staging address ${host} is deleted once the files are in place.`],
      notes: [`The lead's website link moves to https://${target} and its people are told.`, "A new domain's hosting can take a few minutes to set up; the SSL certificate follows."],
      link: BOARD_LINK,
      confirmPhrase: target,
      before: { host },
    };
  },
  async stale(before, v, ctx) {
    const b = (before ?? {}) as { host?: string };
    const row = await loadDeployment(ctx, v.site);
    if (!row || row.status !== "live") return "the site is no longer live.";
    return b.host && hostOf(row.url) !== b.host ? `it moved to ${hostOf(row.url)} in the meantime.` : null;
  },
  async execute(v) {
    const id = str(v.site);
    const target = str(v.__target);
    const r = await callRoute<{ url?: string; provisioning?: boolean; subdomainDeleted?: boolean; settled?: boolean; snapshot?: string | null; snapshotError?: string | null; ssl?: string | null }>(
      transferRoute,
      "POST",
      { path: `/api/site-studio/deployments/${id}/transfer`, params: { id }, body: { domain: target } },
    );
    const url = r.url ?? `https://${target}`;
    const notes = [r.provisioning ? `${url} is live shortly (DNS/SSL still provisioning).` : `${url} is live.`];
    if (r.subdomainDeleted) notes.push("The staging address was removed.");
    else if (r.settled === false) notes.push("Hostinger is still unpacking the files, so the staging copy was kept as a fallback.");
    else notes.push("The staging address could not be removed — check it on the board.");
    if (r.snapshot) notes.push("The domain's previous files were saved to its file history.");
    if (r.snapshotError) notes.push(`Its previous files could not be saved first (${r.snapshotError}).`);
    if (r.ssl === "installing") notes.push("An SSL certificate was requested.");
    return { message: `Moved ${str(v.__host)} to ${target}. ${notes.join(" ")}`, link: { href: url, label: "Open site" }, data: { id, url } };
  },
};

/* ----------------------------------------------------------- site.takedown */

const siteTakedown: ActionDef = {
  key: "site.takedown",
  group: "Websites & domains",
  title: "Take a website down",
  description:
    "Take a live website offline — the Deployments board's Take down. A staging site's subdomain is deleted with its files; a site on a client's own domain is removed from the hosting. The lead's website link is cleared when it points there. It cannot be undone from here (the files are gone).",
  confirmLabel: "Take down",
  risk: "critical",
  allowed: (ctx) => need(ctx, "studio.manage"),
  fields: [{ name: "site", label: "Website", type: "ref", ref: "deployment", required: true, editable: false }],
  label: (v) => str(v.__host),
  minutesSaved: 2,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const row = await loadDeployment(ctx, v.site);
    if (named(v.site) && !row) problems.push({ field: "site", message: "That website is no longer on the board." });
    if (!row) return { problems };
    const host = hostOf(row.url);
    const staging = Boolean(subFromWebsiteLink(row.url, daDomain()));
    // The takedown route's own refusals, in its order.
    if (row.status === "taken_down") problems.push({ field: "site", message: "This site is already taken down." });
    else if (!staging && isProtectedDomain(host)) problems.push({ field: "site", message: `${host} is a protected company domain — it cannot be taken down from the board.` });
    else if (!staging && !hostingerConfigured()) problems.push({ field: "site", message: `This site lives on ${host} (custom domain) and Hostinger is not configured to remove it.` });
    return { problems, values: { __host: host, __name: joinedName(row.leads), __staging: staging, __status: row.status } };
  },
  async preview(v) {
    const host = str(v.__host);
    const name = str(v.__name);
    return {
      title: `Take down ${host}${name ? ` (${name})` : ""}`,
      warnings: [
        v.__staging
          ? `${host} goes offline immediately and its subdomain is deleted with all its files.`
          : `${host} goes offline immediately: the website is removed from the hosting with its files.`,
        "The lead's website link is cleared if it points here.",
      ],
      notes: ["This can't be undone here — the files are deleted, so the site would have to be deployed again."],
      link: BOARD_LINK,
      confirmPhrase: host,
      before: { status: v.__status },
    };
  },
  async stale(before, v, ctx) {
    const b = (before ?? {}) as { status?: string };
    const row = await loadDeployment(ctx, v.site);
    if (!row) return "the site is no longer on the board.";
    return b.status && row.status !== b.status ? `it is ${row.status.replace("_", " ")} now.` : null;
  },
  async execute(v) {
    const id = str(v.site);
    const res = await callRoute<{ ok?: boolean; warning?: string }>(deploymentRoute, "DELETE", { path: `/api/site-studio/deployments/${id}`, params: { id } });
    return { message: `Took down ${str(v.__host)}.${res.warning ? ` ${res.warning}` : ""}`, link: BOARD_LINK, data: { id } };
  },
};

export const DOMAIN_ACTIONS: ActionDef[] = [domainCheck, domainHealth, siteLink, siteRestore, siteTransfer, domainDns, siteTakedown, domainBuy, domainAutorenew];
