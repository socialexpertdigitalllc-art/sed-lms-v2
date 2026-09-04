"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "@/lib/tables/columnMeta";
import { Download, ArrowUp, ArrowDown, ExternalLink, Users, FilterX } from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type RowSelectionState,
  type VisibilityState,
} from "@tanstack/react-table";
import type { Lead, LeadTag } from "@/lib/leads/types";
import { SITE_TYPES } from "@/lib/leads/types";
import { visibleStatuses, settableStatuses } from "@/lib/leads/categories";
import { formatCurrency, formatDateTime, initials } from "@/lib/leads/format";
import { StatusPill } from "./StatusPill";
import { StatusChangeModal } from "./StatusChangeModal";
import { FollowUpModal } from "./FollowUpModal";
import { FuStatusHoverChip } from "./FuStatusHoverChip";
import { FollowUpQuickActions } from "./FollowUpQuickActions";
import { DownloadSiteFilesButton } from "@/components/common/DownloadSiteFilesButton";
import { UploadSiteFilesButton } from "@/components/common/UploadSiteFilesButton";
import { ShuffleSiteButton } from "@/components/common/ShuffleSiteButton";
import { BulkActionBar } from "./BulkActionBar";
import { bucketOf, isFollowUpEligible, FU_STATUSES } from "@/lib/leads/followups";
import { usePermissions } from "@/hooks/usePermissions";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { toCsv, LEAD_CSV_COLUMNS, leadCsvRow } from "@/lib/leads/csv";
import { leadCopyText } from "@/lib/leads/copyText";
import { RegionFilter } from "./RegionFilter";
import { TagFilter } from "./TagFilter";
import { tagColor } from "@/lib/leads/tagColors";
import { leadMatchesTags, ownTags } from "@/lib/leads/tagFilter";
import { buildRegionFacets, leadRegion } from "@/lib/geo/regions";
import { useViewState } from "@/hooks/useViewState";
import { buildQuery } from "@/lib/url/buildQuery";
import { MonthFilter } from "@/components/common/MonthFilter";
import { monthOptions, inMonth } from "@/lib/analytics/dateScope";
import { serialColumn } from "@/components/common/tableSerial";
import { ContractSentBadge } from "@/components/contracts/ContractSentBadge";
import { CopyButton } from "@/components/common/CopyButton";
import { RelativeTime } from "@/components/common/RelativeTime";
import { Select } from "@/components/common/Select";
import MultiSelect from "@/components/common/MultiSelect";
import { useUiPrefs } from "@/providers/UiPrefsProvider";
import { DensityToggle } from "@/components/common/DensityToggle";
import { ColumnsMenu } from "@/components/common/ColumnsMenu";
import { EmptyState } from "@/components/common/EmptyState";
import { SavedViews } from "@/components/common/SavedViews";
import { useTableKeyboardNav } from "@/hooks/useTableKeyboardNav";
import { usePageClamp } from "@/hooks/usePageClamp";
import { noAutoPageReset } from "@/lib/tables/pagination";

const LEADS_DEFAULTS = { q: "", status: "All", agent: "", type: "", fu: "", region: "", tags: "", month: "", scope: "", sort: "created_at:desc", page: "0", size: "15" };
const SORT_PRESETS = ["created_at:desc", "follow_up_time:asc", "rating:desc", "business_name:asc"];

