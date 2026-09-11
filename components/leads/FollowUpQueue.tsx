"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { Lead } from "@/lib/leads/types";
import { SITE_TYPES } from "@/lib/leads/types";
import { formatDateTime, initials } from "@/lib/leads/format";
import { StatusPill } from "./StatusPill";
import { FuStatusHoverChip } from "./FuStatusHoverChip";
import { FollowUpQuickActions } from "./FollowUpQuickActions";
import { FollowUpModal } from "./FollowUpModal";
import { RegionFilter } from "./RegionFilter";
import MultiSelect from "@/components/common/MultiSelect";
import { CopyButton } from "@/components/common/CopyButton";
import { bucketOf, groupByBucket, isSpecificActive } from "@/lib/leads/followups";
import { buildRegionFacets, leadRegion } from "@/lib/geo/regions";
import { settableStatuses } from "@/lib/leads/categories";
import { usePermissions } from "@/hooks/usePermissions";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useViewState } from "@/hooks/useViewState";
import { useToast } from "@/components/common/Toast";
import { inputCls } from "@/components/forms/Field";
import { cn } from "@/lib/utils";

/** Whole days a follow-up is past due; 0 when not overdue/unset. */
function daysOverdue(followUpTime: string | null, now = Date.now()): number {
  if (!followUpTime) return 0;
  const t = new Date(followUpTime).getTime();
  if (Number.isNaN(t) || t >= now) return 0;
  return Math.floor((now - t) / 86_400_000);
}

// Past this, a follow-up is stale enough that parking or dropping the lead is
// usually the honest move — surface those as one-click actions on the row.
const STALE_DAYS = 30;

