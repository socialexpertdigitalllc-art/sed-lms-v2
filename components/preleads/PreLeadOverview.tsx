"use client";

import { useMemo } from "react";
import type { PreLead } from "@/lib/preleads/types";
import {
  computePreLeadKpis,
  categoryDistribution,
  serviceSplit,
  followUpsDue,
  recentPreLeads,
} from "@/lib/preleads/analytics";
import { CategoryPill } from "@/components/preleads/CategoryPill";
import { formatDate, formatDateTime } from "@/lib/leads/format";

function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wide text-text-faint">{label}</div>
      <div className="text-2xl font-semibold font-mono text-text mt-1">{value}</div>
    </div>
  );
}

export function PreLeadOverview({
  preLeads,
  agentNameById,
}: {
  preLeads: PreLead[];
  agentNameById: Record<string, string>;
}) {
  const kpis = useMemo(() => computePreLeadKpis(preLeads), [preLeads]);
  const categories = useMemo(() => categoryDistribution(preLeads), [preLeads]);
  const services = useMemo(() => serviceSplit(preLeads), [preLeads]);
  const due = useMemo(() => followUpsDue(preLeads), [preLeads]);
  const recent = useMemo(() => recentPreLeads(preLeads), [preLeads]);

  const categoryMax = categories.reduce((m, c) => Math.max(m, c.value), 0) || 1;

  const serviceLabel = (rows: { name: string; value: number }[]) =>
    rows.length ? rows.map((r) => `${r.name} ${r.value}`).join(" / ") : "—";

  return (
    <div className="space-y-5">
      {/* 1) KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <KpiCard label="Total" value={kpis.total} />
        <KpiCard label="Strong" value={kpis.strong} />
        <KpiCard label="Active" value={kpis.active} />
        <KpiCard label="Conversion" value={`${kpis.conversionRate}%`} />
        <KpiCard label="Due 24h" value={kpis.dueNext24h} />
        <KpiCard label="Past due" value={kpis.pastDue} />
      </div>

      {/* 2) Category distribution + Service split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-surface border border-border rounded-lg p-5">
          <div className="text-sm font-semibold text-text mb-3">Category distribution</div>
          {categories.length ? (
            <div className="space-y-2.5">
              {categories.map((c) => (
                <div key={c.name} className="flex items-center gap-3">
                  <div className="w-28 shrink-0">
                    <CategoryPill category={c.name} />
                  </div>
                  <div className="flex-1 h-2 rounded-full bg-border-subtle overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full"
                      style={{ width: `${(c.value / categoryMax) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-sm font-mono text-text-muted">{c.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-text-faint">No pre-leads yet.</div>
          )}
        </div>

        <div className="bg-surface border border-border rounded-lg p-5">
          <div className="text-sm font-semibold text-text mb-3">Service split</div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] uppercase tracking-wide text-text-faint">Offered</span>
              <span className="text-sm font-mono text-text-muted">{serviceLabel(services.offered)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] uppercase tracking-wide text-text-faint">Type</span>
              <span className="text-sm font-mono text-text-muted">{serviceLabel(services.type)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3) Follow-ups due + Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-surface border border-border rounded-lg p-5">
          <div className="text-sm font-semibold text-text mb-3">Follow-ups due (next 24h)</div>
          {due.length ? (
            <ul className="divide-y divide-border-subtle">
              {due.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="text-sm text-text truncate">{l.business_name}</span>
                  <span className="text-xs font-mono text-text-muted whitespace-nowrap">
                    {formatDateTime(l.follow_up_time)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-text-faint">Nothing due in the next 24 hours.</div>
          )}
        </div>

        <div className="bg-surface border border-border rounded-lg p-5">
          <div className="text-sm font-semibold text-text mb-3">Recent activity</div>
          {recent.length ? (
            <ul className="divide-y divide-border-subtle">
              {recent.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-text truncate">{l.business_name}</span>
                    <CategoryPill category={l.lead_category} />
                  </div>
                  <span className="text-xs font-mono text-text-muted whitespace-nowrap">
                    {formatDate(l.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-text-faint">No recent activity.</div>
          )}
        </div>
      </div>
    </div>
  );
}