export function LeadsTable({
  leads,
  agentNameById,
  salesAgents,
  tags,
  canViewTags,
  canManageTags,
  canShareTags,
  currentUserId,
  contractSentLeadIds = [],
  teamAgentIds = [],
}: {
  leads: Lead[];
  agentNameById: Record<string, string>;
  salesAgents: { id: string; name: string }[];
  tags: LeadTag[];
  canViewTags: boolean;
  canManageTags: boolean;
  canShareTags: boolean;
  currentUserId: string;
  contractSentLeadIds?: string[];
  /**
   * The sales agents reporting to this viewer (empty unless they are a
   * closer). Drives the "My team" scope — see the chip in the toolbar.
   */
  teamAgentIds?: string[];
}) {
  const { has, all } = usePermissions();
  const tagById = useMemo(() => Object.fromEntries(tags.map((t) => [t.id, t])), [tags]);
  // Only the caller's OWN tags are appliable via bulk (user-scoped tags).
  const ownTagList = useMemo(() => ownTags(tags, currentUserId), [tags, currentUserId]);
  const sentContractSet = useMemo(() => new Set(contractSentLeadIds), [contractSentLeadIds]);
  const { density, columns: columnPrefs, setTableColumns } = useUiPrefs();
  const visible = useMemo(() => visibleStatuses(all), [all]);
  useRealtimeRefresh("leads");
  const canCreate = has("leads.create");
  const canChangeStatus = has("leads.status_change");
  const canFollowUp = has("leads.followup");
  // Upload/shuffle beside a website link are the ticket-tech and board
  // operator tools (same gate as the lead screen); download is for anyone
  // who can see the row.
  const canSiteAgent = has("tickets.resolve") || has("studio.manage");
  const canExport = has("leads.export");
  const canAssign = has("leads.assign");
  const canDelete = has("leads.delete");
  // Taggers get the bulk bar too, so they can apply tags to many leads at once.
  const canBulk = canChangeStatus || canAssign || canDelete || canExport || canManageTags;

  function exportCsv() {
    const rows = table.getFilteredRowModel().rows.map((r) => leadCsvRow(r.original, agentNameById));
    const blob = new Blob([toCsv(rows, LEAD_CSV_COLUMNS)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    a.href = url;
    a.download = `leads_${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const [modalLead, setModalLead] = useState<Lead | null>(null);
  const [followUpLead, setFollowUpLead] = useState<Lead | null>(null);
  // Set by the Tick quick-action so the modal opens already on Pickup. Part of
  // the modal's key, so re-opening the SAME lead by the plain button resets it.
  const [followUpIntent, setFollowUpIntent] = useState<"" | "Pickup">("");

  function openFollowUp(lead: Lead, intent: "" | "Pickup" = "") {
    setFollowUpIntent(intent);
    setFollowUpLead(lead);
  }
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [urlState, setUrlState] = useViewState(LEADS_DEFAULTS);
  const { q, status, agent, type, sort, page, size } = urlState;
  const canScopeMonth = has("analytics.view_all_agents");
  const month = canScopeMonth ? urlState.month : "";
  const regionSel = useMemo(() => (urlState.region ? urlState.region.split(",") : []), [urlState.region]);
  const tagSel = useMemo(() => (urlState.tags ? urlState.tags.split(",") : []), [urlState.tags]);
  const agentSel = useMemo(() => (agent ? agent.split(",") : []), [agent]);
  const typeSel = useMemo(() => (type ? type.split(",") : []), [type]);
  // The follow-up status pill (Pickup / No Pickup) as a filter.
  const fuSel = useMemo(() => (urlState.fu ? urlState.fu.split(",") : []), [urlState.fu]);
  // A closer's table defaults to THEIR OWN leads; the team is opt-in behind
  // the "My team" chip, which then adds their agents' leads to their own.
  // Applied BEFORE every other filter and count, so the status tabs, the
  // agent list and the export all describe the set on screen.
  const isCloser = teamAgentIds.length > 0;
  const teamScope = isCloser && urlState.scope === "team";
  const teamIds = useMemo(
    () => new Set<string>([currentUserId, ...teamAgentIds]),
    [currentUserId, teamAgentIds],
  );
  // Any non-default filter — drives a visible "Clear filters" escape so a
  // persisted filter can never silently hide leads.
  const filtersActive =
    q !== "" || status !== "All" || agent !== "" || type !== "" || urlState.fu !== "" || urlState.region !== "" || urlState.tags !== "" || urlState.month !== "" || teamScope;
  const clearFilters = () =>
    setUrlState({ q: "", status: "All", agent: "", type: "", fu: "", region: "", tags: "", month: "", scope: "", page: "0" });
  const sorting = useMemo<SortingState>(() => {
    const [id, dir] = sort.split(":");
    return id ? [{ id, desc: dir !== "asc" }] : [];
  }, [sort]);
  const pagination = useMemo(() => ({ pageIndex: Math.max(0, Number(page) || 0), pageSize: Math.max(1, Number(size) || 15) }), [page, size]);
  const columnVisibility = useMemo<VisibilityState>(() => ({ ...(columnPrefs.leads ?? {}), region: false, tags: false, fu_status: false }), [columnPrefs]);
  const columnFilters = useMemo<ColumnFiltersState>(() => {
    const f: ColumnFiltersState = [];
    if (status !== "All") f.push({ id: "status", value: status });
    if (agentSel.length) f.push({ id: "agent", value: agentSel });
    if (typeSel.length) f.push({ id: "site_type", value: typeSel });
    if (fuSel.length) f.push({ id: "fu_status", value: fuSel });
    if (regionSel.length) f.push({ id: "region", value: regionSel });
    if (tagSel.length) f.push({ id: "tags", value: tagSel });
    return f;
  }, [status, agentSel, typeSel, fuSel, regionSel, tagSel]);

  const scopedLeads = useMemo(
    () =>
      leads.filter((l) => {
        if (!inMonth(l.created_at, month)) return false;
        if (!isCloser) return true;
        return teamScope ? Boolean(l.agent_id && teamIds.has(l.agent_id)) : l.agent_id === currentUserId;
      }),
    [leads, month, isCloser, teamScope, teamIds, currentUserId],
  );

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { All: scopedLeads.length };
    for (const s of visible) c[s] = 0;
    for (const l of scopedLeads) if (l.status in c) c[l.status]++;
    return c;
  }, [scopedLeads, visible]);

  const agentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of scopedLeads) set.add((l.agent_id && agentNameById[l.agent_id]) || "Unassigned");
    return [...set].sort();
  }, [scopedLeads, agentNameById]);

  const regionFacets = useMemo(() => buildRegionFacets(scopedLeads), [scopedLeads]);
  const fuCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of scopedLeads) {
      const k = l.last_followup_status;
      if (k) c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [scopedLeads]);

  const columns = useMemo<ColumnDef<Lead>[]>(
    () => [
      { ...serialColumn<Lead>(), enableHiding: false },
      ...(canBulk
        ? [{
            id: "select",
            header: ({ table }) => (
              <input type="checkbox" className="accent-accent"
                checked={table.getIsAllPageRowsSelected()}
                ref={(el) => { if (el) el.indeterminate = table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected(); }}
                onChange={table.getToggleAllPageRowsSelectedHandler()} />
            ),
            cell: ({ row }) => (
              <input type="checkbox" className="accent-accent"
                checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()}
                onClick={(e) => e.stopPropagation()} />
            ),
            enableSorting: false,
            enableHiding: false,
          } as ColumnDef<Lead>]
        : []),
      {
        accessorKey: "created_at",
        header: "Date",
        meta: { responsiveClass: "hidden md:table-cell" },
        cell: (c) => <RelativeTime iso={c.getValue<string>()} className="text-text-muted whitespace-nowrap" />,
      },
      {
        accessorKey: "status",
        header: "Status",
        filterFn: "equalsString",
        cell: (c) => {
          const link = c.row.original.website_link;
          return (
            <span className="inline-flex items-center gap-1.5">
              <StatusPill status={c.getValue<string>()} />
              {link && link.trim() && (
                <span className="inline-flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                  <a href={link} target="_blank" rel="noopener noreferrer"
                    title="Open website" aria-label="Open website"
                    className="inline-flex items-center text-accent-ink hover:text-accent">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <DownloadSiteFilesButton site={link} className="inline-flex h-5 w-5 items-center justify-center rounded text-text-faint hover:bg-surface-2 hover:text-accent-ink disabled:pointer-events-none disabled:opacity-45" iconSize={12} />
                  {canSiteAgent && (
                    <>
                      <UploadSiteFilesButton site={link} className="inline-flex h-5 w-5 items-center justify-center rounded text-text-faint hover:bg-surface-2 hover:text-accent-ink disabled:pointer-events-none disabled:opacity-45" iconSize={12} onUploaded={() => router.refresh()} />
                      <ShuffleSiteButton site={link} className="inline-flex h-5 w-5 items-center justify-center rounded text-text-faint hover:bg-surface-2 hover:text-accent-ink disabled:pointer-events-none disabled:opacity-45" iconSize={12} onShuffled={() => router.refresh()} />
                    </>
                  )}
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: "agent",
        accessorFn: (row) => (row.agent_id && agentNameById[row.agent_id]) || "Unassigned",
        header: "Agent",
        filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue<string>(id)),
        cell: (c) => (
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <span className="w-5 h-5 rounded-full bg-accent-soft text-accent-ink grid place-items-center text-[9px] font-semibold">
              {initials(c.getValue<string>())}
            </span>
            <span className="text-text">{c.getValue<string>()}</span>
          </span>
        ),
      },
      {
        accessorKey: "site_type",
        header: "Type",
        filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue<string>(id)),
        meta: { responsiveClass: "hidden lg:table-cell" },
        cell: (c) => <span className="text-text-muted">{c.getValue<string>() ?? "—"}</span>,
      },
      {
        // Filter carrier only — the pill itself renders in the Follow-up
        // column. Kept as its own column so the filter does not couple to
        // that column's accessor (follow_up_time) or its visibility.
        id: "fu_status",
        accessorFn: (row) => row.last_followup_status ?? "",
        filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue<string>(id)),
        enableSorting: false,
        enableHiding: false,
      },
      {
        id: "region",
        accessorFn: (row) => leadRegion(row),
        filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue<string>(id)),
        enableSorting: false,
      },
      {
        id: "tags",
        accessorFn: (row) => row.tag_ids ?? [],
        filterFn: (row, id, value: string[]) => leadMatchesTags(row.getValue<string[]>(id), value),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: "business_name",
        header: "Business",
        cell: (c) => {
          const tagIds = c.row.original.tag_ids ?? [];
          return (
            <div className="min-w-0">
              <div className="font-medium text-text truncate flex items-center gap-1">
                <Link
                  href={`/leads/${c.row.original.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="hover:underline truncate"
                >
                  {c.row.original.business_name}
                </Link>
                <CopyButton value={leadCopyText(c.row.original)} title="Copy all business details" className="shrink-0" />
              </div>
              <div className="text-xs text-text-faint truncate">{c.row.original.business_email ?? ""}</div>
              {sentContractSet.has(c.row.original.id) && (
                <div className="mt-1"><ContractSentBadge /></div>
              )}
              {canViewTags && tagIds.length > 0 && (
                <div className="mt-1 hidden sm:flex flex-wrap gap-1">
                  {tagIds.map((tid) => {
                    const t = tagById[tid];
                    if (!t) return null;
                    const col = tagColor(t.color);
                    return (
                      <span
                        key={tid}
                        style={{ background: col.chipBg, color: col.chipFg, borderColor: col.hex + "55" }}
                        className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none"
                      >
                        {t.name}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "business_phone",
        header: "Phone",
        meta: { responsiveClass: "hidden lg:table-cell" },
        cell: (c) => {
          const phone = c.getValue<string>();
          return phone ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <span className="text-text-muted font-mono text-xs">{phone}</span>
              <CopyButton value={phone} title="Copy phone" />
            </span>
          ) : (
            <span className="text-text-muted">—</span>
          );
        },
      },
      {
        accessorKey: "price_quoted",
        header: "Price",
        cell: (c) => <span className="text-text font-mono whitespace-nowrap">{formatCurrency(c.getValue<number | null>())}</span>,
      },
      {
        accessorKey: "follow_up_time",
        header: "Follow-up",
        meta: { responsiveClass: "hidden xl:table-cell" },
        cell: (c) => {
          const value = c.getValue<string | null>();
          const overdue = bucketOf(value) === "overdue";
          const lead = c.row.original;
          const streak = lead.no_pickup_streak;
          const lastStatus = lead.last_followup_status;
          const quickable = canFollowUp && isFollowUpEligible(lead.status);
          return (
            <div className="flex flex-col gap-0.5">
              <span
                className={
                  "whitespace-nowrap " + (overdue ? "text-dropped-fg font-medium" : "text-text-muted")
                }
              >
                {formatDateTime(value)}
              </span>
              {(lastStatus || streak > 1 || quickable) && (
                <span className="inline-flex items-center gap-1">
                  {lastStatus && (
                    <FuStatusHoverChip
                      leadId={lead.id}
                      status={lastStatus}
                      version={lead.updated_at}
                    />
                  )}
                  {streak > 1 && (
                    <span className="text-xs font-medium text-dropped-fg">×{streak}</span>
                  )}
                  {/* This column is the narrowest on the table. The quick
                      actions stay out of the resting layout entirely and
                      arrive on row hover, the same way the Detail/Status
                      buttons in the actions column already do. */}
                  {quickable && (
                    <FollowUpQuickActions
                      leadId={lead.id}
                      businessName={lead.business_name}
                      onPickup={() => openFollowUp(lead, "Pickup")}
                      className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                    />
                  )}
                </span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "rating",
        header: "Rating",
        meta: { responsiveClass: "hidden 2xl:table-cell" },
        cell: (c) => {
          const r = c.getValue<number | null>();
          return <span className="text-text-muted font-mono">{r ? `${r}/10` : "—"}</span>;
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: (c) => (
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-end gap-1 whitespace-nowrap opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
          >
            <Link
              href={`/leads/${c.row.original.id}`}
              className="text-xs font-medium text-accent-ink px-2 py-1 rounded hover:bg-accent-soft"
              data-track="Open lead"
              data-lead-id={c.row.original.id}
            >
              Detail
            </Link>
            {canChangeStatus && (
              <button
                onClick={() => setModalLead(c.row.original)}
                className="text-xs font-medium text-text-muted px-2 py-1 rounded border border-border hover:bg-surface-2"
              >
                Status
              </button>
            )}
            {canFollowUp && isFollowUpEligible(c.row.original.status) && (
              <button
                onClick={() => openFollowUp(c.row.original)}
                className="text-xs font-medium text-text-muted px-2 py-1 rounded border border-border hover:bg-surface-2"
              >
                Follow Up
              </button>
            )}
          </div>
        ),
      },
    ],
    [agentNameById, canChangeStatus, canFollowUp, canSiteAgent, canBulk, canViewTags, tagById, sentContractSet, router]
  );

  const table = useReactTable({
    data: scopedLeads,
    columns,
    enableRowSelection: canBulk,
    getRowId: (l) => l.id,
    state: { globalFilter: q, sorting, columnFilters, pagination, rowSelection, columnVisibility },
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === "function" ? updater(columnVisibility) : updater;
      setTableColumns("leads", next);
    },
    onGlobalFilterChange: (updater) => {
      const next = typeof updater === "function" ? (updater as (o: string) => string)(q) : (updater as string);
      setUrlState({ q: next ?? "", page: "0" });
    },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? (updater as (o: SortingState) => SortingState)(sorting) : updater;
      const t = next[0];
      setUrlState({ sort: t ? `${t.id}:${t.desc ? "desc" : "asc"}` : "", page: "0" });
    },
    onColumnFiltersChange: () => {},
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? (updater as (o: typeof pagination) => typeof pagination)(pagination) : updater;
      setUrlState({ page: String(next.pageIndex) });
    },
    globalFilterFn: (row, _col, value) => {
      const s = String(value).toLowerCase();
      const l = row.original;
      const agentName = (l.agent_id && agentNameById[l.agent_id]) || "";
      return [l.business_name, l.business_email, agentName, l.status, l.business_phone]
        .some((v) => (v ?? "").toString().toLowerCase().includes(s));
    },
    // Data refreshes (router.refresh / realtime) must never yank the page back
    // to 1 — see lib/tables/pagination.ts. Filter handlers reset it explicitly.
    ...noAutoPageReset,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
  usePageClamp(pagination.pageIndex, table.getPageCount(), (p) => setUrlState({ page: p }));

  const rows = table.getRowModel().rows;
  const { highlightedIndex } = useTableKeyboardNav({
    count: rows.length,
    searchInputRef,
    enabled: !modalLead && !followUpLead,
    onOpen: (i) => {
      const id = rows[i]?.original.id;
      if (id) router.push(`/leads/${id}`);
    },
    // Esc clears an active search; it must not touch the page otherwise.
    onEscape: () => {
      if (q) setUrlState({ q: "", page: "0" });
    },
  });
  const filteredCount = table.getFilteredRowModel().rows.length;
  const selectedRows = table.getSelectedRowModel().rows;
  const selectedLeads = selectedRows.map((r) => r.original);
  const selectedIds = selectedLeads.map((l) => l.id);

  return (
    <div>
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-text">Leads</h1>
          <p className="text-sm text-text-muted mt-0.5">{filteredCount} of {scopedLeads.length} shown</p>
        </div>
        {canCreate && (
          <Link href="/leads/new" className="bg-accent text-white rounded-md px-4 py-2 text-sm font-semibold hover:bg-accent-ink transition-colors">
            + New Lead
          </Link>
        )}
      </div>

      {/* status tabs */}
      <div className="flex flex-wrap gap-1 mb-3">
        {["All", ...visible].map((tab) => (
          <button
            key={tab}
            onClick={() => setUrlState({ status: tab, page: "0" })}
            className={
              "text-sm rounded-md px-3 py-1.5 font-medium transition-colors " +
              (status === tab ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2")
            }
          >
            {tab}
            <span className="ml-1.5 text-xs font-mono text-text-faint">{statusCounts[tab] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          ref={searchInputRef}
          value={q}
          onChange={(e) => setUrlState({ q: e.target.value, page: "0" })}
          placeholder="Search business, email, agent…"
          className="flex-1 min-w-[220px] px-3 py-2 rounded-md border border-border bg-surface text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        {isCloser && (
          <button
            type="button"
            onClick={() => setUrlState({ scope: teamScope ? "" : "team", page: "0" })}
            aria-pressed={teamScope}
            title="Also show the leads of the sales agents on your team (your own are always shown)"
            className={
              "rounded-md px-3 py-2 text-sm font-medium transition-colors " +
              (teamScope ? "bg-accent text-white" : "bg-surface-2 text-text-muted hover:text-text")
            }
          >
            My team
          </button>
        )}
        <MultiSelect
          label="Agent"
          options={agentOptions.map((a) => ({ value: a }))}
          selected={agentSel}
          onChange={(next) => setUrlState({ agent: next.join(","), page: "0" })}
        />
        <MultiSelect
          label="Type"
          options={SITE_TYPES.map((t) => ({ value: t }))}
          selected={typeSel}
          onChange={(next) => setUrlState({ type: next.join(","), page: "0" })}
        />
        <MultiSelect
          label="Follow-up"
          options={FU_STATUSES.map((s) => ({ value: s, count: fuCounts[s] ?? 0 }))}
          selected={fuSel}
          onChange={(next) => setUrlState({ fu: next.join(","), page: "0" })}
        />
        <RegionFilter facets={regionFacets} selected={regionSel} onChange={(next) => setUrlState({ region: next.join(","), page: "0" })} />
        {canViewTags && (
          <TagFilter
            tags={tags}
            selected={tagSel}
            canManage={canManageTags}
            canShare={canShareTags}
            userId={currentUserId}
            onChange={(next) => setUrlState({ tags: next.join(","), page: "0" })}
          />
        )}
        {canScopeMonth && <MonthFilter options={monthOptions(leads)} value={month} onChange={(v) => setUrlState({ month: v, page: "0" })} />}
        <Select
          value={sort}
          onChange={(e) => setUrlState({ sort: e.target.value, page: "0" })}
          className="px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-muted outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="created_at:desc">Submitted date</option>
          <option value="follow_up_time:asc">Follow-up time</option>
          <option value="rating:desc">Rating</option>
          <option value="business_name:asc">Alphabetical</option>
          {!SORT_PRESETS.includes(sort) && <option value={sort}>Custom</option>}
        </Select>
        {canExport && (
          <button onClick={exportCsv} className="px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-muted hover:bg-surface-2 whitespace-nowrap inline-flex items-center gap-1.5">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        )}
        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-dropped-fg/40 text-sm text-dropped-fg hover:bg-dropped-bg whitespace-nowrap"
          >
            <FilterX className="w-4 h-4" /> Clear filters
          </button>
        )}
        <DensityToggle />
        <ColumnsMenu table={table} />
        <SavedViews
          path="/leads"
          getQuery={() => buildQuery("", LEADS_DEFAULTS, urlState)}
          onApply={(params) => setUrlState({ ...LEADS_DEFAULTS, ...params })}
        />
      </div>

      {/* table */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 sticky top-0 z-10">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-border">
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      onClick={h.column.getCanSort() ? h.column.getToggleSortingHandler() : undefined}
                      className={
                        "text-left text-[10px] uppercase tracking-wide text-text-faint font-semibold px-4 py-3 whitespace-nowrap " +
                        (h.column.getCanSort() ? "cursor-pointer select-none hover:text-text-muted" : "") +
                        " " + (h.column.columnDef.meta?.responsiveClass ?? "")
                      }
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getIsSorted() === "asc" ? <ArrowUp className="inline w-3 h-3 ml-0.5" /> : h.column.getIsSorted() === "desc" ? <ArrowDown className="inline w-3 h-3 ml-0.5" /> : null}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={columns.length}><EmptyState icon={Users} title="No leads found" hint="Try adjusting filters or search." /></td></tr>
              ) : (
                rows.map((row, i) => (
                  <tr
                    key={row.id}
                    className={
                      "border-b border-border-subtle last:border-0 hover:bg-surface-2 group" +
                      (i === highlightedIndex ? " ring-2 ring-inset ring-accent bg-accent-soft/40" : "")
                    }
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={"px-4 align-middle max-w-[260px] " + (density === "compact" ? "py-1.5 " : "py-2.5 ") + (cell.column.columnDef.meta?.responsiveClass ?? "")}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-sm text-text-muted">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-xs text-text-muted">
            Rows per page
            <Select
              value={size}
              onChange={(e) => setUrlState({ size: e.target.value, page: "0" })}
              className="px-2 py-1 rounded-md border border-border bg-surface text-sm text-text-muted"
            >
              <option value="15">15</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </Select>
          </label>
          <span className="hidden sm:inline text-[11px] text-text-faint">Press / to search · j/k to move · Enter to open</span>
        </div>
        {table.getPageCount() > 1 && (
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                className="px-3 py-1.5 rounded-md border border-border hover:bg-surface-2 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                className="px-3 py-1.5 rounded-md border border-border hover:bg-surface-2 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {modalLead && (
        <StatusChangeModal
          leadId={modalLead.id}
          current={modalLead.status}
          businessName={modalLead.business_name}
          websiteLink={modalLead.website_link}
          open={true}
          onClose={() => setModalLead(null)}
        />
      )}

      <FollowUpModal
        key={`${followUpLead?.id}:${followUpIntent}`}
        leadId={followUpLead?.id ?? ""}
        businessName={followUpLead?.business_name ?? ""}
        open={!!followUpLead}
        onClose={() => setFollowUpLead(null)}
        initialStatus={followUpIntent}
      />

      {canBulk && selectedIds.length > 0 && (
        <BulkActionBar
          selectedIds={selectedIds}
          selectedLeads={selectedLeads}
          statuses={settableStatuses(all)}
          agentNameById={agentNameById}
          salesAgents={salesAgents}
          tags={ownTagList}
          can={{ status: canChangeStatus, assign: canAssign, archive: canDelete, export: canExport, tag: canManageTags }}
          onClear={() => setRowSelection({})}
        />
      )}
    </div>
  );
}
