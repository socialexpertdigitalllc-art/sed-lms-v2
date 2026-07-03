import Link from "next/link";
import type { Metadata } from "next";
import { IconArrowRight } from "@/components/marketing/icons";

export const metadata: Metadata = {
  title: "Documentation — SED LMS",
  description: "How to use the SED Lead Management System.",
};

const TOC = [
  { id: "introduction", label: "Introduction" },
  { id: "getting-started", label: "Getting started" },
  { id: "dashboard", label: "The dashboard" },
  { id: "departments", label: "Departments" },
  { id: "permissions", label: "Permissions" },
  { id: "users", label: "Managing users" },
  { id: "leads", label: "Working with leads" },
  { id: "faq", label: "FAQ" },
];

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="font-display text-2xl font-bold tracking-tight text-text scroll-mt-24 mt-14 first:mt-0"
    >
      {children}
    </h2>
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
            <Link
              href="/login"
              className="mt-6 group inline-flex items-center gap-1.5 text-sm font-semibold text-accent-ink"
            >
              Open the console
              <IconArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </aside>

        {/* content */}
        <article className="min-w-0 max-w-2xl">
          <p className="text-xs font-mono uppercase tracking-wider text-accent-ink">Documentation</p>
          <h1 className="font-display text-4xl font-bold tracking-tight text-text mt-3">
            Using SED LMS
          </h1>
          <p className="text-lg text-text-muted mt-4 leading-relaxed">
            A practical guide to the lead-management console — logging in, how access works, and
            how to run your pipeline.
          </p>

          <H id="introduction">Introduction</H>
          <P>
            SED LMS is the lead-management system for Social Expert Digital. It brings every lead,
            agent, and department into one place, and lets administrators control exactly who can
            see and do what — entirely from the dashboard.
          </P>
          <P>
            The system is organized around <strong className="text-text">departments</strong> (like
            Sales, Management, Tech, and Support) and a set of{" "}
            <strong className="text-text">permissions</strong> that decide which features each
            person can use.
          </P>

          <H id="getting-started">Getting started</H>
          <P>
            You access SED LMS with the email and temporary password your administrator created for
            you. From the landing page, choose <Code>Log in</Code>, enter your credentials, and you
            will land on your dashboard. You can change your password from the account menu after
            signing in.
          </P>
          <div className="mt-5 rounded-xl border border-border bg-surface-2 p-4 text-sm text-text-muted">
            <span className="font-semibold text-text">Note:</span> there is no public sign-up. New
            accounts are always created by an administrator, which keeps the system locked down to
            your team.
          </div>

          <H id="dashboard">The dashboard</H>
          <P>
            After signing in you see a sidebar on the left and your workspace on the right. The
            sidebar only shows the sections you have permission to use — so two people in different
            departments may see different menus. The top bar has global search and your account
            menu.
          </P>

          <H id="departments">Departments</H>
          <P>
            A department is a group with its own set of permissions. Instead of configuring access
            person-by-person, you grant features to a department once, then add people to it. The
            system ships with Sales, Management, Tech, Support, and Admin, and administrators can
            create more.
          </P>
          <P>
            A person can belong to <strong className="text-text">more than one</strong> department.
            When they do, their access is the combination of all of them — no extra setup required.
          </P>

          <H id="permissions">Permissions</H>
          <P>
            Permissions are the individual capabilities in the system — for example{" "}
            <Code>leads.view</Code>, <Code>leads.edit</Code>, or <Code>admin.users.create</Code>.
            Access is resolved in three layers:
          </P>
          <ol className="mt-4 space-y-3">
            {[
              ["Department permissions", "The baseline — everything granted by the departments a person belongs to."],
              ["Membership", "Belong to several departments and you get the union of all their permissions."],
              ["User overrides", "An administrator can force-grant an extra permission, or revoke a specific one, for a single person."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="font-mono text-sm text-accent-ink shrink-0 w-6">{i + 1}.</span>
                <span className="text-text-muted leading-relaxed">
                  <strong className="text-text">{t}.</strong> {d}
                </span>
              </li>
            ))}
          </ol>
          <P>
            The result is a person&apos;s <strong className="text-text">effective access</strong>,
            recomputed every time they load a page — so changes take effect immediately.
          </P>

          <H id="users">Managing users</H>
          <P>
            Administrators manage people from <Code>Admin → Users</Code>. Creating a user takes an
            email, a display name, a temporary password, and at least one department. From a
            user&apos;s detail page you can change their departments, add permission overrides, or
            deactivate the account to block sign-in without deleting any history.
          </P>

          <H id="leads">Working with leads</H>
          <P>
            Leads live in a single, searchable table with statuses such as Ready, Not Ready, Closed,
            and Dropped. You can filter by status, agent, or type, sort by follow-up time, price, or
            rating, and open any lead to edit its details inline. Deleting a lead is a safe
            soft-delete, so nothing is ever truly lost. The dashboard rolls all of this up into live
            KPIs and charts.
          </P>

          <H id="faq">FAQ</H>
          <div className="mt-5 space-y-5">
            {[
              ["I forgot my password.", "Ask an administrator to set a new temporary password for you, then change it after signing in."],
              ["Why can't I see a menu item?", "The sidebar only shows what your permissions allow. If you need access to something, ask an administrator to add you to the right department or grant an override."],
              ["Can someone be in two departments?", "Yes. Their access becomes the combination of both, automatically."],
              ["Is my data safe?", "Everything is stored in a managed PostgreSQL database with proper constraints, access rules, and backups."],
            ].map(([q, a]) => (
              <div key={q} className="rounded-xl border border-border bg-surface p-5">
                <div className="font-semibold text-text">{q}</div>
                <div className="text-sm text-text-muted mt-1.5 leading-relaxed">{a}</div>
              </div>
            ))}
          </div>

          <div className="mt-14 rounded-2xl border border-accent/40 bg-surface-2 p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <div className="font-display text-xl font-bold text-text">Ready to dive in?</div>
              <div className="text-sm text-text-muted mt-1">Sign in and explore your dashboard.</div>
            </div>
            <Link
              href="/login"
              className="group inline-flex items-center gap-2 bg-accent text-white text-sm font-semibold rounded-lg px-5 py-3 hover:bg-accent-ink transition-colors whitespace-nowrap"
            >
              Log in
              <IconArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </article>
      </div>
    </div>
  );
}
