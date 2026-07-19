import Link from "next/link";
import type { Metadata } from "next";
import {
  Bell,
  Braces,
  CalendarClock,
  ChartColumn,
  Cloud,
  CreditCard,
  Database,
  Eye,
  FileText,
  Globe,
  Images,
  Inbox,
  KeyRound,
  ListFilter,
  Mail,
  Paperclip,
  PenLine,
  Rocket,
  ScanSearch,
  Send,
  Server,
  ShieldCheck,
  Signature,
  Sparkles,
  Tags,
  TestTube,
  Ticket,
  Type,
  Users,
  WandSparkles,
  Workflow,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getBranding } from "@/lib/settings/appSettings";
import { DashboardPreview } from "@/components/marketing/DashboardPreview";
import { APP_VERSION, formatVersion } from "@/lib/version/changelog";
import {
  IconLeads,
  IconLayers,
  IconKey,
  IconShield,
  IconArrowRight,
  IconCheck,
} from "@/components/marketing/icons";

export const metadata: Metadata = {
  title: "SED LMS — Lead pipeline, AI websites, mail & contracts in one console",
  description:
    "SED LMS runs the whole client journey in one place: a permission-aware lead pipeline, AI-generated client websites with one-click deployment, a company mailbox, and contract generation from your own Google Docs templates.",
};

/* --------------------------------- bits --------------------------------- */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-mono uppercase tracking-wider text-accent-ink">
      {children}
    </p>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-text mt-3 text-balance">
      {children}
    </h2>
  );
}

