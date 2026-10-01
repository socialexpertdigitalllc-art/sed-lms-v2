"use client";

import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CalendarClock, CircleDollarSign, Gauge, HeartPulse, ListChecks, ShieldAlert, TrendingUp, Turtle } from "lucide-react";
import { PageHeader, Panel } from "@/components/common/Panel";
import { RelativeTime } from "@/components/common/RelativeTime";
import { useChartTheme } from "@/components/dashboard/chartTheme";
import { cn } from "@/lib/utils";
import { money } from "@/components/domains/DomainBits";
import type { ActionKind, DomainAnalytics } from "@/lib/domains/analytics";

const TEAL = "#0D9488";
const BLUE = "#2563EB";
const AMBER = "#D97706";
const RED = "#DC2626";
const GRAY = "#94A3B8";
const PURPLE = "#7E22CE";

const STATUS_COLOR: Record<string, string> = {
  live: TEAL,
  connected: BLUE,
  unassigned: GRAY,
  in_progress: PURPLE,
  needs_attention: RED,
};
const HEALTH_COLOR: Record<string, string> = { up: TEAL, down: RED, ssl_error: AMBER, parked: GRAY, no_dns: "#CBD5E1", unchecked: "#E2E8F0" };
const REGISTRAR_COLOR: Record<string, string> = { Hostinger: PURPLE, Cloudflare: AMBER };

const KIND_WORDS: Record<ActionKind, string> = {
  expired: "Expired",
  expiring: "Expiring",
  down: "Site down",
  ssl: "SSL problem",
  attention: "Setup stopped",
  missing: "Left account",
};

const usd = (cents: number) => money(cents, "USD");
const pctText = (v: number | null) => (v === null ? "—" : `${v}%`);

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-text-faint">{label}</div>
      <div
        className={cn(
          "mt-2 font-mono text-2xl font-semibold leading-none",
          tone === "bad" ? "text-dropped-fg" : tone === "warn" ? "text-notready-fg" : tone === "good" ? "text-ready-fg" : "text-text",
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs font-medium text-text-faint">{sub}</div> : null}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="grid h-full min-h-[150px] place-items-center text-sm text-text-faint">{label}</div>;
}

function Legend({ items }: { items: { name: string; color: string; value?: number }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((i) => (
        <span key={i.name} className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.name}
          {typeof i.value === "number" ? <span className="font-mono text-text">{i.value}</span> : null}
        </span>
      ))}
    </div>
  );
}

function Donut({ data, colors }: { data: { key?: string; name: string; value: number }[]; colors: Record<string, string> }) {
  const { tooltipStyle } = useChartTheme();
  if (!data.length) return <Empty label="Nothing yet" />;
  return (
    <>
      <ResponsiveContainer width="100%" height={170}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none" isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.name} fill={colors[d.key ?? d.name] ?? GRAY} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
      <Legend items={data.map((d) => ({ name: d.name, color: colors[d.key ?? d.name] ?? GRAY, value: d.value }))} />
    </>
  );
}

function RenewalCalendar({ data }: { data: DomainAnalytics["charts"]["renewalCalendar"] }) {
  const { grid, axisProps, tooltipStyle, cursorFill } = useChartTheme();
  if (!data.some((m) => m.renewing + m.notRenewing + m.unknown > 0)) return <Empty label="No renewals in the next 12 months" />;
  return (
    <>
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} allowDecimals={false} width={32} />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ fill: cursorFill }}
            formatter={(value, name) => [String(value), String(name)]}
            labelFormatter={(label, payload) => {
              const cents = (payload?.[0]?.payload as { cents?: number } | undefined)?.cents ?? 0;
              return `${label} — ${usd(cents)} to be charged`;
            }}
          />
          <Bar dataKey="renewing" stackId="r" fill={TEAL} name="Renews automatically" />
          <Bar dataKey="notRenewing" stackId="r" fill={RED} name="Won't renew" />
          <Bar dataKey="unknown" stackId="r" fill={GRAY} name="Unknown" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <Legend
        items={[
          { name: "Renews automatically", color: TEAL },
          { name: "Won't renew", color: RED },
          { name: "Unknown", color: GRAY },
        ]}
      />
    </>
  );
}

