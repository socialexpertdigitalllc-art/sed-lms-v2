import Link from "next/link";
import type { Metadata } from "next";
import {
  CalendarClock,
  ChartColumn,
  CreditCard,
  Globe,
  Inbox,
  Rocket,
  Signature,
  Ticket,
  Users,
  WandSparkles,
  Workflow,
} from "lucide-react";
import { IconArrowRight } from "@/components/marketing/icons";
import { APP_VERSION, formatVersion } from "@/lib/version/changelog";

export const metadata: Metadata = {
  title: "Documentation — SED LMS",
  description:
    "Public documentation for SED LMS: how the lead pipeline, AI website generation, deployment, company mailbox, contracts, operations and permissions work end to end.",
};

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "pipeline", label: "Lead pipeline" },
  { id: "follow-ups", label: "Follow-ups" },
  { id: "template-engine", label: "Website generation" },
  { id: "deployment", label: "Deployment & domains" },
  { id: "mailbox", label: "Company mailbox" },
  { id: "contracts", label: "Contracts & templates" },
  { id: "operations", label: "Operations" },
  { id: "permissions", label: "Permissions" },
  { id: "notifications", label: "Notifications" },
  { id: "faq", label: "FAQ" },
];

/* ------------------------------- primitives ------------------------------ */

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="font-display text-2xl font-bold tracking-tight text-text scroll-mt-24 mt-16 first:mt-0 pt-8 border-t border-border first:border-0 first:pt-0"
    >
      {children}
    </h2>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-semibold text-text mt-8 text-[15px]">{children}</h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-text-muted leading-relaxed mt-4">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-[0.85em] bg-surface-2 border border-border rounded px-1.5 py-0.5 text-text">
      {children}
    </code>
  );
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="mt-4 space-y-2.5">
      {items.map((t, i) => (
        <li
          key={i}
          className="relative pl-4 text-text-muted leading-relaxed before:absolute before:left-0 before:top-[0.65em] before:h-1 before:w-1 before:rounded-full before:bg-accent"
        >
          {t}
        </li>
      ))}
    </ul>
  );
}