function Lead({ children }: { children: React.ReactNode }) {
  return <p className="text-text-muted mt-4 leading-relaxed">{children}</p>;
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-6 space-y-2.5">
      {items.map((t) => (
        <li key={t} className="flex gap-3 text-sm text-text-muted leading-relaxed">
          <IconCheck className="w-4 h-4 text-accent mt-0.5 shrink-0" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------- page ---------------------------------- */

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const primaryHref = user ? "/dashboard" : "/login";
  const primaryLabel = user ? "Open dashboard" : "Log in";
  const branding = await getBranding();

  return (
    <>
      {/* ============================== HERO ============================== */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grid" />
        <div className="absolute -top-32 -left-24 w-[520px] h-[520px] glow-teal pointer-events-none" />
        <div className="absolute top-10 right-0 w-[420px] h-[420px] glow-blue pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-bg" />

        <div className="relative mx-auto max-w-6xl px-5 pt-20 pb-16 md:pt-28">
          <div className="max-w-3xl">
            <div
              className="reveal flex flex-wrap items-center gap-2"
              style={{ animationDelay: "0ms" }}
            >
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-text-muted">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                Lead Management System
              </span>
              <Link
                href="/changelog"
                className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-[11px] font-mono tabular text-accent-ink hover:border-accent transition-colors"
              >
                {formatVersion(APP_VERSION)}
                <span className="text-accent-ink/60">changelog</span>
              </Link>
            </div>

            <h1
              className="reveal font-display text-[40px] leading-[1.05] sm:text-[58px] font-bold tracking-tight text-text mt-6 text-balance"
              style={{ animationDelay: "80ms" }}
            >
              The whole client journey —{" "}
              <span className="text-accent">one console.</span>
            </h1>

            <p
              className="reveal text-lg text-text-muted mt-6 max-w-2xl leading-relaxed"
              style={{ animationDelay: "160ms" }}
            >
              SED LMS runs the pipeline, builds the client&apos;s website, ships it to
              their domain, sends the contract and keeps the conversation — without
              anyone leaving the dashboard. Every screen and every action is gated by
              permissions you control.
            </p>

            <div
              className="reveal flex flex-wrap items-center gap-3 mt-8"
              style={{ animationDelay: "240ms" }}
            >
              <Link
                href={primaryHref}
                className="group inline-flex items-center gap-2 bg-accent text-white text-sm font-semibold rounded-lg px-5 py-3 hover:bg-accent-ink transition-colors"
              >
                {primaryLabel}
                <IconArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center gap-2 border border-border bg-surface text-sm font-semibold rounded-lg px-5 py-3 text-text hover:border-accent transition-colors"
              >
                Read the docs
              </Link>
            </div>
          </div>

          {/* hero product visual */}
          <div
            className="reveal mt-14 md:mt-20 max-w-5xl mx-auto float-soft"
            style={{ animationDelay: "340ms" }}
          >
            <DashboardPreview companyName={branding.companyName} logoUrl={branding.logoUrl} />
          </div>
        </div>
      </section>

      {/* ========================= MODULES STRIP ========================= */}
      <section className="border-y border-border bg-surface-2">
        <div className="mx-auto max-w-6xl px-5 py-8 flex flex-col lg:flex-row lg:items-center gap-x-8 gap-y-4">
          <p className="text-xs uppercase tracking-wider text-text-faint font-semibold whitespace-nowrap">
            One system, six surfaces
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            {[
              { I: Workflow, n: "Pipeline" },
              { I: WandSparkles, n: "Website generation" },
              { I: Rocket, n: "Deployment" },
              { I: Mail, n: "Mailbox" },
              { I: Signature, n: "Contracts" },
              { I: ChartColumn, n: "Operations" },
            ].map((m) => (
              <span
                key={m.n}
                className="inline-flex items-center gap-2 text-sm font-medium rounded-full px-3.5 py-1.5 border border-border bg-surface text-text"
              >
                <m.I className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
                {m.n}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ PIPELINE ============================ */}
      <section id="pipeline" className="mx-auto max-w-6xl px-5 py-20 md:py-28 scroll-mt-20">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          <div>
            <Eyebrow>Lead pipeline</Eyebrow>
            <SectionTitle>Every lead, with the context to act on it.</SectionTitle>
            <Lead>
              Leads move through clear statuses, belong to a named agent, and carry
              their own follow-up schedule. Filter down to exactly the slice you work
              on, save that slice as a view, and act on the whole selection at once.
            </Lead>
            <Bullets
              items={[
                "Statuses from first contact through to closed — with per-status view and set permissions.",
                "Assignment to an agent and a closer, plus bulk reassignment across a selection.",
                "Follow-up logging with pickup outcomes, a required next contact time, and overdue/today/upcoming queues.",
                "Colour-coded tags you own, can share with teammates, and can apply in bulk.",
                "Saved views: name a filter-and-sort combination once, reload it in a click.",
                "Bulk status changes, assignment, tagging, archiving and CSV export of the current filter.",
              ]}
            />
          </div>

          {/* pipeline visual */}
          <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-text">
                <IconLeads className="w-4 h-4 text-accent" />
                Pipeline
              </div>
              <span className="font-mono tabular text-[11px] text-text-faint">
                saved view · &ldquo;My ready leads&rdquo;
              </span>
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {[
                { n: "Ready", c: "bg-ready-bg text-ready-fg" },
                { n: "Not Ready", c: "bg-notready-bg text-notready-fg" },
                { n: "Long Term", c: "bg-longterm-bg text-longterm-fg" },
                { n: "Closed", c: "bg-closed-bg text-closed-fg" },
                { n: "Dropped", c: "bg-dropped-bg text-dropped-fg" },
              ].map((s) => (
                <span
                  key={s.n}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${s.c}`}
                >
                  {s.n}
                </span>
              ))}
            </div>

            <div className="mt-5 space-y-2.5">
              {[
                { I: ListFilter, t: "Filter", d: "Search, status, agent, site type, region, tags, month." },
                { I: Tags, t: "Tag", d: "Your own colour catalog — shareable with the team." },
                { I: CalendarClock, t: "Follow up", d: "Log the call, set the next time, watch the queue." },
                { I: Users, t: "Assign", d: "Hand a batch of leads to another agent in one action." },
              ].map((r) => (
                <div
                  key={r.t}
                  className="flex items-start gap-3 rounded-xl border border-border-subtle bg-surface-2 px-4 py-3"
                >
                  <span className="w-8 h-8 shrink-0 rounded-lg bg-accent-soft text-accent-ink grid place-items-center">
                    <r.I className="w-4 h-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-text">{r.t}</div>
                    <div className="text-xs text-text-muted mt-0.5 leading-relaxed">{r.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ======================== TEMPLATE ENGINE ======================== */}
      <section
        id="websites"
        className="relative border-y border-border bg-surface-2 scroll-mt-20 overflow-hidden"
      >
        <div className="absolute inset-0 bg-grid opacity-50" />
        <div className="relative mx-auto max-w-6xl px-5 py-20 md:py-28">
          <div className="max-w-2xl">
            <Eyebrow>Template Engine</Eyebrow>
            <SectionTitle>A client website, generated from the lead itself.</SectionTitle>
            <Lead>
              Everything sales already captured — the business name, services, service
              areas, photos and the pages they asked for — becomes the brief. The
              operator drives a five-step wizard; the system writes the copy, sources
              the imagery, builds the site and refuses to hand over anything broken.
            </Lead>
          </div>

          <div className="grid lg:grid-cols-[1.05fr_1fr] gap-10 lg:gap-16 mt-12 items-start">
            {/* wizard stepper */}
            <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
              <div className="text-xs font-mono uppercase tracking-wider text-text-faint">
                Operator wizard
              </div>
              <ol className="mt-5 space-y-1">
                {[
                  { n: "01", t: "Setup", d: "Pick the lead and the template. A readiness panel shows what the brief is missing before you start." },
                  { n: "02", t: "Content", d: "Pages are derived from the lead's own request; the model writes headlines, services, FAQ and page metadata." },
                  { n: "03", t: "Images", d: "Candidate photos are gathered, ranked, and presented per slot. The client's own photos always come first." },
                  { n: "04", t: "Build", d: "The site is assembled file by file with a live step tracker and preview." },
                  { n: "05", t: "Review", d: "Verification gates run. Preview any page, download the build, or reopen it for edits." },
                ].map((s, i, arr) => (
                  <li key={s.n} className="flex gap-4">
                    <div className="flex flex-col items-center pt-1">
                      <span className="w-8 h-8 shrink-0 rounded-lg border border-accent/30 bg-accent-soft text-accent-ink grid place-items-center font-mono tabular text-[11px] font-semibold">
                        {s.n}
                      </span>
                      {i < arr.length - 1 && <span className="w-px flex-1 my-1 bg-border" />}
                    </div>
                    <div className="pb-5 min-w-0">
                      <div className="text-sm font-semibold text-text">{s.t}</div>
                      <p className="text-xs text-text-muted mt-1 leading-relaxed">{s.d}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* capability cards */}
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { I: Type, t: "AI copywriting", d: "Hero, services, stats, testimonials, FAQ and per-page metadata — written from the real business details, never invented credentials." },
                { I: Images, t: "Image sourcing", d: "Stock candidates plus the client's own photos, gathered per image slot with a cache so repeat builds stay fast." },
                { I: ScanSearch, t: "Vision ranking", d: "A vision pass scores every candidate for relevance and quality, and can drop shots containing people." },
                { I: ShieldCheck, t: "Verification gates", d: "Leftover template identity and altered page structure both block the build — a broken site cannot reach review." },
                { I: Eye, t: "Preview & edit", d: "Open any generated page in-app, reopen the build for changes, and rebuild without starting over." },
                { I: Sparkles, t: "Automatic pages", d: "Requested pages map onto a canonical set — home, about, services, areas, gallery, contact — with detail pages fanned out per service." },
              ].map((c) => (
                <div
                  key={c.t}
                  className="rounded-xl border border-border bg-surface p-5 hover:border-accent/60 hover:shadow-[0_18px_40px_-24px_rgba(13,148,136,0.45)] transition-all"
                >
                  <span className="w-10 h-10 rounded-lg bg-accent-soft text-accent-ink grid place-items-center">
                    <c.I className="w-5 h-5" aria-hidden="true" />
                  </span>
                  <h3 className="font-semibold text-text mt-4">{c.t}</h3>
                  <p className="text-sm text-text-muted mt-1.5 leading-relaxed">{c.d}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ========================== DEPLOYMENT ========================== */}
      <section id="deployment" className="mx-auto max-w-6xl px-5 py-20 md:py-28 scroll-mt-20">
        <div className="max-w-2xl">
          <Eyebrow>Deployment &amp; domains</Eyebrow>
          <SectionTitle>Staging for the client. Then their own domain.</SectionTitle>
          <Lead>
            A finished build goes live on a staging subdomain in one click, so the
            client can look at a real site rather than a screenshot. When they approve,
            the same site moves onto their domain.
          </Lead>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mt-12">
          {[
            {
              n: "01",
              I: Rocket,
              t: "Publish to staging",
              d: "One click creates the subdomain, uploads the build and writes the live link back onto the lead.",
            },
            {
              n: "02",
              I: Eye,
              t: "Client reviews",
              d: "Share the staging link. Redeploy in place after changes, or take the site down if the deal stalls.",
            },
            {
              n: "03",
              I: Globe,
              t: "Transfer to their domain",
              d: "Files are taken fresh from the live server — so late edits survive — and the staging subdomain is removed automatically.",
            },
          ].map((s) => (
            <div key={s.n} className="rounded-xl border border-border bg-surface p-6">
              <div className="flex items-center justify-between">
                <span className="w-10 h-10 rounded-lg bg-accent-soft text-accent-ink grid place-items-center">
                  <s.I className="w-5 h-5" aria-hidden="true" />
                </span>
                <span className="font-mono tabular text-2xl font-semibold text-border">
                  {s.n}
                </span>
              </div>
              <h3 className="font-semibold text-text mt-4">{s.t}</h3>
              <p className="text-sm text-text-muted mt-1.5 leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface-2 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-text">
            <Server className="w-4 h-4 text-accent" aria-hidden="true" />
            Deployments board
          </span>
          <p className="text-sm text-text-muted leading-relaxed">
            Every deployed site in one table — live URL, when it shipped, and redeploy,
            take-down and transfer actions per row.
          </p>
        </div>
      </section>

      {/* ==================== MAILBOX & CONTRACTS ==================== */}
      <section
        id="workspace"
        className="border-y border-border bg-surface-2 scroll-mt-20"
      >
        <div className="mx-auto max-w-6xl px-5 py-20 md:py-28">
          <div className="max-w-2xl">
            <Eyebrow>Mail &amp; contracts</Eyebrow>
            <SectionTitle>Close the deal without switching tabs.</SectionTitle>
            <Lead>
              The company mailbox and the contract paperwork both live inside the
              console, attached to the lead they belong to.
            </Lead>
          </div>

          <div className="grid lg:grid-cols-2 gap-4 mt-12">
            {/* mailbox */}
            <div className="rounded-2xl border border-border bg-surface p-6 sm:p-7">
              <span className="w-11 h-11 rounded-xl bg-accent-soft text-accent-ink grid place-items-center">
                <Inbox className="w-5 h-5" aria-hidden="true" />
              </span>
              <h3 className="font-display text-xl font-bold text-text mt-4">
                Company mailbox
              </h3>
              <p className="text-sm text-text-muted mt-2 leading-relaxed">
                Company email accounts are linked to the people who use them, with
                credentials stored encrypted and both the incoming and outgoing
                connection verified before anyone relies on it.
              </p>
              <div className="mt-5 grid sm:grid-cols-2 gap-2.5">
                {[
                  { I: Mail, t: "Read", d: "Inbox and Sent, in a list-and-reading view." },
                  { I: PenLine, t: "Compose & reply", d: "Straight from the message you are looking at." },
                  { I: Paperclip, t: "Attachments", d: "Send files out, download what came in." },
                  { I: Bell, t: "Unread badge", d: "New mail surfaces in the sidebar and the tab title." },
                ].map((f) => (
                  <div
                    key={f.t}
                    className="rounded-lg border border-border-subtle bg-surface-2 px-3.5 py-3"
                  >
                    <div className="flex items-center gap-2 text-sm font-semibold text-text">
                      <f.I className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
                      {f.t}
                    </div>
                    <p className="text-xs text-text-muted mt-1 leading-relaxed">{f.d}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* contracts */}
            <div className="rounded-2xl border border-border bg-surface p-6 sm:p-7">
              <span className="w-11 h-11 rounded-xl bg-accent-soft text-accent-ink grid place-items-center">
                <Signature className="w-5 h-5" aria-hidden="true" />
              </span>
              <h3 className="font-display text-xl font-bold text-text mt-4">
                Contract automation
              </h3>
              <p className="text-sm text-text-muted mt-2 leading-relaxed">
                Bring your own Google Docs templates. The system copies the document,
                fills its placeholders from the lead, exports a PDF and sends it from
                the agent&apos;s own address with their signature applied.
              </p>
              <div className="mt-5 rounded-lg border border-border-subtle bg-surface-2 px-4 py-3.5">
                <div className="text-[11px] font-mono uppercase tracking-wider text-text-faint">
                  Placeholders
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {[
                    "{{business_name}}",
                    "{{one_time_price}}",
                    "{{yearly_price}}",
                    "{{agent_name}}",
                    "{{date_long}}",
                  ].map((p) => (
                    <code
                      key={p}
                      className="font-mono text-[11px] rounded border border-border bg-surface px-1.5 py-0.5 text-text-muted"
                    >
                      {p}
                    </code>
                  ))}
                </div>
              </div>
              <ul className="mt-4 space-y-2.5">
                {[
                  { I: FileText, t: "PDF export of the merged document." },
                  { I: Send, t: "Sent from the agent's own mailbox, not a shared one." },
                  { I: PenLine, t: "Per-agent signature — uploaded image or typed name." },
                  { I: CreditCard, t: "Per-contract price overrides for discounts." },
                ].map((f) => (
                  <li key={f.t} className="flex gap-2.5 text-sm text-text-muted">
                    <f.I className="w-4 h-4 text-accent mt-0.5 shrink-0" aria-hidden="true" />
                    <span className="leading-relaxed">{f.t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ========================== OPERATIONS ========================== */}
      <section id="operations" className="mx-auto max-w-6xl px-5 py-20 md:py-28 scroll-mt-20">
        <div className="max-w-2xl">
          <Eyebrow>Operations</Eyebrow>
          <SectionTitle>The work around the work, handled.</SectionTitle>
          <Lead>
            Delivery, money and reporting all hang off the same records, so nothing has
            to be re-entered anywhere.
          </Lead>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-12">
          {[
            { I: Ticket, t: "Tickets", d: "Change and improvement requests against a lead, with checklists, attachments, an assignee, a due date and escalation when they run late." },
            { I: CreditCard, t: "Payments", d: "Managed payment links by category and currency, kept beside the client they belong to." },
            { I: ChartColumn, t: "Analytics", d: "Pipeline, revenue, conversion, follow-up and ticket metrics — with each KPI and chart individually grantable." },
            { I: Users, t: "Departments", d: "Group-level permission sets people can belong to one or many of." },
            { I: KeyRound, t: "Granular permissions", d: "Roughly ninety named permissions across every module, enforced on the server and not merely hidden in the interface." },
            { I: Bell, t: "Notifications", d: "Rule-driven alerts for follow-up reminders, ticket movement, incoming mail, finished websites and failed contract sends." },
          ].map((f) => (
            <div
              key={f.t}
              className="group rounded-xl border border-border bg-surface p-5 hover:border-accent/60 hover:shadow-[0_18px_40px_-24px_rgba(13,148,136,0.45)] transition-all"
            >
              <span className="w-10 h-10 rounded-lg bg-accent-soft text-accent-ink grid place-items-center">
                <f.I className="w-5 h-5" aria-hidden="true" />
              </span>
              <h3 className="font-semibold text-text mt-4">{f.t}</h3>
              <p className="text-sm text-text-muted mt-1.5 leading-relaxed">{f.d}</p>
            </div>
          ))}
        </div>

        {/* permission model */}
        <div className="mt-16 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div>
            <Eyebrow>How access is decided</Eyebrow>
            <SectionTitle>Access that bends to your org.</SectionTitle>
            <Lead>
              A person&apos;s access is resolved live: start with the permissions of
              every department they belong to, then layer on individual grants or
              revokes. Put someone in two departments and they get the union
              automatically. Need an exception? One override — no code, no redeploy.
            </Lead>
            <div className="mt-6 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-surface px-4 py-2.5 font-mono text-sm text-text">
              access = <span className="text-accent-ink">Σ departments</span> + grants −{" "}
              <span className="text-dropped-fg">revokes</span>
            </div>
          </div>

          <div className="space-y-3">
            {[
              { I: IconLayers, t: "Departments", d: "Group-level permission sets (Sales, Tech, …)", tone: "accent" },
              { I: IconKey, t: "Membership", d: "Belong to one or many — access is the union", tone: "blue" },
              { I: IconShield, t: "User overrides", d: "Force-grant or revoke a single permission", tone: "amber" },
            ].map((s, i) => (
              <div key={s.t} className="flex items-center gap-4">
                <div className="flex flex-col items-center">
                  <div
                    className={
                      "w-11 h-11 rounded-xl grid place-items-center border " +
                      (s.tone === "accent"
                        ? "bg-accent-soft text-accent-ink border-accent/30"
                        : s.tone === "blue"
                        ? "bg-longterm-bg text-longterm-fg border-longterm-fg/20"
                        : "bg-notready-bg text-notready-fg border-notready-fg/20")
                    }
                  >
                    <s.I className="w-5 h-5" />
                  </div>
                  {i < 2 && <div className="w-px h-5 bg-border" />}
                </div>
                <div className="flex-1 min-w-0 rounded-xl border border-border bg-surface px-4 py-3">
                  <div className="font-semibold text-text text-sm">{s.t}</div>
                  <div className="text-xs text-text-muted mt-0.5">{s.d}</div>
                </div>
              </div>
            ))}
            <div className="flex items-center gap-4 pt-1">
              <div className="w-11 h-11 shrink-0 rounded-xl grid place-items-center bg-accent text-white">
                <IconCheck className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3">
                <div className="font-semibold text-accent-ink text-sm">Effective access</div>
                <div className="text-xs text-accent-ink/80 mt-0.5">
                  What the user actually sees and can do — recomputed on every request.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================= STACK ============================= */}
      <section id="stack" className="border-t border-border bg-surface-2 scroll-mt-20">
        <div className="mx-auto max-w-6xl px-5 py-20 md:py-24">
          <div className="max-w-2xl">
            <Eyebrow>Built with</Eyebrow>
            <SectionTitle>Boring where it counts.</SectionTitle>
            <Lead>
              Typed end to end, validated at the boundaries, and tested — on a managed
              PostgreSQL database with row-level security.
            </Lead>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-12">
            {[
              {
                I: Braces,
                t: "Application",
                items: ["Next.js 16 (App Router)", "React 19", "TypeScript", "Tailwind CSS v4"],
              },
              {
                I: Database,
                t: "Data & auth",
                items: [
                  "Supabase PostgreSQL",
                  "Auth & Storage",
                  "Realtime",
                  "Row-level security",
                ],
              },
              {
                I: Cloud,
                t: "Integrations",
                items: [
                  "Google Gemini — content",
                  "Gemini vision — image ranking",
                  "Google Drive & Docs APIs",
                  "IMAP/SMTP (imapflow, nodemailer)",
                ],
              },
              {
                I: TestTube,
                t: "Quality & delivery",
                items: ["Zod schema validation", "Vitest test suite", "Deployed on Hostinger"],
              },
            ].map((g) => (
              <div key={g.t} className="rounded-xl border border-border bg-surface p-5">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-accent-soft text-accent-ink grid place-items-center">
                    <g.I className="w-4 h-4" aria-hidden="true" />
                  </span>
                  <h3 className="font-semibold text-text text-sm">{g.t}</h3>
                </div>
                <ul className="mt-4 space-y-2">
                  {g.items.map((it) => (
                    <li
                      key={it}
                      className="font-mono text-[12px] leading-relaxed text-text-muted flex gap-2"
                    >
                      <span className="mt-[7px] w-1 h-1 rounded-full bg-accent shrink-0" />
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================== CTA ============================== */}
      <section className="relative overflow-hidden border-t border-border">
        <div className="absolute inset-0 bg-grid opacity-60" />
        <div className="absolute left-1/2 -translate-x-1/2 top-0 w-[600px] h-[300px] glow-teal pointer-events-none" />
        <div className="relative mx-auto max-w-3xl px-5 py-24 text-center">
          <h2 className="font-display text-3xl sm:text-5xl font-bold tracking-tight text-text text-balance">
            Take control of your pipeline.
          </h2>
          <p className="text-text-muted mt-5 text-lg">
            Sign in to the console and run the lead, the website, the contract and the
            conversation from one place.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
            <Link
              href={primaryHref}
              className="group inline-flex items-center gap-2 bg-accent text-white text-sm font-semibold rounded-lg px-6 py-3 hover:bg-accent-ink transition-colors"
            >
              {primaryLabel}
              <IconArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center border border-border bg-surface text-sm font-semibold rounded-lg px-6 py-3 text-text hover:border-accent transition-colors"
            >
              Browse the docs
            </Link>
          </div>
          <p className="mt-8 text-xs font-mono tabular text-text-faint">
            <Link href="/changelog" className="hover:text-accent-ink transition-colors">
              {formatVersion(APP_VERSION)} · read the changelog
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
