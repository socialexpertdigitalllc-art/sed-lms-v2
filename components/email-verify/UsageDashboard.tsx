"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, Database, Info, RefreshCw, Loader2, Target, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Panel, Pill } from "@/components/common/Panel";
import { btnSecondarySm } from "@/components/common/buttons";
import { PROVIDER_LABEL } from "@/lib/email-verify/labels";
import type { Scorecard, UsageStats, Verdict } from "@/lib/email-verify/scorecard";
import type { ProviderQuota } from "@/lib/email-verify/balance";
import type { ProviderName } from "@/lib/email-verify/types";

/**
 * Read-only usage + accuracy dashboard. Every number here comes from rows we
 * already stored — rendering this page never touches a provider and never
 * spends a credit.
 */

interface StatsPayload {
  days: number;
  usage: UsageStats;
  scorecard: Scorecard;
  quotas: ProviderQuota[];
  outcomes: { hardBounces: number; softBounces: number };
}

const RANGES = [30, 90] as const;

const VERDICT_TONE: Record<Verdict, { bar: string; pill: "ready" | "notready" | "dropped"; label: string }> = {
  OK: { bar: "bg-ready-fg", pill: "ready", label: "OK" },
  WARN: { bar: "bg-notready-fg", pill: "notready", label: "Warn" },
  BLOCK: { bar: "bg-dropped-fg", pill: "dropped", label: "Block" },
};

function providerLabel(key: string): string {
  return PROVIDER_LABEL[key as ProviderName] ?? key;
}

function pct(n: number | null): string {
  return n === null ? "—" : `${(n * 100).toFixed(n * 100 < 10 ? 1 : 0)}%`;
}

/** Zero-filled day series so a quiet week reads as a gap, not a missing bar. */
function fillDays(perDay: { date: string; count: number }[], days: number): { date: string; count: number }[] {
  const have = new Map(perDay.map((d) => [d.date, d.count]));
  const out: { date: string; count: number }[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const iso = d.toISOString().slice(0, 10);
    out.push({ date: iso, count: have.get(iso) ?? 0 });
  }
  return out;
}

/* ------------------------------------------------------------------- parts */

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ready" | "accent" | "dropped" }) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-2 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-faint">{label}</p>
      <p
        className={cn(
          "tabular mt-1 font-mono text-xl leading-none",
          tone === "ready" ? "text-ready-fg" : tone === "dropped" ? "text-dropped-fg" : tone === "accent" ? "text-accent-ink" : "text-text",
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{sub}</p> : null}
    </div>
  );
}

