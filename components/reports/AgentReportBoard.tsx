"use client";

import { useMemo, useState } from "react";
import type { AgentPeriodicReport } from "@/lib/reports/agentPeriodic";
import type { WindowMetrics } from "@/lib/reports/agentPeriodicMath";
import { formatCompactCurrency } from "@/lib/leads/format";
import { fmtInt, fmtPct, fmtDays, fmtHours, fmtRatio, type Fmt } from "@/lib/reports/format";

const fmtMoney: Fmt = (v) => (v === null ? "—" : formatCompactCurrency(v));

interface RowDef { label: string; get: (m: WindowMetrics) => number | null; fmt: Fmt }

const SECTIONS: { title: string; rows: RowDef[] }[] = [
  {
    title: "Pipeline flow",
    rows: [
      { label: "Leads arrived", get: (m) => m.arrived, fmt: fmtInt },
      { label: "Closed (won)", get: (m) => m.closedCount, fmt: fmtInt },
      { label: "— of which fresh (arrived this period)", get: (m) => m.closedFresh, fmt: fmtInt },
      { label: "— of which carry-over", get: (m) => m.closedCarryOver, fmt: fmtInt },
      { label: "Dropped (lost)", get: (m) => m.droppedCount, fmt: fmtInt },
      { label: "Open at period end", get: (m) => m.openAtEnd, fmt: fmtInt },
      { label: "— open 0–7 days", get: (m) => m.openAging.d0_7, fmt: fmtInt },
      { label: "— open 8–30 days", get: (m) => m.openAging.d8_30, fmt: fmtInt },
      { label: "— open 30+ days", get: (m) => m.openAging.d30p, fmt: fmtInt },
    ],
  },
  {
    title: "Velocity",
    rows: [
      { label: "Median time to close", get: (m) => m.medianCloseDays, fmt: fmtDays },
      { label: "Avg time to close", get: (m) => m.avgCloseDays, fmt: fmtDays },
      { label: "Median time to drop", get: (m) => m.medianDropDays, fmt: fmtDays },
      { label: "Fast drops (≤7d — quick disqualification)", get: (m) => m.fastDrops, fmt: fmtInt },
      { label: "Slow drops (>7d — worked, then lost)", get: (m) => m.slowDrops, fmt: fmtInt },
      { label: "Median first touch", get: (m) => m.medianFirstTouchHours, fmt: fmtHours },
    ],
  },
  {
    title: "Ratios",
    rows: [
      { label: "Close ratio (of decided)", get: (m) => m.closeRatio, fmt: fmtPct },
      { label: "Drop ratio (of decided)", get: (m) => m.dropRatio, fmt: fmtPct },
      { label: "Pickup rate", get: (m) => m.pickupRate, fmt: fmtPct },
      { label: "Follow-ups logged", get: (m) => m.followUpsLogged, fmt: fmtInt },
      { label: "Contracts sent", get: (m) => m.contractsSent, fmt: fmtInt },
      { label: "Closes per contract sent", get: (m) => m.closesPerContract, fmt: fmtRatio },
    ],
  },
  {
    title: "Revenue (by close date, quoted/contracted)",
    rows: [
      { label: "Closed revenue", get: (m) => m.closedRevenue, fmt: fmtMoney },
      { label: "Recurring (yearly)", get: (m) => m.recurringRevenue, fmt: fmtMoney },
      { label: "Avg deal size", get: (m) => m.avgDealSize, fmt: fmtMoney },
    ],
  },
];

const BUCKETS: { key: keyof WindowMetrics["closeBuckets"]; label: string }[] = [
  { key: "le1", label: "≤1d" }, { key: "le3", label: "≤3d" }, { key: "le7", label: "≤7d" },
  { key: "le14", label: "≤14d" }, { key: "le30", label: "≤30d" }, { key: "gt30", label: ">30d" },
];

