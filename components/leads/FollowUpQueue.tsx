"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Lead } from "@/lib/leads/types";
import { formatDateTime, initials } from "@/lib/leads/format";
import { StatusPill } from "./StatusPill";
import { FuStatusChip } from "./FuStatusChip";
import { FollowUpModal } from "./FollowUpModal";
import { bucketOf, groupByBucket } from "@/lib/leads/followups";
import { usePermissions } from "@/hooks/usePermissions";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";

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

  const groups = useMemo(() => groupByBucket(leads, new Date()), [leads]);

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
    items: Lead[],
    opts?: { accent?: boolean }
  ) => {
    if (items.length === 0) return null;
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

      {isEmpty ? (
        <div className="bg-surface border border-border rounded-lg px-4 py-12 text-center text-text-faint">
          No leads to follow up.
        </div>
      ) : (
        <>
          {section("Overdue", groups.overdue, { accent: true })}
          {section("Due today", groups.today)}
          {section("Upcoming", groups.upcoming)}
          {section("No follow-up set", groups.none)}
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