function Steps({ items }: { items: [string, string][] }) {
  return (
    <ol className="mt-5 space-y-3">
      {items.map(([t, d], i) => (
        <li key={t} className="flex gap-3.5">
          <span className="mt-0.5 w-6 h-6 shrink-0 rounded-md border border-accent/30 bg-accent-soft grid place-items-center font-mono tabular text-[11px] font-semibold text-accent-ink">
            {i + 1}
          </span>
          <span className="text-text-muted leading-relaxed">
            <strong className="text-text font-semibold">{t}.</strong> {d}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 rounded-xl border border-border bg-surface-2 p-4 text-sm text-text-muted leading-relaxed">
      {children}
    </div>
  );
}

function Pills({ items }: { items: { n: string; c: string }[] }) {
  return (
    <div className="mt-5 flex flex-wrap gap-1.5">
      {items.map((s) => (
        <span
          key={s.n}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${s.c}`}
        >
          {s.n}
        </span>
      ))}
    </div>
  );
}

/* --------------------------------- page --------------------------------- */

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 md:py-16">
      <div className="grid lg:grid-cols-[220px_1fr] gap-10 lg:gap-16">
        {/* TOC */}
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <div className="text-[11px] uppercase tracking-wider text-text-faint font-semibold mb-3">
              On this page
            </div>
            <nav className="space-y-1.5 text-sm">
              {TOC.map((t) => (
                <a
                  key={t.id}
                  href={`#${t.id}`}
                  className="block text-text-muted hover:text-accent-ink transition-colors py-0.5"
                >
                  {t.label}
                </a>
              ))}
            </nav>
            <div className="mt-6 pt-5 border-t border-border space-y-2.5">
              <Link
                href="/changelog"
                className="block font-mono tabular text-xs text-text-faint hover:text-accent-ink transition-colors"
              >
                {formatVersion(APP_VERSION)} · changelog
              </Link>
              <Link
                href="/login"
                className="group inline-flex items-center gap-1.5 text-sm font-semibold text-accent-ink"
              >
                Open the console
                <IconArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        </aside>

        {/* content */}
        <article className="min-w-0 max-w-2xl">
          <p className="text-xs font-mono uppercase tracking-wider text-accent-ink">
            Documentation
          </p>
          <h1 className="font-display text-4xl font-bold tracking-tight text-text mt-3 text-balance">
            How SED LMS works
          </h1>
          <p className="text-lg text-text-muted mt-4 leading-relaxed">
            A walk through every part of the system — what each one is for, how the
            flow runs end to end, and what the operator actually sees.
          </p>

          {/* mobile TOC */}
          <nav className="lg:hidden mt-8 rounded-xl border border-border bg-surface-2 p-4">
            <div className="text-[11px] uppercase tracking-wider text-text-faint font-semibold">
              On this page
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {TOC.map((t) => (
                <a
                  key={t.id}
                  href={`#${t.id}`}
                  className="text-text-muted hover:text-accent-ink transition-colors"
                >
                  {t.label}
                </a>
              ))}
            </div>
          </nav>

          <div className="mt-12">
            {/* ------------------------- OVERVIEW ------------------------- */}
            <H id="overview">Overview</H>
            <P>
              SED LMS is the operating console for a web-design practice. One record —
              the lead — carries a prospective client from first contact all the way
              through to a live website, a signed contract and ongoing support, and
              every part of the system reads from and writes back to that same record.
            </P>
            <P>There are six working surfaces:</P>
            <div className="mt-5 grid sm:grid-cols-2 gap-3">
              {[
                { I: Workflow, t: "Pipeline", d: "Capture, qualify, follow up and close leads." },
                { I: WandSparkles, t: "Website generation", d: "Build the client's site from the lead's own details." },
                { I: Rocket, t: "Deployment", d: "Publish to staging, then to the client's domain." },
                { I: Inbox, t: "Mailbox", d: "Read and send company email in the console." },
                { I: Signature, t: "Contracts", d: "Generate, export and send the agreement." },
                { I: ChartColumn, t: "Operations", d: "Tickets, payments, analytics and admin." },
              ].map((s) => (
                <div key={s.t} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-text">
                    <s.I className="w-4 h-4 text-accent" aria-hidden="true" />
                    {s.t}
                  </div>
                  <p className="text-sm text-text-muted mt-1.5 leading-relaxed">{s.d}</p>
                </div>
              ))}
            </div>
            <Note>
              <strong className="text-text">Access is not optional scenery.</strong> Every
              surface above is gated by permissions, so two people signed into the same
              system can see entirely different menus. See{" "}
              <a href="#permissions" className="text-accent-ink hover:underline">
                Permissions
              </a>
              .
            </Note>

            {/* ------------------------- PIPELINE ------------------------- */}
            <H id="pipeline">Lead pipeline</H>
            <P>
              A lead is a business you might build a website for. It holds the contact
              details, what the business does, which services and service areas it
              covers, the pages it wants, any photos it supplied, the quoted one-time
              and yearly price, and a rating.
            </P>

            <H3>Statuses</H3>
            <P>
              Every lead sits in exactly one status. Statuses are permissioned in two
              directions: who may <em>see</em> leads in a status, and who may{" "}
              <em>move</em> a lead into it.
            </P>
            <Pills
              items={[
                { n: "Ready", c: "bg-ready-bg text-ready-fg" },
                { n: "Not Ready", c: "bg-notready-bg text-notready-fg" },
                { n: "Long Term", c: "bg-longterm-bg text-longterm-fg" },
                { n: "Closed", c: "bg-closed-bg text-closed-fg" },
                { n: "Dropped", c: "bg-dropped-bg text-dropped-fg" },
              ]}
            />

            <H3>Finding the leads you care about</H3>
            <P>
              The leads table combines free-text search with filters for status, agent,
              site type, region, tags and month, plus sorting by newest, follow-up time,
              rating or business name. Columns can be shown or hidden and the row
              density adjusted, and those choices are remembered per person.
            </P>
            <Bullets
              items={[
                <>
                  <strong className="text-text">Saved views.</strong> Name a filter-and-sort
                  combination and reload it in one click. Views are private to you and
                  scoped to the page you saved them on.
                </>,
                <>
                  <strong className="text-text">Tags.</strong> Your own catalog of coloured
                  labels. Tags can be applied in bulk, filtered on, and shared with
                  other users when you want a shared vocabulary.
                </>,
                <>
                  <strong className="text-text">Bulk actions.</strong> With rows selected you
                  can change status, reassign, apply tags, archive, or export the
                  current filtered set to CSV.
                </>,
              ]}
            />

            <H3>Ownership</H3>
            <P>
              Each lead has an assigned agent, and once it closes, a recorded closer.
              Reassignment can be done one lead at a time or across a whole selection.
              Deleting is a soft delete, so history is never destroyed, and duplicate
              businesses are detected on entry.
            </P>

            {/* ------------------------ FOLLOW-UPS ------------------------ */}
            <H id="follow-ups">Follow-ups</H>
            <P>
              Follow-ups are how a live lead stays alive. Logging one records what
              happened on the call, an optional status change, and — required — when
              the next contact should happen.
            </P>
            <Steps
              items={[
                ["Log the outcome", "Pickup or no pickup, with a comment describing the conversation."],
                ["Set the next time", "A future date and time is mandatory, so no live lead is ever left without a next step."],
                ["Watch the queue", "Follow-ups group into overdue, today and upcoming, ordered by when they are due."],
              ]}
            />
            <P>
              Repeated no-answers are counted as a streak, which resets the moment
              someone picks up — an at-a-glance signal that a lead is going cold.
              Reminders can be delivered ahead of the due time; see{" "}
              <a href="#notifications" className="text-accent-ink hover:underline">
                Notifications
              </a>
              .
            </P>

            {/* --------------------- TEMPLATE ENGINE --------------------- */}
            <H id="template-engine">Website generation</H>
            <P>
              The Template Engine turns a lead into a complete, multi-page website. The
              important idea is that the brief is not written by hand: it is assembled
              from what sales already captured on the lead. The operator&apos;s job is to
              supervise, curate and approve.
            </P>

            <H3>The five-step wizard</H3>
            <Steps
              items={[
                ["Setup", "Choose the lead and a template. A readiness panel lists what the brief has and what it is missing — phone, email, services, service areas, colours, photos, requested page count — so gaps are visible before generation starts."],
                ["Content", "The system derives the page list and generates the site's copy: hero, services, statistics, testimonials, FAQ, about, and the title and meta description of every page. It also proposes a colour theme."],
                ["Images", "Candidate photographs are gathered for every image slot on the site, ranked, and presented for the operator to choose from. Only the chosen images are used."],
                ["Build", "The site is assembled file by file, with a live step tracker and an estimated time to completion."],
                ["Review", "Verification runs, the build can be previewed page by page and downloaded, and it can be reopened for edits and rebuilt."],
              ]}
            />

            <H3>How pages are chosen</H3>
            <P>
              Page selection is automatic. The pages the client asked for are matched
              against a canonical set — home, about, services, service areas, gallery
              and contact — and emitted in a sensible navigation order. Individual
              service and service-area pages are generated from the lists on the lead.
              If a business has no service areas, the area pages are simply not built.
            </P>

            <H3>Copywriting</H3>
            <P>
              Copy is generated from the real business details, and the generator is
              explicitly constrained: it may not invent licences, awards or
              certifications, testimonials must sit inside the areas the business
              actually serves, and if no email address is known, calls to action fall
              back to the phone number. The site&apos;s design files are never handed to
              the model, so the template&apos;s styling ships exactly as designed.
            </P>

            <H3>Imagery</H3>
            <P>
              For each image slot the system collects candidates from a stock photo
              library alongside any photos the client supplied, and an image-recognition
              pass scores every candidate for relevance to the slot and for visual
              quality. It can also detect and drop photographs containing people, which
              is on by default. The client&apos;s own photos are never dropped and always
              rank first.
            </P>
            <P>
              The operator picks from the ranked shortlist — several images for a hero
              area, one for everything else — and can ask for more candidates or paste
              a specific image URL of their own.
            </P>

            <H3>Verification gates</H3>
            <P>
              Before a build can reach review — or be deployed — it must pass two
              blocking checks:
            </P>
            <Bullets
              items={[
                <>
                  <strong className="text-text">Identity check.</strong> Every output file is
                  scanned for text left over from the demo template. Nothing belonging
                  to the sample business may survive into a client&apos;s site.
                </>,
                <>
                  <strong className="text-text">Structure check.</strong> The page skeleton and
                  script identifiers are compared against the template baseline, so a
                  generation pass cannot quietly break the markup or the interactive
                  behaviour.
                </>,
              ]}
            />
            <Note>
              A failed gate stops the build from being handed over at all. The result is
              recorded and shown on the review screen, so the operator knows exactly
              which file failed and why.
            </Note>

            {/* ------------------------ DEPLOYMENT ------------------------ */}
            <H id="deployment">Deployment &amp; domains</H>
            <P>
              A verified build can be published without leaving the console. Deployment
              happens in two phases, because clients want to see the real thing before
              they commit their domain to it.
            </P>
            <Steps
              items={[
                ["Publish to staging", "One click creates a subdomain on the company's staging domain, uploads the site, and writes the live link back onto the lead so everyone can find it."],
                ["Iterate", "Redeploy in place after changes — the previous files are cleared first, so pages you removed genuinely disappear. A site can also be taken down, which frees the subdomain and returns the build to review."],
                ["Transfer to the client's domain", "When the client approves, the site moves to their own domain. The files are pulled fresh from the live server rather than from the original build, so any manual tweaks made on staging survive the move. The staging subdomain is deleted afterwards."],
              ]}
            />
            <P>
              A deployments board lists every published site with its live URL, when it
              shipped, and the redeploy, take-down and transfer actions available to it.
              Sites built outside the wizard can also be uploaded and hosted the same
              way.
            </P>

            {/* -------------------------- MAILBOX -------------------------- */}
            <H id="mailbox">Company mailbox</H>
            <P>
              Company email accounts are linked to the people who use them, so an agent
              can work their own address inside the dashboard. Credentials are stored
              encrypted, and both the incoming and the outgoing connection are tested
              when the account is linked — a mailbox that cannot send is caught then,
              not at the moment someone tries to email a client.
            </P>
            <Bullets
              items={[
                <>
                  <strong className="text-text">Read.</strong> Inbox and Sent, as a message list
                  beside a reading pane, with sender, subject, date, a preview snippet
                  and an attachment indicator.
                </>,
                <>
                  <strong className="text-text">Compose and reply.</strong> Write a new message
                  or reply to the thread you are reading, with recipients, copies and a
                  subject.
                </>,
                <>
                  <strong className="text-text">Attachments.</strong> Attach files to anything
                  you send, and download what arrives. Sent messages are saved back to
                  the Sent folder.
                </>,
                <>
                  <strong className="text-text">Unread badge.</strong> New mail shows as a count
                  in the sidebar and on the browser tab. If the mail server is briefly
                  unreachable the badge simply reads zero rather than breaking the app.
                </>,
              ]}
            />
            <P>
              New mail is checked periodically in the background so the badge and the
              notifications stay current while you work elsewhere in the console.
            </P>

            {/* ------------------------- CONTRACTS ------------------------- */}
            <H id="contracts">Contracts &amp; templates</H>
            <P>
              Contracts are generated from your own documents. An administrator connects
              a Google account and registers Google Docs as contract templates; each
              template is an ordinary document with{" "}
              <Code>{"{{placeholders}}"}</Code> wherever a client-specific value belongs.
            </P>
            <Steps
              items={[
                ["Choose a template", "From the templates registered for your organisation."],
                ["Generate", "The template document is copied, its placeholders are filled from the lead, and the copy is exported as a PDF. The values used are snapshotted, so the contract cannot change under you afterwards."],
                ["Adjust the price", "The one-time and yearly figures can be overridden on a single contract to apply a discount; left alone, they inherit the lead's quoted prices."],
                ["Send", "The PDF is emailed from the agent's own verified company address, with a message the agent writes and their signature applied to the document."],
              ]}
            />
            <P>
              Placeholders cover the client (name, phone, email), pricing, the sending
              agent, the provider, and a range of date and time formats — for example{" "}
              <Code>{"{{business_name}}"}</Code>, <Code>{"{{one_time_price}}"}</Code>{" "}
              and <Code>{"{{date_long}}"}</Code>. A catalog inside the app lists every
              placeholder a template can use, including any custom fields on the lead.
            </P>
            <P>
              A contract only counts as sent once the email actually goes out. If
              sending fails it stays a draft and the agent is notified, rather than the
              record quietly claiming a client has been contacted. Every contract is
              listed centrally and shown on the lead it belongs to, and leads that
              already have one are badged in the table.
            </P>

            {/* ------------------------ OPERATIONS ------------------------ */}
            <H id="operations">Operations</H>

            <H3>
              <span className="inline-flex items-center gap-2">
                <Ticket className="w-4 h-4 text-accent" aria-hidden="true" />
                Tickets
              </span>
            </H3>
            <P>
              Post-sale work is tracked as tickets against the lead — change requests
              and improvements, with a priority, an assignee, a due date and a
              resolution note. A ticket carries a checklist whose items can be ticked
              off individually and can hold file attachments, so the work and its
              evidence stay together. Tickets that pass their due date are escalated
              automatically.
            </P>

            <H3>
              <span className="inline-flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-accent" aria-hidden="true" />
                Payments
              </span>
            </H3>
            <P>
              Payment links are managed inside the console with a label, amount,
              currency and category — website, yearly, add-on or other — so the right
              link is always at hand next to the client it belongs to. Viewing and
              managing them are separate permissions.
            </P>

            <H3>
              <span className="inline-flex items-center gap-2">
                <ChartColumn className="w-4 h-4 text-accent" aria-hidden="true" />
                Analytics
              </span>
            </H3>
            <P>
              The dashboard reports on the pipeline in numbers: totals, quoted and
              closed revenue, recurring revenue, average deal size, conversion rate, new
              leads this week, overdue follow-ups, pickup rate and ticket health.
              Charts cover leads over time, pipeline by status, leads by agent, site
              type split, rating distribution and revenue by status, and results can be
              scoped by month and region. There is also a per-agent view.
            </P>
            <Note>
              Individual metrics and charts are separately grantable, so a dashboard can
              be assembled to show a given department exactly what it should see — and
              nothing more.
            </Note>

            {/* ----------------------- PERMISSIONS ----------------------- */}
            <H id="permissions">Permissions</H>
            <P>
              Permissions are the individual capabilities in the system — viewing leads,
              editing them, deploying a website, sending a contract, opening the admin
              area, and so on. There are roughly ninety of them, grouped by module. They
              are enforced on the server for every request, not merely hidden in the
              interface.
            </P>
            <P>Access is resolved in three layers:</P>
            <Steps
              items={[
                ["Departments", "A department is a group with its own permission set — Sales, Management, Tech, Support, Admin, and any others an administrator creates. Grant features to the department once, then add people to it."],
                ["Membership", "A person can belong to more than one department. When they do, their access is the union of all of them, with no extra configuration."],
                ["User overrides", "An administrator can force-grant an extra permission, or revoke a specific one, for a single person — the exception that avoids reshaping a whole department."],
              ]}
            />
            <div className="mt-5 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-surface-2 px-4 py-2.5 font-mono text-sm text-text">
              access = <span className="text-accent-ink">Σ departments</span> + grants −{" "}
              <span className="text-dropped-fg">revokes</span>
            </div>
            <P>
              The result is a person&apos;s <strong className="text-text">effective access</strong>,
              recomputed every time they load a page — so a change takes effect
              immediately, with no redeploy.
            </P>
            <P>
              Sign-in is by invitation only. There is no public sign-up; accounts are
              created by an administrator, who can also deactivate an account to block
              access without erasing any of that person&apos;s history. Actions across
              the system are written to an activity log.
            </P>

            {/* ---------------------- NOTIFICATIONS ---------------------- */}
            <H id="notifications">Notifications</H>
            <P>
              Notifications are rule-driven rather than hard-coded. An administrator
              decides which events raise a notification, and who receives it — the
              lead&apos;s agent, its closer, a ticket&apos;s assignee or creator, and so
              on. Some events can fire ahead of time, such as a follow-up reminder a set
              number of minutes before it is due.
            </P>
            <div className="mt-5 grid sm:grid-cols-2 gap-3">
              {[
                { I: CalendarClock, t: "Follow-up reminders", d: "Before a scheduled follow-up falls due." },
                { I: Ticket, t: "Ticket activity", d: "Opened, assigned, resolved, reopened or overdue." },
                { I: Globe, t: "Website milestones", d: "A generated site is ready, or a live link is recorded." },
                { I: Inbox, t: "Incoming mail", d: "A new message lands in a linked company mailbox." },
                { I: Signature, t: "Contract problems", d: "A contract failed to send and is still a draft." },
                { I: Users, t: "New submissions", d: "A lead or pre-lead is submitted into the pipeline." },
              ].map((n) => (
                <div key={n.t} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-text">
                    <n.I className="w-4 h-4 text-accent" aria-hidden="true" />
                    {n.t}
                  </div>
                  <p className="text-sm text-text-muted mt-1.5 leading-relaxed">{n.d}</p>
                </div>
              ))}
            </div>

            {/* ------------------------- FAQ ------------------------- */}
            <H id="faq">FAQ</H>
            <div className="mt-5 space-y-3">
              {[
                [
                  "Can I sign up for an account?",
                  "No. Accounts are created by an administrator, which keeps the system closed to your team. If you have forgotten your password, an administrator can issue a new temporary one for you to change after signing in.",
                ],
                [
                  "Why can't I see a menu item someone else has?",
                  "The navigation only shows what your permissions allow. Ask an administrator to add you to the right department, or to grant you an individual override.",
                ],
                [
                  "Can a person belong to two departments?",
                  "Yes — their access becomes the combination of both, automatically.",
                ],
                [
                  "Does the AI decide which pages a website gets?",
                  "No. The page list comes from what the client asked for on the lead. The generator writes the content for those pages; it does not choose them.",
                ],
                [
                  "Can a broken website be handed to a client?",
                  "Not through the system. A build must pass its identity and structure checks before it can reach review or be deployed.",
                ],
                [
                  "What happens to the staging site after a domain transfer?",
                  "It is removed. The files are taken from the live staging server first, so nothing that was changed there is lost in the move.",
                ],
                [
                  "Which email address does a contract come from?",
                  "The sending agent's own linked company address, with their signature applied to the document — not a shared or system mailbox.",
                ],
              ].map(([q, a]) => (
                <div key={q} className="rounded-xl border border-border bg-surface p-5">
                  <div className="font-semibold text-text">{q}</div>
                  <div className="text-sm text-text-muted mt-1.5 leading-relaxed">{a}</div>
                </div>
              ))}
            </div>

            {/* -------------------------- CTA -------------------------- */}
            <div className="mt-16 rounded-2xl border border-accent/40 bg-surface-2 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="font-display text-xl font-bold text-text">
                  Ready to dive in?
                </div>
                <div className="text-sm text-text-muted mt-1">
                  Sign in and explore your dashboard — or see{" "}
                  <Link href="/changelog" className="text-accent-ink hover:underline">
                    what shipped recently
                  </Link>
                  .
                </div>
              </div>
              <Link
                href="/login"
                className="group inline-flex items-center justify-center gap-2 bg-accent text-white text-sm font-semibold rounded-lg px-5 py-3 hover:bg-accent-ink transition-colors whitespace-nowrap"
              >
                Log in
                <IconArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
