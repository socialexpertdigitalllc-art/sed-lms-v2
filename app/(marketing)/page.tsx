import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DashboardPreview } from "@/components/marketing/DashboardPreview";
import {
  IconLeads,
  IconShield,
  IconChart,
  IconSparkles,
  IconHistory,
  IconDatabase,
  IconLayers,
  IconKey,
  IconArrowRight,
  IconCheck,
} from "@/components/marketing/icons";

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const primaryHref = user ? "/dashboard" : "/login";
  const primaryLabel = user ? "Open dashboard" : "Log in";

  return (
    <>
      {/* ============================= HERO ============================= */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grid" />
        <div className="absolute -top-32 -left-24 w-[520px] h-[520px] glow-teal pointer-events-none" />
        <div className="absolute top-10 right-0 w-[420px] h-[420px] glow-blue pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-bg" />

        <div className="relative mx-auto max-w-6xl px-5 pt-20 pb-16 md:pt-28">
          <div className="max-w-3xl">
            <span
              className="reveal inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-text-muted"
              style={{ animationDelay: "0ms" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              Lead Management System · v2
            </span>

            <h1
              className="reveal font-display text-[40px] leading-[1.05] sm:text-[58px] font-bold tracking-tight text-text mt-6"
              style={{ animationDelay: "80ms" }}
            >
              Every lead, every agent,
              <br className="hidden sm:block" /> every department —{" "}
              <span className="text-accent">one console.</span>
            </h1>

            <p
              className="reveal text-lg text-text-muted mt-6 max-w-2xl leading-relaxed"
              style={{ animationDelay: "160ms" }}
            >
              SED LMS replaces scattered spreadsheets with a permission-aware command center.
              Create users, departments, and granular access right from the dashboard — no code,
              no rebuilds, nothing lost.
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
            <DashboardPreview />
          </div>
        </div>
      </section>

      {/* ===================== DEPARTMENTS STRIP ===================== */}
      <section className="border-y border-border bg-surface-2">
        <div className="mx-auto max-w-6xl px-5 py-8 flex flex-col sm:flex-row items-center gap-x-8 gap-y-4">
          <p className="text-xs uppercase tracking-wider text-text-faint font-semibold whitespace-nowrap">
            Built for how your team works
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            {[
              { n: "Sales", c: "#0D9488" },
              { n: "Management", c: "#7E22CE" },
              { n: "Tech", c: "#2563EB" },
              { n: "Support", c: "#B45309" },
              { n: "Admin", c: "#141B2D" },
            ].map((d) => (
              <span
                key={d.n}
                className="text-sm font-medium rounded-full px-3.5 py-1.5 border border-border bg-surface"
                style={{ color: d.c }}
              >
                {d.n}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ========================= FEATURES ========================= */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-20 md:py-28 scroll-mt-20">
        <div className="max-w-2xl">
          <p className="text-xs font-mono uppercase tracking-wider text-accent-ink">What you get</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-text mt-3">
            Everything the old system did — done properly.
          </h2>
          <p className="text-text-muted mt-4 leading-relaxed">
            Rebuilt from the ground up on a real database, with the structure to grow as the team does.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-12">
          {[
            { I: IconLeads, t: "Unified lead pipeline", d: "Every lead in one sortable, filterable table — statuses, inline editing, and recoverable soft-delete." },
            { I: IconShield, t: "Departments & permissions", d: "Three-layer access control: department defaults, multi-department membership, and per-user overrides." },
            { I: IconChart, t: "Live KPIs & analytics", d: "Pipeline health, quoted revenue, agent performance, and trends — computed from real data." },
            { I: IconSparkles, t: "AI website tools", d: "Generate client sites with built-in AI generators, measured and logged per agent." },
            { I: IconHistory, t: "Full audit trail", d: "Every action recorded — who changed what, when, with before-and-after values." },
            { I: IconDatabase, t: "A real database", d: "PostgreSQL with constraints, relationships, and backups. No more fragile, breakable sheets." },
          ].map((f) => (
            <div
              key={f.t}
              className="group rounded-xl border border-border bg-surface p-5 hover:border-accent/60 hover:shadow-[0_18px_40px_-24px_rgba(13,148,136,0.45)] transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-accent-soft text-accent-ink grid place-items-center">
                <f.I className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-text mt-4">{f.t}</h3>
              <p className="text-sm text-text-muted mt-1.5 leading-relaxed">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ====================== PERMISSIONS ====================== */}
      <section id="permissions" className="relative border-y border-border bg-surface-2 scroll-mt-20">
        <div className="mx-auto max-w-6xl px-5 py-20 md:py-28">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-accent-ink">The core idea</p>
              <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-text mt-3">
                Access that bends to your org — not the other way around.
              </h2>
              <p className="text-text-muted mt-4 leading-relaxed">
                A user&apos;s access is resolved live: start with the permissions of every department
                they belong to, then layer on individual grants or revokes. Put someone in two
                departments and they get the union automatically. Need an exception? One override —
                no code, no redeploy.
              </p>
              <div className="mt-6 inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 font-mono text-sm text-text">
                access = <span className="text-accent-ink">Σ departments</span> + grants −{" "}
                <span className="text-dropped-fg">revokes</span>
              </div>
            </div>

            {/* layered diagram */}
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
                  <div className="flex-1 rounded-xl border border-border bg-surface px-4 py-3">
                    <div className="font-semibold text-text text-sm">{s.t}</div>
                    <div className="text-xs text-text-muted mt-0.5">{s.d}</div>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-4 pt-1">
                <div className="w-11 h-11 rounded-xl grid place-items-center bg-accent text-white">
                  <IconCheck className="w-5 h-5" />
                </div>
                <div className="flex-1 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3">
                  <div className="font-semibold text-accent-ink text-sm">Effective access</div>
                  <div className="text-xs text-accent-ink/80 mt-0.5">
                    What the user actually sees and can do — recomputed on every request.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ======================== WORKFLOW ======================== */}
      <section id="workflow" className="mx-auto max-w-6xl px-5 py-20 md:py-28 scroll-mt-20">
        <div className="max-w-2xl">
          <p className="text-xs font-mono uppercase tracking-wider text-accent-ink">How it works</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-text mt-3">
            Up and running in four steps.
          </h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-12">
          {[
            { n: "01", t: "Shape departments", d: "Create departments and toggle exactly which features each one can use." },
            { n: "02", t: "Invite your team", d: "Add users with a temporary password and assign them to one or more departments." },
            { n: "03", t: "Work the pipeline", d: "Capture, edit, and move leads through statuses — with live KPIs the whole time." },
            { n: "04", t: "Adjust anytime", d: "Change permissions or add overrides from the admin panel. It takes seconds." },
          ].map((s) => (
            <div key={s.n} className="rounded-xl border border-border bg-surface p-5">
              <div className="font-mono text-2xl font-semibold text-accent">{s.n}</div>
              <h3 className="font-semibold text-text mt-3">{s.t}</h3>
              <p className="text-sm text-text-muted mt-1.5 leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===================== OLD VS NEW ===================== */}
      <section className="border-t border-border bg-surface-2">
        <div className="mx-auto max-w-5xl px-5 py-20 md:py-24">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-text">
              From spreadsheets to a system.
            </h2>
            <p className="text-text-muted mt-4">The same work, without the fragility.</p>
          </div>

          <div className="mt-12 grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-surface p-6">
              <div className="text-xs font-mono uppercase tracking-wider text-text-faint">Before</div>
              <ul className="mt-4 space-y-3">
                {[
                  "Add a user = edit a config file and restart the server",
                  "Permissions hard-coded — every change is a redeploy",
                  "Data in Google Sheets — breakable, no constraints",
                  "No history of who changed what",
                ].map((t) => (
                  <li key={t} className="flex gap-3 text-sm text-text-muted">
                    <span className="mt-2 w-1.5 h-1.5 rounded-full bg-dropped-fg shrink-0" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-accent/40 bg-surface p-6 shadow-[0_24px_60px_-30px_rgba(13,148,136,0.5)]">
              <div className="text-xs font-mono uppercase tracking-wider text-accent-ink">Now</div>
              <ul className="mt-4 space-y-3">
                {[
                  "Invite a user from the admin panel in seconds",
                  "Toggle permissions in a grid — live, no code",
                  "PostgreSQL with constraints, relationships, backups",
                  "Full activity log on every action",
                ].map((t) => (
                  <li key={t} className="flex gap-3 text-sm text-text">
                    <IconCheck className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ========================= CTA ========================= */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-60" />
        <div className="absolute left-1/2 -translate-x-1/2 top-0 w-[600px] h-[300px] glow-teal pointer-events-none" />
        <div className="relative mx-auto max-w-3xl px-5 py-24 text-center">
          <h2 className="font-display text-3xl sm:text-5xl font-bold tracking-tight text-text">
            Take control of your pipeline.
          </h2>
          <p className="text-text-muted mt-5 text-lg">
            Sign in to the console and put every lead, agent, and permission in one place.
          </p>
          <div className="flex items-center justify-center gap-3 mt-8">
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
        </div>
      </section>
    </>
  );
}