function UptimeTrend({ data }: { data: DomainAnalytics["charts"]["uptimeDaily"] }) {
  const { grid, axisProps, tooltipStyle } = useChartTheme();
  const points = data.filter((d) => d.uptime !== null);
  if (!points.length) return <Empty label="Uptime appears after the first checks" />;
  const min = Math.max(0, Math.floor(Math.min(...points.map((p) => p.uptime!)) - 2));
  return (
    <ResponsiveContainer width="100%" height={210}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="uptimeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TEAL} stopOpacity={0.35} />
            <stop offset="100%" stopColor={TEAL} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={grid} vertical={false} />
        <XAxis dataKey="day" {...axisProps} tickFormatter={(v: string) => `${Number(v.slice(5, 7))}/${Number(v.slice(8, 10))}`} minTickGap={28} />
        <YAxis {...axisProps} domain={[min, 100]} width={36} tickFormatter={(v: number) => `${v}%`} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => (name === "uptime" ? [`${value}%`, "Uptime"] : [`${value} ms`, "Avg response"])}
          labelFormatter={(label) => new Date(`${label}T00:00:00Z`).toLocaleDateString()}
        />
        <Area type="monotone" dataKey="uptime" stroke={TEAL} strokeWidth={2} fill="url(#uptimeFill)" connectNulls />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function Growth({ data }: { data: DomainAnalytics["charts"]["growth"] }) {
  const { grid, axisProps, tooltipStyle, cursorFill } = useChartTheme();
  if (!data.some((d) => d.total > 0)) return <Empty label="No registrations yet" />;
  return (
    <ResponsiveContainer width="100%" height={210}>
      <ComposedChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={grid} vertical={false} />
        <XAxis dataKey="label" {...axisProps} minTickGap={24} />
        <YAxis yAxisId="added" {...axisProps} allowDecimals={false} width={32} />
        <YAxis yAxisId="total" orientation="right" {...axisProps} allowDecimals={false} width={36} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: cursorFill }} />
        <Bar yAxisId="added" dataKey="added" fill={BLUE} name="Registered that month" radius={[3, 3, 0, 0]} />
        <Line yAxisId="total" type="monotone" dataKey="total" stroke={TEAL} strokeWidth={2} dot={false} name="Domains in total" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function HBars({ data, color }: { data: { name: string; value: number }[]; color: string | Record<string, string> }) {
  const { grid, axisProps, tooltipStyle, cursorFill } = useChartTheme();
  if (!data.length) return <Empty label="Nothing yet" />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(90, data.length * 30)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={grid} horizontal={false} />
        <XAxis type="number" {...axisProps} allowDecimals={false} />
        <YAxis type="category" dataKey="name" {...axisProps} width={78} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: cursorFill }} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16} name="Domains">
          {data.map((d) => (
            <Cell key={d.name} fill={typeof color === "string" ? color : (color[d.name] ?? TEAL)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const SEVERITY_DOT: Record<number, string> = { 3: "bg-dropped-fg", 2: "bg-notready-fg", 1: "bg-text-faint" };

/**
 * Domains analytics: how many we hold and where, what renewing them costs and
 * when, how the client sites are doing, how the portfolio grew, and the list of
 * things to act on — most urgent first.
 */
export function DomainAnalyticsView({ data }: { data: DomainAnalytics }) {
  const t = data.totals;
  const m = data.money;
  const k = data.kpis;
  const sitesChecked = t.sitesUp + t.sitesDown + t.sslIssues;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Domain analytics"
        description="Portfolio, renewals, costs and site health across Hostinger and Cloudflare. Registrar figures refresh every six hours; site checks every few hours."
        action={
          <span className="text-xs text-text-faint">
            Updated <RelativeTime iso={data.generatedAt} />
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Domains" value={String(t.domains)} sub={`${t.hostinger} Hostinger · ${t.cloudflare} Cloudflare`} />
        <Tile
          label="Sites up now"
          value={pctText(k.healthyRate)}
          sub={sitesChecked ? `${t.sitesUp} of ${sitesChecked} checked sites` : "No checks yet"}
          tone={k.healthyRate === null ? undefined : k.healthyRate >= 98 ? "good" : k.healthyRate >= 90 ? "warn" : "bad"}
        />
        <Tile
          label="Uptime · 30 days"
          value={pctText(k.uptime30)}
          sub={k.avgResponseMs !== null ? `${k.avgResponseMs} ms average response` : "Builds up as sites are checked"}
          tone={k.uptime30 === null ? undefined : k.uptime30 >= 99 ? "good" : k.uptime30 >= 95 ? "warn" : "bad"}
        />
        <Tile
          label="Renewing automatically"
          value={pctText(k.autoRenewRate)}
          sub={`${t.autoRenewOn} on · ${t.autoRenewOff} off${t.autoRenewUnknown ? ` · ${t.autoRenewUnknown} unknown` : ""}`}
          tone={k.autoRenewRate === null ? undefined : k.autoRenewRate >= 90 ? "good" : "warn"}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile label="Renewals per year" value={usd(m.annualRenewalCents)} sub={`${usd(m.annualAllCents)} if every domain renewed`} />
        <Tile label="Charges next 30 days" value={usd(m.next30Cents)} sub={`${usd(m.next90Cents)} in the next 90`} />
        <Tile label="Expiring ≤ 30 days" value={String(t.atRisk30)} sub="not set to renew" tone={t.atRisk30 ? "warn" : "good"} />
        <Tile label="Expired" value={String(t.expired)} sub={t.missing ? `${t.missing} left the account` : "still in the account"} tone={t.expired ? "bad" : "good"} />
        <Tile label="Sites down / SSL" value={`${t.sitesDown} / ${t.sslIssues}`} sub="of sites that should be up" tone={t.sitesDown + t.sslIssues ? "bad" : "good"} />
        <Tile label="Linked to leads" value={pctText(k.linkRate)} sub={`${t.linked} linked · ${t.unlinked} not`} />
        <Tile label="Spent on purchases" value={usd(m.spentCents)} sub="domains bought from the dashboard" />
        <Tile
          label="Possible savings"
          value={m.savings.cents ? `${usd(m.savings.cents)}/yr` : "—"}
          sub={m.savings.domains ? `moving ${m.savings.domains} renewing Hostinger domain${m.savings.domains === 1 ? "" : "s"} to Cloudflare` : "nothing to gain"}
          tone={m.savings.cents ? "good" : undefined}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel icon={CalendarClock} title="Renewals due" description="By expiry month, the next 12 months" className="lg:col-span-2">
          <RenewalCalendar data={data.charts.renewalCalendar} />
        </Panel>
        <Panel icon={ListChecks} title="Setup status">
          <Donut data={data.charts.statusMix} colors={STATUS_COLOR} />
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel icon={HeartPulse} title="Uptime" description="All client sites, per day, last 30 days" className="lg:col-span-2">
          <UptimeTrend data={data.charts.uptimeDaily} />
        </Panel>
        <Panel icon={Gauge} title="Site health now">
          <Donut data={data.charts.healthMix} colors={HEALTH_COLOR} />
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel icon={TrendingUp} title="Portfolio growth" description="Registrations per month and the running total, last 24 months" className="lg:col-span-2">
          <Growth data={data.charts.growth} />
        </Panel>
        <Panel icon={CircleDollarSign} title="Where they're registered">
          <HBars data={data.charts.registrarMix} color={REGISTRAR_COLOR} />
          <p className="mb-1 mt-4 text-xs font-semibold text-text-muted">Extensions</p>
          <HBars data={data.charts.tldMix} color={BLUE} />
        </Panel>
      </div>

      <Panel icon={AlertTriangle} title="Needs action" description="Most urgent first" count={data.lists.actionItems.length} flush>
        {data.lists.actionItems.length === 0 ? (
          <p className="p-4 text-sm text-ready-fg">Nothing to act on — every domain is renewing and every site is up.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-text-muted">
                <tr>
                  <th className="w-6 px-4 py-2" />
                  <th className="px-4 py-2">Domain</th>
                  <th className="px-4 py-2">Lead</th>
                  <th className="px-4 py-2">Issue</th>
                  <th className="px-4 py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.lists.actionItems.map((a) => (
                  <tr key={`${a.id}-${a.kind}`} className="border-b border-border-subtle last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-2">
                      <span className={cn("block h-2 w-2 rounded-full", SEVERITY_DOT[a.severity])} title={a.severity === 3 ? "Act today" : a.severity === 2 ? "This week" : "When convenient"} />
                    </td>
                    <td className="px-4 py-2">
                      <Link href={`/domains/${a.id}`} className="font-medium text-accent-ink hover:underline">
                        {a.domain}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-text-muted">{a.lead ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-text">{KIND_WORDS[a.kind]}</td>
                    <td className="px-4 py-2 text-text-muted">{a.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-5 md:grid-cols-3">
        <Panel icon={HeartPulse} title="Least reliable" description="Uptime, 30 days" flush>
          {data.lists.worstUptime.length === 0 ? (
            <p className="p-4 text-sm text-text-muted">No site has failed a check.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {data.lists.worstUptime.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <Link href={`/domains/${w.id}`} className="truncate text-accent-ink hover:underline">
                    {w.domain}
                  </Link>
                  <span className="shrink-0 font-mono text-xs text-dropped-fg">{w.uptime}%</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel icon={Turtle} title="Slowest" description="Average response, 30 days" flush>
          {data.lists.slowest.length === 0 ? (
            <p className="p-4 text-sm text-text-muted">Appears after the first checks.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {data.lists.slowest.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <Link href={`/domains/${s.id}`} className="truncate text-accent-ink hover:underline">
                    {s.domain}
                  </Link>
                  <span className="shrink-0 font-mono text-xs text-text-muted">{s.avgMs} ms</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel icon={ShieldAlert} title="SSL certificates" description="Expiring within 14 days" flush>
          {data.lists.sslExpiring.length === 0 ? (
            <p className="p-4 text-sm text-text-muted">None — Hostinger renews them automatically.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {data.lists.sslExpiring.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <Link href={`/domains/${s.id}`} className="truncate text-accent-ink hover:underline">
                    {s.domain}
                  </Link>
                  <span className={cn("shrink-0 font-mono text-xs", s.days < 0 ? "text-dropped-fg" : "text-notready-fg")}>{s.days < 0 ? "expired" : `${s.days}d`}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {k.setupSuccessRate !== null || k.medianSetupHours !== null ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Tile label="Setup success" value={pctText(k.setupSuccessRate)} sub="bought domains that went live" />
          <Tile label="Time to live" value={k.medianSetupHours === null ? "—" : `${k.medianSetupHours} h`} sub="median, purchase → site live" />
        </div>
      ) : null}
    </div>
  );
}
