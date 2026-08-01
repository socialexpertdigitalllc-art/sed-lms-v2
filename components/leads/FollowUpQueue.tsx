"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { Lead } from "@/lib/leads/types";
import { SITE_TYPES } from "@/lib/leads/types";
import { formatDateTime, initials } from "@/lib/leads/format";
import { StatusPill } from "./StatusPill";
import { FuStatusChip } from "./FuStatusChip";
import { FollowUpModal } from "./FollowUpModal";
import { RegionFilter } from "./RegionFilter";
import MultiSelect from "@/components/common/MultiSelect";
import { bucketOf, groupByBucket, FOLLOWUP_STATUSES } from "@/lib/leads/followups";
import { buildRegionFacets, leadRegion } from "@/lib/geo/regions";
import { usePermissions } from "@/hooks/usePermissions";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useViewState } from "@/hooks/useViewState";
import { inputCls } from "@/components/forms/Field";
import { cn } from "@/lib/utils";

// Ready by default — the statuses agents actually work; the status filter can
// widen back to every follow-up-eligible status.
const FOLLOWUPS_DEFAULTS = { q: "", status: "Ready", agent: "", type: "", region: "", bucket: "all" };

const BUCKETS = [
  { id: "all", label: "All" },
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Due today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "none", label: "Not set" },
] as const;