function monthRange(offset: number): { from: string; to: string; label: string } {
  const d = new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - offset, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const s = (x: Date) => x.toISOString().slice(0, 10);
  return {
    from: s(start),
    to: s(end),
    label: start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

export function AgentReportBoard({
  salesUsers,
}: {
  salesUsers: { id: string; display_name: string; is_active: boolean }[];
}) {
  const presets = useMemo(() => [monthRange(0), monthRange(1), monthRange(2)], []);
  const [agentId, setAgentId] = useState("");
  const [from, setFrom] = useState(presets[0].from);
  const [to, setTo] = useState(presets[0].to);
  const [includeAttendance, setIncludeAttendance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [report, setReport] = useState<AgentPeriodicReport | null>(null);
  const [generated, setGenerated] = useState<{ agentId: string; from: string; to: string; attendance: boolean } | null>(null);

  async function generate() {
    if (!agentId) { setApiError("Pick an agent first."); return; }
    if (!from || !to || from > to) {
      setApiError("Pick a valid date range — 'From' must be on or before 'To'.");
      return;
    }
    setBusy(true);
    setApiError(null);
    setReport(null);
    setGenerated(null);
    const res = await fetch("/api/reports/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, from, to, includeAttendance }),
    });
    setBusy(false);
    if (!res.ok) {
      setApiError((await res.json().catch(() => ({}))).error ?? "Failed to generate report");
      return;
    }
    setReport((await res.json()).report);
    setGenerated({ agentId, from, to, attendance: includeAttendance });
  }

  const pdfHref = generated
    ? `/api/reports/agent/pdf?agentId=${generated.agentId}&from=${generated.from}&to=${generated.to}${generated.attendance ? "&attendance=1" : ""}`
    : null;
  const m = report?.metrics;

  return (
    <div className="space-y-5">
      <div className="bg-surface border border-border rounded-lg p-5 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-[10px] uppercase tracking-wide text-text-faint mb-1">Agent</span>
          <select
            className="bg-surface-2 border border-border rounded-md px-2 py-1.5 text-sm"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            <option value="">Select agent…</option>
            {salesUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}{u.is_active ? "" : " (deactivated)"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-[10px] uppercase tracking-wide text-text-faint mb-1">From</span>
          <input type="date" className="bg-surface-2 border border-border rounded-md px-2 py-1.5 text-sm"
            value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block text-[10px] uppercase tracking-wide text-text-faint mb-1">To</span>
          <input type="date" className="bg-surface-2 border border-border rounded-md px-2 py-1.5 text-sm"
            value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="flex gap-1.5">
          {presets.map((p) => (
            <button key={p.from} type="button"
              className={"text-xs border rounded-md px-2 py-1.5 " +
                (from === p.from && to === p.to ? "border-accent text-accent" : "border-border text-text-muted")}
              onClick={() => { setFrom(p.from); setTo(p.to); }}>
              {p.label}
            </button>
          ))}
        </div>
        <label className="text-xs text-text-muted flex items-center gap-1.5 pb-1.5">
          <input type="checkbox" checked={includeAttendance}
            onChange={(e) => setIncludeAttendance(e.target.checked)} />
          Include attendance
        </label>
        <button type="button" disabled={busy}
          className="bg-accent text-white rounded-md px-4 py-1.5 text-sm disabled:opacity-50"
          onClick={generate}>
          {busy ? "Generating…" : "Generate"}
        </button>
        {report && generated && pdfHref && (
          <a className="text-sm text-accent underline pb-1.5" href={pdfHref}>Download PDF</a>
        )}
      </div>

      {apiError && (
        <div className="border border-border rounded-lg p-4 text-sm bg-dropped-bg text-dropped-fg">{apiError}</div>
      )}

      {report && m && (
        <>
          <div className="text-sm text-text-muted">
            {report.agent.name}{report.agent.active ? "" : " (deactivated)"} · {report.period.from} → {report.period.to}
            {m.agent.approxCount > 0 && (
              <span className="ml-2 text-notready-fg">
                {m.agent.approxCount} exit timing(s) approximated from legacy data
              </span>
            )}
          </div>

          {SECTIONS.map((s) => (
            <div key={s.title} className="bg-surface border border-border rounded-lg p-5">
              <h2 className="text-sm font-semibold text-text mb-3">{s.title}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-text-faint text-left">
                      <th className="pb-2 font-normal">Metric</th>
                      <th className="pb-2 font-normal text-right">Agent</th>
                      <th className="pb-2 font-normal text-right">Team</th>
                      <th className="pb-2 font-normal text-right">Prev period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.rows.map((r) => (
                      <tr key={r.label} className="border-t border-border">
                        <td className="py-1.5 text-text-muted">{r.label}</td>
                        <td className="py-1.5 text-right font-mono text-text">{r.fmt(r.get(m.agent))}</td>
                        <td className="py-1.5 text-right font-mono text-text-muted">{r.fmt(r.get(m.team))}</td>
                        <td className="py-1.5 text-right font-mono text-text-muted">{r.fmt(r.get(m.prev))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <div className="bg-surface border border-border rounded-lg p-5">
            <h2 className="text-sm font-semibold text-text mb-3">Close-time distribution</h2>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              {BUCKETS.map((b) => (
                <div key={b.key} className="bg-surface-2 border border-border rounded-md px-3 py-2">
                  <div className="text-lg font-semibold font-mono">{m.agent.closeBuckets[b.key]}</div>
                  <div className="text-[10px] uppercase tracking-wide text-text-faint">{b.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface border border-border rounded-lg p-5">
            <h2 className="text-sm font-semibold text-text mb-3">Regions (agent, this period)</h2>
            {report.regions.agent.length === 0 ? (
              <p className="text-sm text-text-faint">No closes or drops in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-text-faint text-left">
                      <th className="pb-2 font-normal">Region</th>
                      <th className="pb-2 font-normal text-right">Closed</th>
                      <th className="pb-2 font-normal text-right">Dropped</th>
                      <th className="pb-2 font-normal text-right">Median close</th>
                      <th className="pb-2 font-normal text-right">Team median close</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.regions.agent.map((r) => {
                      const t = report.regions.team.find((x) => x.region === r.region);
                      return (
                        <tr key={r.region} className="border-t border-border">
                          <td className="py-1.5 text-text-muted">{r.region}</td>
                          <td className="py-1.5 text-right font-mono">{r.closed}</td>
                          <td className="py-1.5 text-right font-mono">{r.dropped}</td>
                          <td className="py-1.5 text-right font-mono">{fmtDays(r.medianCloseDays)}</td>
                          <td className="py-1.5 text-right font-mono text-text-muted">{fmtDays(t?.medianCloseDays ?? null)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-surface border border-border rounded-lg p-5">
            <h2 className="text-sm font-semibold text-text mb-3">Activity</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: "Sites generated", value: report.generation.total },
                { label: "AI tools", value: report.generation.ai },
                { label: "Template engine", value: report.generation.template },
                { label: "Site studio", value: report.generation.studio },
                { label: "Site builder", value: report.generation.builder },
              ].map((t) => (
                <div key={t.label} className="bg-surface-2 border border-border rounded-md px-3 py-2">
                  <div className="text-lg font-semibold font-mono">{t.value}</div>
                  <div className="text-[10px] uppercase tracking-wide text-text-faint">{t.label}</div>
                </div>
              ))}
            </div>
            {report.attendance && (
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div className="bg-surface-2 border border-border rounded-md px-3 py-2">
                  <div className="text-lg font-semibold font-mono">{report.attendance.days}</div>
                  <div className="text-[10px] uppercase tracking-wide text-text-faint">Days signed in</div>
                </div>
                <div className="bg-surface-2 border border-border rounded-md px-3 py-2">
                  <div className="text-lg font-semibold font-mono">{report.attendance.totalHours.toFixed(1)}h</div>
                  <div className="text-[10px] uppercase tracking-wide text-text-faint">Hours online</div>
                </div>
                <div className="bg-surface-2 border border-border rounded-md px-3 py-2">
                  <div className="text-lg font-semibold font-mono">{Math.round(report.attendance.avgLateMinutes)}m</div>
                  <div className="text-[10px] uppercase tracking-wide text-text-faint">Avg late</div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