function DayChart({ series }: { series: { date: string; count: number }[] }) {
  const max = Math.max(1, ...series.map((d) => d.count));
  const total = series.reduce((a, d) => a + d.count, 0);

  if (!total) {
    return <p className="py-8 text-center text-xs text-text-faint">No verifications recorded in this window.</p>;
  }

  return (
    <div>
      <div className="flex h-32 items-end gap-px" role="img" aria-label={`Verifications per day over the last ${series.length} days`}>
        {series.map((d) => (
          <div
            key={d.date}
            title={`${d.date}: ${d.count}`}
            className="min-h-px flex-1 rounded-sm bg-accent transition-colors duration-150 hover:bg-accent-ink"
            style={{ height: `${Math.max(2, (d.count / max) * 100)}%`, opacity: d.count === 0 ? 0.18 : 1 }}
          />
        ))}
      </div>
      <div className="tabular mt-1.5 flex justify-between font-mono text-[11px] text-text-faint">
        <span>{series[0]?.date}</span>
        <span>peak {max}/day</span>
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function Bars({ rows, empty }: { rows: { key: string; label: string; count: number; bar: string }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <p className="py-6 text-center text-xs text-text-faint">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs text-text">{r.label}</span>
            <span className="tabular shrink-0 font-mono text-xs text-text-muted">{r.count}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border-subtle">
            <div className={cn("h-full rounded-full", r.bar)} style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[76px] animate-pulse rounded-md border border-border-subtle bg-surface-2" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-lg border border-border bg-surface" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-40 animate-pulse rounded-lg border border-border bg-surface" />
        <div className="h-40 animate-pulse rounded-lg border border-border bg-surface" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- shell */

export function UsageDashboard() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/email-verify-stats?days=${days}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
        return json as StatsPayload;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days, nonce]);

  const series = useMemo(() => (data ? fillDays(data.usage.perDay, data.days) : []), [data]);

  const switcher = (
    <div className="flex items-center gap-1">
      <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="Day range">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setDays(r)}
            aria-pressed={days === r}
            className={cn(
              "tabular px-2.5 py-1.5 font-mono text-xs transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
              days === r ? "bg-accent text-white" : "bg-surface text-text-muted hover:bg-surface-2 hover:text-text",
            )}
          >
            {r}d
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setNonce((n) => n + 1)} disabled={loading} className={btnSecondarySm} title="Reload the statistics">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Reload
      </button>
    </div>
  );

  if (error) {
    return (
      <Panel icon={BarChart3} title="Usage & accuracy" action={switcher}>
        <p className="flex items-start gap-2 text-xs leading-relaxed text-dropped-fg">
          <TriangleAlert className="mt-px h-4 w-4 shrink-0" aria-hidden />
          <span>Could not load the statistics. {error}</span>
        </p>
      </Panel>
    );
  }

  if (loading && !data) {
    return (
      <Panel icon={BarChart3} title="Usage & accuracy" action={switcher}>
        <DashboardSkeleton />
      </Panel>
    );
  }
  if (!data) return null;

  const { usage, scorecard, outcomes } = data;
  const providerRows = Object.entries(usage.byProvider)
    .map(([key, count]) => ({ key, label: providerLabel(key), count, bar: "bg-accent" }))
    .sort((a, b) => b.count - a.count);
  const verdictRows = (Object.keys(VERDICT_TONE) as Verdict[]).map((v) => ({
    key: v,
    label: VERDICT_TONE[v].label,
    count: usage.verdicts[v] ?? 0,
    bar: VERDICT_TONE[v].bar,
  }));

  return (
    <Panel
      icon={BarChart3}
      title="Usage & accuracy"
      description={`Everything recorded in the last ${data.days} days. Reading this page costs no credits.`}
      action={switcher}
    >
      <div className={cn("space-y-4", loading && "opacity-60 transition-opacity duration-150")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Lookups" value={String(usage.total)} sub={`over ${data.days} days`} />
          <Stat label="Paid to a provider" value={String(usage.billed)} sub="reached a vendor API" />
          <Stat
            label="Cache hit rate"
            value={pct(usage.cacheHitRate)}
            sub={`${usage.cached} credit${usage.cached === 1 ? "" : "s"} saved by re-using a stored answer`}
            tone="ready"
          />
          <Stat label="Hard bounces" value={String(outcomes.hardBounces)} sub={`${outcomes.softBounces} soft (not counted against anyone)`} tone={outcomes.hardBounces ? "dropped" : undefined} />
        </div>

        <div className="rounded-md border border-border-subtle bg-surface-2 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Activity className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
            <span className="text-xs font-medium text-text">Verifications over time</span>
          </div>
          <DayChart series={series} />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-md border border-border-subtle bg-surface-2 p-3">
            <div className="mb-2.5 flex items-center gap-2">
              <Database className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
              <span className="text-xs font-medium text-text">Answers per provider</span>
            </div>
            <Bars rows={providerRows} empty="No provider has been asked yet — every verdict so far came from the local checks." />
          </div>

          <div className="rounded-md border border-border-subtle bg-surface-2 p-3">
            <div className="mb-2.5 flex items-center gap-2">
              <Target className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
              <span className="text-xs font-medium text-text">Verdict distribution</span>
            </div>
            <Bars rows={verdictRows} empty="No verdicts recorded yet." />
          </div>
        </div>

        {/* ---------------------------------------------------- scorecard */}
        <div className="overflow-hidden rounded-md border border-border-subtle">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-2 px-3 py-2.5">
            <span className="text-xs font-medium text-text">Accuracy scorecard</span>
            <span className="tabular font-mono text-[11px] text-text-faint">
              needs {scorecard.minSample}+ positive calls
            </span>
          </div>
          <p className="flex items-start gap-1.5 border-b border-border-subtle px-3 py-2 text-[11px] leading-relaxed text-text-muted">
            <Info className="mt-px h-3.5 w-3.5 shrink-0 text-text-faint" aria-hidden />
            <span>
              The false-positive rate counts addresses a provider called good that later hard-bounced from your own mailbox. Soft bounces
              and bounces that predate the check are excluded.
            </span>
          </p>

          {scorecard.providers.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-text-faint">
              No provider-backed verifications yet, so there is nothing to score.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead>
                  <tr className="border-b border-border-subtle text-left text-[11px] text-text-faint">
                    <th className="px-3 py-2 font-medium">Provider</th>
                    <th className="px-3 py-2 text-right font-medium">Verifications</th>
                    <th className="px-3 py-2 text-right font-medium">Called good</th>
                    <th className="px-3 py-2 text-right font-medium">Later hard-bounced</th>
                    <th className="px-3 py-2 text-right font-medium">False-positive rate</th>
                  </tr>
                </thead>
                <tbody>
                  {scorecard.providers.map((s) => (
                    <tr key={s.provider} className="border-b border-border-subtle last:border-0">
                      <td className="px-3 py-2 text-text">{providerLabel(s.provider)}</td>
                      <td className="tabular px-3 py-2 text-right font-mono text-text-muted">{s.verifications}</td>
                      <td className="tabular px-3 py-2 text-right font-mono text-text-muted">{s.positives}</td>
                      <td className="tabular px-3 py-2 text-right font-mono text-text-muted">{s.falsePositives}</td>
                      <td className="px-3 py-2 text-right">
                        {s.insufficientData ? (
                          <span
                            className="text-[11px] text-text-faint"
                            title={`${s.positives} of ${scorecard.minSample} positive calls needed before a rate is shown`}
                          >
                            Not enough data yet — {s.positives}/{scorecard.minSample}
                          </span>
                        ) : (
                          <Pill tone={(s.falsePositiveRate ?? 0) > 0.05 ? "dropped" : "ready"} className="tabular font-mono normal-case">
                            {pct(s.falsePositiveRate)}
                          </Pill>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {scorecard.unattributedHardBounces > 0 ? (
            <p className="tabular border-t border-border-subtle px-3 py-2 font-mono text-[11px] text-text-faint">
              {scorecard.unattributedHardBounces} hard bounce{scorecard.unattributedHardBounces === 1 ? "" : "s"} could not be attributed to
              a provider (local-only verdict, or never verified).
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