export function FollowUpQueue({
  leads,
  agentNameById,
}: {
  leads: Lead[];
  agentNameById: Record<string, string>;
}) {
  const { has } = usePermissions();
  useRealtimeRefresh("leads");
  const canFollowUp = has("leads.followup");

  const [followUpLead, setFollowUpLead] = useState<Lead | null>(null);
  const [urlState, setUrlState] = useViewState(FOLLOWUPS_DEFAULTS);

  const statusSel = useMemo(() => (urlState.status ? urlState.status.split(",") : []), [urlState.status]);
  const agentSel = useMemo(() => (urlState.agent ? urlState.agent.split(",") : []), [urlState.agent]);
  const typeSel = useMemo(() => (urlState.type ? urlState.type.split(",") : []), [urlState.type]);
  const regionSel = useMemo(() => (urlState.region ? urlState.region.split(",") : []), [urlState.region]);
  const q = urlState.q.trim().toLowerCase();

  const eligible = useMemo(
    () => leads.filter((l) => (FOLLOWUP_STATUSES as readonly string[]).includes(l.status)),
    [leads],
  );

  const agentOptions = useMemo(() => {
    const ids = new Set(eligible.map((l) => l.agent_id).filter(Boolean) as string[]);
    return Array.from(ids)
      .map((id) => ({ value: id, label: agentNameById[id] ?? "—" }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [eligible, agentNameById]);

  const regionFacets = useMemo(() => buildRegionFacets(eligible), [eligible]);

  const filtered = useMemo(() => {
    return eligible.filter((l) => {
      if (statusSel.length && !statusSel.includes(l.status)) return false;
      if (agentSel.length && !agentSel.includes(l.agent_id ?? "")) return false;
      if (typeSel.length && !typeSel.includes(l.site_type ?? "")) return false;
      if (regionSel.length && !regionSel.includes(leadRegion(l) ?? "")) return false;
      if (q) {
        const agent = (l.agent_id && agentNameById[l.agent_id]) || "";
        const hay = `${l.business_name} ${agent} ${l.business_phone ?? ""} ${l.business_email ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [eligible, statusSel, agentSel, typeSel, regionSel, q, agentNameById]);

  const groups = useMemo(() => groupByBucket(filtered, new Date()), [filtered]);

  const bucket = urlState.bucket || "all";
  const filtersActive =
    q !== "" || urlState.status !== FOLLOWUPS_DEFAULTS.status || urlState.agent !== "" ||
    urlState.type !== "" || urlState.region !== "" || bucket !== "all";

  const isEmpty =
    groups.overdue.length === 0 &&
    groups.today.length === 0 &&
    groups.upcoming.length === 0 &&
    groups.none.length === 0;

  const row = (lead: Lead) => {
    const agent = (lead.agent_id && agentNameById[lead.agent_id]) || "Unassigned";
    const overdue = bucketOf(lead.follow_up_time) === "overdue";
    return (
      <div
        key={lead.id}
        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="font-medium text-text truncate">{lead.business_name}</span>
          <StatusPill status={lead.status} />
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-text-muted text-xs">
            <span className="w-5 h-5 rounded-full bg-accent-soft text-accent-ink grid place-items-center text-[9px] font-semibold">
              {initials(agent)}
            </span>
            {agent}
          </span>
        </div>

        <div className="flex items-center gap-2 whitespace-nowrap">
          <span
            className={
              "text-sm " + (overdue ? "text-dropped-fg font-medium" : "text-text-muted")
            }
          >
            {formatDateTime(lead.follow_up_time)}
          </span>
          {lead.last_followup_status && <FuStatusChip status={lead.last_followup_status} />}
          {lead.no_pickup_streak > 1 && (
            <span className="text-xs font-medium text-dropped-fg">×{lead.no_pickup_streak}</span>
          )}
        </div>

        <div className="flex items-center justify-end gap-1 whitespace-nowrap">
          {canFollowUp && (
            <button
              onClick={() => setFollowUpLead(lead)}
              className="bg-accent text-white text-xs font-semibold rounded-md px-3 py-1.5 hover:bg-accent-ink"
            >
              Follow Up
            </button>
          )}
          <Link
            href={`/leads/${lead.id}`}
            className="text-xs font-medium text-accent-ink px-2 py-1 rounded hover:bg-accent-soft"
            data-track="Open lead"
            data-lead-id={lead.id}
          >
            Detail
          </Link>
        </div>
      </div>
    );
  };

  const section = (
    label: string,
    id: (typeof BUCKETS)[number]["id"],
    items: Lead[],
    opts?: { accent?: boolean }
  ) => {
    if (items.length === 0) return null;
    if (bucket !== "all" && bucket !== id) return null;
    return (
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <h2
            className={
              "text-sm font-semibold " + (opts?.accent ? "text-dropped-fg" : "text-text")
            }
          >
            {label}
          </h2>
          <span className="text-xs font-mono text-text-faint">{items.length}</span>
        </div>
        <div className="flex flex-col gap-2">{items.map(row)}</div>
      </section>
    );
  };

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-text">Follow-ups</h1>
        <p className="text-sm text-text-muted mt-0.5">
          {groups.overdue.length} overdue · {groups.today.length} due today
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input
            className={cn(inputCls, "w-56 pl-8")}
            placeholder="Search business, agent…"
            aria-label="Search follow-ups"
            value={urlState.q}
            onChange={(e) => setUrlState({ q: e.target.value })}
          />
        </div>
        <MultiSelect
          label="Status"
          options={FOLLOWUP_STATUSES.map((s) => ({ value: s, count: eligible.filter((l) => l.status === s).length }))}
          selected={statusSel}
          onChange={(next) => setUrlState({ status: next.join(",") })}
        />
        <MultiSelect
          label="Agent"
          options={agentOptions}
          selected={agentSel}
          onChange={(next) => setUrlState({ agent: next.join(",") })}
        />
        <MultiSelect
          label="Type"
          options={SITE_TYPES.map((t) => ({ value: t }))}
          selected={typeSel}
          onChange={(next) => setUrlState({ type: next.join(",") })}
        />
        <RegionFilter facets={regionFacets} selected={regionSel} onChange={(next) => setUrlState({ region: next.join(",") })} />
        <div className="flex items-center gap-1">
          {BUCKETS.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setUrlState({ bucket: b.id })}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                bucket === b.id ? "bg-accent text-white" : "bg-surface-2 text-text-muted hover:text-text",
              )}
            >
              {b.label}
            </button>
          ))}
        </div>
        {filtersActive && (
          <button
            type="button"
            onClick={() => setUrlState({ ...FOLLOWUPS_DEFAULTS })}
            className="text-xs text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {isEmpty ? (
        <div className="bg-surface border border-border rounded-lg px-4 py-12 text-center text-text-faint">
          No leads to follow up{filtersActive ? " matching the filters" : ""}.
        </div>
      ) : (
        <>
          {section("Overdue", "overdue", groups.overdue, { accent: true })}
          {section("Due today", "today", groups.today)}
          {section("Upcoming", "upcoming", groups.upcoming)}
          {section("No follow-up set", "none", groups.none)}
        </>
      )}

      <FollowUpModal
        key={followUpLead?.id}
        leadId={followUpLead?.id ?? ""}
        businessName={followUpLead?.business_name ?? ""}
        open={!!followUpLead}
        onClose={() => setFollowUpLead(null)}
      />
    </div>
  );
}