// Ready ONLY — this queue is the calling list, and only Ready leads belong on
// it (operator decision, 2026-09-11). Parked/other statuses are reached from
// the main Leads table; moving a lead to Long Term or Dropped removes it here.
const FOLLOWUPS_DEFAULTS = { q: "", agent: "", type: "", region: "", bucket: "all", specific: "", scope: "" };

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
  currentUserId = "",
  teamAgentIds = [],
}: {
  leads: Lead[];
  agentNameById: Record<string, string>;
  currentUserId?: string;
  /** Sales agents reporting to the viewer; empty unless they are a closer. */
  teamAgentIds?: string[];
}) {
  const { has, all } = usePermissions();
  const { toast } = useToast();
  useRealtimeRefresh("leads");
  const canFollowUp = has("leads.followup");
  const settable = settableStatuses(all);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const [followUpLead, setFollowUpLead] = useState<Lead | null>(null);
  // Set by the Tick quick-action so the modal opens already on Pickup. Part of
  // the modal's key, so re-opening the SAME lead by the plain button resets it.
  const [followUpIntent, setFollowUpIntent] = useState<"" | "Pickup">("");
  const [urlState, setUrlState] = useViewState(FOLLOWUPS_DEFAULTS);

  function openFollowUp(lead: Lead, intent: "" | "Pickup" = "") {
    setFollowUpIntent(intent);
    setFollowUpLead(lead);
  }

  async function quickStatus(lead: Lead, status: "Long Term" | "Dropped") {
    setStatusBusyId(lead.id);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) toast({ kind: "error", title: body.error ?? `Could not move to ${status}` });
      else toast({ kind: "success", title: `${lead.business_name} moved to ${status}` });
    } catch {
      toast({ kind: "error", title: "Network error — try again" });
    } finally {
      setStatusBusyId(null);
    }
  }

  const agentSel = useMemo(() => (urlState.agent ? urlState.agent.split(",") : []), [urlState.agent]);
  const typeSel = useMemo(() => (urlState.type ? urlState.type.split(",") : []), [urlState.type]);
  const regionSel = useMemo(() => (urlState.region ? urlState.region.split(",") : []), [urlState.region]);
  const q = urlState.q.trim().toLowerCase();

  const eligible = useMemo(() => leads.filter((l) => l.status === "Ready"), [leads]);

  const agentOptions = useMemo(() => {
    const ids = new Set(eligible.map((l) => l.agent_id).filter(Boolean) as string[]);
    return Array.from(ids)
      .map((id) => ({ value: id, label: agentNameById[id] ?? "—" }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [eligible, agentNameById]);

  const regionFacets = useMemo(() => buildRegionFacets(eligible), [eligible]);

  const specificOnly = urlState.specific === "1";
  // A closer working their team's follow-ups: themselves plus their agents.
  const isCloser = teamAgentIds.length > 0;
  const teamScope = isCloser && urlState.scope === "team";
  const teamIds = useMemo(
    () => new Set<string>([currentUserId, ...teamAgentIds].filter(Boolean)),
    [currentUserId, teamAgentIds],
  );
  // A specific-time claim ages out after 24h with no new follow-up, so both the
  // count and the filter ask isSpecificActive rather than reading the raw flag.
  const specificCount = useMemo(() => eligible.filter((l) => isSpecificActive(l)).length, [eligible]);
  const filtered = useMemo(() => {
    return eligible.filter((l) => {
      if (agentSel.length && !agentSel.includes(l.agent_id ?? "")) return false;
      if (typeSel.length && !typeSel.includes(l.site_type ?? "")) return false;
      if (regionSel.length && !regionSel.includes(leadRegion(l) ?? "")) return false;
      // "Specific" = the client asked for this exact time. Agents work those
      // first, so the page has to be able to show only them.
      if (specificOnly && !isSpecificActive(l)) return false;
      // Same rule as the leads table: a closer sees their OWN follow-ups
      // until they ask for the team.
      if (isCloser) {
        if (teamScope ? !(l.agent_id && teamIds.has(l.agent_id)) : l.agent_id !== currentUserId) return false;
      }
      if (q) {
        const agent = (l.agent_id && agentNameById[l.agent_id]) || "";
        const hay = `${l.business_name} ${agent} ${l.business_phone ?? ""} ${l.business_email ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [eligible, agentSel, typeSel, regionSel, specificOnly, isCloser, teamScope, teamIds, currentUserId, q, agentNameById]);

  const groups = useMemo(() => groupByBucket(filtered, new Date()), [filtered]);

  const bucket = urlState.bucket || "all";
  const filtersActive =
    q !== "" || urlState.agent !== "" ||
    urlState.type !== "" || urlState.region !== "" || bucket !== "all" || specificOnly || teamScope;

  const isEmpty =
    groups.overdue.length === 0 &&
    groups.today.length === 0 &&
    groups.upcoming.length === 0 &&
    groups.none.length === 0;

  const row = (lead: Lead) => {
    const agent = (lead.agent_id && agentNameById[lead.agent_id]) || "Unassigned";
    const overdue = bucketOf(lead.follow_up_time) === "overdue";
    const lateDays = daysOverdue(lead.follow_up_time);
    const stale = lateDays >= STALE_DAYS;
    return (
      <div
        key={lead.id}
        className="group flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-text truncate">{lead.business_name}</span>
          <StatusPill status={lead.status} />
          {/* The number being called — this page IS the calling queue, and
              bouncing to the lead detail for it was the whole friction. */}
          {lead.business_phone && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <a
                href={`tel:${lead.business_phone}`}
                className="font-mono text-xs text-text-muted hover:text-accent-ink hover:underline"
              >
                {lead.business_phone}
              </a>
              <CopyButton value={lead.business_phone} title="Copy phone" />
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-text-muted text-xs">
            <span className="w-5 h-5 rounded-full bg-accent-soft text-accent-ink grid place-items-center text-[9px] font-semibold">
              {initials(agent)}
            </span>
            {agent}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 whitespace-nowrap">
          <span
            className={
              "text-sm " + (overdue ? "text-dropped-fg font-medium" : "text-text-muted")
            }
          >
            {formatDateTime(lead.follow_up_time)}
          </span>
          {isSpecificActive(lead) && (
            <span
              className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink"
              title="The client asked for this exact time — expires 24h after it was logged"
            >
              Specific
            </span>
          )}
          {lateDays >= 1 && (
            <span
              className={
                "rounded-full px-1.5 py-0.5 text-[10px] font-semibold " +
                (stale ? "bg-dropped-bg text-dropped-fg" : "bg-surface-2 text-text-muted")
              }
              title={`Follow-up overdue by ${lateDays} day${lateDays === 1 ? "" : "s"}`}
            >
              {lateDays}d overdue
            </span>
          )}
          {lead.last_followup_status && (
            <FuStatusHoverChip
              leadId={lead.id}
              status={lead.last_followup_status}
              version={lead.updated_at}
            />
          )}
          {lead.no_pickup_streak > 1 && (
            <span className="text-xs font-medium text-dropped-fg">×{lead.no_pickup_streak}</span>
          )}
          {canFollowUp && (
            <FollowUpQuickActions
              leadId={lead.id}
              businessName={lead.business_name}
              onPickup={() => openFollowUp(lead, "Pickup")}
              className="ml-1 border-l border-border-subtle pl-2"
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-1 whitespace-nowrap">
          {stale && lead.status !== "Long Term" && settable.includes("Long Term") && (
            <button
              onClick={() => void quickStatus(lead, "Long Term")}
              disabled={statusBusyId !== null}
              title="Park this stale lead in Long Term"
              className="text-xs font-medium text-longterm-fg px-2 py-1 rounded border border-border hover:bg-surface-2 disabled:opacity-50"
            >
              {statusBusyId === lead.id ? "…" : "Long Term"}
            </button>
          )}
          {stale && settable.includes("Dropped") && (
            <button
              onClick={() => void quickStatus(lead, "Dropped")}
              disabled={statusBusyId !== null}
              title="Drop this stale lead"
              className="text-xs font-medium text-dropped-fg px-2 py-1 rounded border border-border hover:bg-dropped-bg disabled:opacity-50"
            >
              {statusBusyId === lead.id ? "…" : "Drop"}
            </button>
          )}
          {canFollowUp && (
            <button
              onClick={() => openFollowUp(lead)}
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
        {isCloser && (
          <button
            type="button"
            onClick={() => setUrlState({ scope: teamScope ? "" : "team" })}
            aria-pressed={teamScope}
            title="Also show the follow-ups of the sales agents on your team"
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              teamScope ? "bg-accent text-white" : "bg-surface-2 text-text-muted hover:text-text",
            )}
          >
            My team
          </button>
        )}
        <button
          type="button"
          onClick={() => setUrlState({ specific: specificOnly ? "" : "1" })}
          aria-pressed={specificOnly}
          title="Only follow-ups at a time the client specifically asked for"
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
            specificOnly ? "bg-accent text-white" : "bg-surface-2 text-text-muted hover:text-text",
          )}
        >
          Specific{specificCount > 0 ? ` (${specificCount})` : ""}
        </button>
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
        key={`${followUpLead?.id}:${followUpIntent}`}
        leadId={followUpLead?.id ?? ""}
        businessName={followUpLead?.business_name ?? ""}
        open={!!followUpLead}
        onClose={() => setFollowUpLead(null)}
        initialStatus={followUpIntent}
      />
    </div>
  );
}
