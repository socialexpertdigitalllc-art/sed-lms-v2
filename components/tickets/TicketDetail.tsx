"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { DownloadSiteFilesButton } from "@/components/common/DownloadSiteFilesButton";
import { UploadSiteFilesButton } from "@/components/common/UploadSiteFilesButton";
import type { Ticket, TicketItem } from "@/lib/tickets/types";
import { itemProgress, isOverdue } from "@/lib/tickets/logic";
import { formatDateTime } from "@/lib/leads/format";
import { inputCls } from "@/components/forms/Field";
import { TicketStatusChip, TicketPriorityBadge, OverdueBadge } from "./TicketStatusChip";
import { AgentRunPanel } from "./AgentRunPanel";

type LeadInfo = {
  id: string;
  business_name: string;
  agent_id: string | null;
  closed_by: string | null;
  status: string;
  website_link: string | null;
};

type TechMember = { id: string; display_name: string };

export type SiteUpdate = {
  by: string | null;
  at: string;
  site: string;
  files: number | null;
  zipName: string | null;
};

export function TicketDetail({
  ticket,
  items,
  lead,
  names,
  techMembers,
  canAssign,
  canResolve,
  isCreator,
  siteUpdates = [],
}: {
  ticket: Ticket;
  items: TicketItem[];
  lead: LeadInfo;
  names: Record<string, string | null>;
  techMembers: TechMember[];
  canAssign: boolean;
  canResolve: boolean;
  isCreator: boolean;
  /** Website uploads pinned to this ticket, newest first (upload proof). */
  siteUpdates?: SiteUpdate[];
}) {
  const router = useRouter();

  const [assignee, setAssignee] = useState(ticket.assigned_to ?? "");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
  const [itemBusy, setItemBusy] = useState<string | null>(null);
  const [confirmNoUpload, setConfirmNoUpload] = useState(false);

  const nameOf = (id: string | null | undefined) => (id ? names[id] ?? "—" : "—");
  const { done, total } = itemProgress(items);

  async function patchTicket(body: Record<string, unknown>, actionKey: string) {
    setBusyAction(actionKey);
    setError(null);
    const res = await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusyAction(null);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Action failed");
      return false;
    }
    router.refresh();
    return true;
  }

  async function toggleItem(item: TicketItem) {
    setItemBusy(item.id);
    setError(null);
    const res = await fetch(`/api/tickets/${ticket.id}/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_done: !item.is_done }),
    });
    setItemBusy(null);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Could not update item");
      return;
    }
    router.refresh();
  }

  async function assign() {
    if (!assignee) return;
    await patchTicket({ action: "assign", assigned_to: assignee }, "assign");
  }

  async function start() {
    await patchTicket({ action: "start" }, "start");
  }

  async function resolve() {
    if (!resolutionNote.trim()) {
      setError("A resolution note is required.");
      return;
    }
    const ok = await patchTicket(
      { action: "resolve", resolution_note: resolutionNote.trim() },
      "resolve"
    );
    if (ok) {
      setResolving(false);
      setResolutionNote("");
    }
  }

  /** The nudge: resolving a website ticket with no files uploaded during its
   *  life is usually a forgotten upload — ask once, never block. */
  function onConfirmResolveClick() {
    if (!resolutionNote.trim()) {
      setError("A resolution note is required.");
      return;
    }
    if (lead.website_link && siteUpdates.length === 0) {
      setConfirmNoUpload(true);
      return;
    }
    void resolve();
  }

  async function reopen() {
    await patchTicket({ action: "reopen" }, "reopen");
  }

  const signatureName =
    ticket.signature === "Agent"
      ? lead.agent_id
        ? names[lead.agent_id] ?? null
        : null
      : lead.closed_by
        ? names[lead.closed_by] ?? null
        : null;

  const canStart = canResolve && ticket.status === "Assigned";
  const canResolveNow = canResolve && ticket.status === "In Progress";
  const canReopen = (isCreator || canAssign) && ticket.status === "Resolved";
  const noActions = !canStart && !canResolveNow && !canReopen && !resolving;

  const btn =
    "rounded-lg border border-border bg-surface/70 px-3 py-2 text-sm text-text hover:bg-surface-2 disabled:opacity-60";
  const primaryBtn =
    "rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60";
  const labelCls = "block text-[10px] uppercase tracking-wide text-text-faint mb-1";

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="reveal relative mb-6 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="bg-grid absolute inset-0 opacity-60" />
        <div className="glow-teal absolute -right-16 -top-24 h-64 w-64" />
        <div className="relative p-6">
          <Link
            href={`/leads/${lead.id}`}
            className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text"
          >
            <ArrowLeft size={13} /> {lead.business_name}
          </Link>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent-ink">Ticket</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold leading-tight text-text">
              {ticket.title || items[0]?.body || ticket.category}
            </h1>
            <TicketStatusChip status={ticket.status} />
            <TicketPriorityBadge priority={ticket.priority} />
            {isOverdue(ticket.due_date, ticket.status, new Date()) && <OverdueBadge />}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
            {ticket.title && <span>{ticket.category}</span>}
            <span>
              Signed by {ticket.signature}
              {signatureName ? ` — ${signatureName}` : ""}
            </span>
            <span>Opened by {nameOf(ticket.created_by)}</span>
            <span>Assigned to {ticket.assigned_to ? nameOf(ticket.assigned_to) : "Unassigned"}</span>
            <span>{formatDateTime(ticket.created_at)}</span>
            {lead.website_link && (
              <span className="inline-flex items-center gap-1">
                <a
                  href={lead.website_link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-accent-ink hover:underline"
                >
                  {lead.website_link.replace(/^https?:\/\//, "")}
                  <ExternalLink className="h-3 w-3" />
                </a>
                {canResolve && (
                  <>
                    <DownloadSiteFilesButton
                      site={lead.website_link}
                      className="grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-surface-2 hover:text-accent-ink disabled:pointer-events-none disabled:opacity-45"
                      iconSize={14}
                    />
                    <UploadSiteFilesButton
                      site={lead.website_link}
                      ticketId={ticket.id}
                      className="grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-surface-2 hover:text-accent-ink disabled:pointer-events-none disabled:opacity-45"
                      iconSize={14}
                      onUploaded={() => router.refresh()}
                    />
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-dropped-bg px-4 py-2.5 text-sm text-dropped-fg">{error}</div>
      )}

      <div className="space-y-5">
        {/* Items */}
        <div className="rounded-2xl border border-border bg-surface shadow-sm p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text">Change items</h2>
            <span className="text-xs text-text-faint">
              {done} / {total} done
            </span>
          </div>
          <div className="mt-4 space-y-1">
            {items.length === 0 ? (
              <p className="text-sm text-text-muted">No items.</p>
            ) : (
              items.map((item) => (
                <div key={item.id}>
                  <label
                    className={
                      "flex items-start gap-2.5 rounded-lg px-2 py-2 text-sm " +
                      (canResolve ? "cursor-pointer hover:bg-surface-2" : "")
                    }
                  >
                    <input
                      type="checkbox"
                      className="accent-accent mt-0.5 w-4 h-4 shrink-0"
                      checked={item.is_done}
                      disabled={!canResolve || itemBusy === item.id}
                      onChange={() => toggleItem(item)}
                    />
                    <span className={item.is_done ? "text-text-faint line-through" : "text-text"}>
                      {item.body}
                    </span>
                  </label>
                  {item.attachments && item.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 pl-9 pb-2">
                      {item.attachments.map((att) => (
                        <a key={att.id} href={att.url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={att.url}
                            alt=""
                            className="h-16 w-16 object-cover rounded border border-border"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Website updates — proof that fixed files actually went live */}
        {siteUpdates.length > 0 && (
          <div className="rounded-2xl border border-border bg-surface shadow-sm p-5">
            <h2 className="text-sm font-semibold text-text">Website updates</h2>
            <ul className="mt-3 space-y-1.5">
              {siteUpdates.map((u, i) => (
                <li key={i} className="text-sm text-text-muted">
                  <span className="text-text">{u.files ?? "?"} file(s)</span> uploaded to{" "}
                  <span className="font-mono text-xs">{u.site}</span>
                  {u.zipName ? (
                    <>
                      {" "}from <span className="font-mono text-xs">{u.zipName}</span>
                    </>
                  ) : null}{" "}
                  by {u.by ? names[u.by] ?? "—" : "—"} — {formatDateTime(u.at)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* AI developer — ticket-driven site edits, reviewed before deploy */}
        <AgentRunPanel
          ticketId={ticket.id}
          websiteLink={lead.website_link}
          canResolve={canResolve}
          ticketStatus={ticket.status}
        />

        {/* Assignment */}
        {canAssign && (
          <div className="rounded-2xl border border-border bg-surface shadow-sm p-5">
            <h2 className="text-sm font-semibold text-text">Assignment</h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                className={inputCls + " w-auto flex-1 min-w-[180px]"}
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Select a developer…</option>
                {techMembers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.display_name}
                  </option>
                ))}
              </select>
              <button
                onClick={assign}
                disabled={!assignee || busyAction === "assign"}
                className={primaryBtn}
              >
                {busyAction === "assign" ? "Assigning…" : "Assign"}
              </button>
            </div>
          </div>
        )}

        {/* Status actions */}
        <div className="rounded-2xl border border-border bg-surface shadow-sm p-5">
          <h2 className="text-sm font-semibold text-text">Actions</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canStart && (
              <button onClick={start} disabled={busyAction === "start"} className={primaryBtn}>
                {busyAction === "start" ? "Starting…" : "Start work"}
              </button>
            )}
            {canResolveNow && !resolving && (
              <button onClick={() => setResolving(true)} className={primaryBtn}>
                Resolve
              </button>
            )}
            {canReopen && (
              <button onClick={reopen} disabled={busyAction === "reopen"} className={btn}>
                {busyAction === "reopen" ? "Reopening…" : "Reopen"}
              </button>
            )}
            {noActions && <p className="text-sm text-text-faint">No actions available.</p>}
          </div>

          {canResolveNow && resolving && (
            <div className="mt-4">
              <label className={labelCls}>Resolution note (required)</label>
              <textarea
                className={inputCls}
                rows={3}
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                placeholder="Describe what was done…"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  onClick={() => {
                    setResolving(false);
                    setResolutionNote("");
                  }}
                  className="px-3 py-1.5 text-sm rounded-md border border-border text-text-muted hover:bg-surface-2"
                >
                  Cancel
                </button>
                <button onClick={onConfirmResolveClick} disabled={busyAction === "resolve"} className={primaryBtn}>
                  {busyAction === "resolve" ? "Resolving…" : "Confirm resolve"}
                </button>
              </div>
            </div>
          )}

          {ticket.status === "Resolved" && ticket.resolution_note && (
            <div className="mt-4">
              <label className={labelCls}>Resolution note</label>
              <p className="text-sm text-text bg-surface-2 rounded-lg px-3 py-2 whitespace-pre-wrap">
                {ticket.resolution_note}
              </p>
              {ticket.resolved_at && (
                <p className="text-[11px] text-text-faint mt-1">
                  Resolved {formatDateTime(ticket.resolved_at)}
                  {ticket.resolved_by ? ` by ${nameOf(ticket.resolved_by)}` : ""}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {confirmNoUpload && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="No updated files were uploaded"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h3 className="text-sm font-semibold text-text">No updated files were uploaded</h3>
            <p className="mt-2 text-sm text-text-muted">
              This ticket has no website upload recorded. If the fix changed the website files, upload them with the{" "}
              <span className="font-semibold text-text">upload icon next to the website link</span> before resolving —
              otherwise the live site still runs the old files.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmNoUpload(false)}
                className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text"
              >
                Go back
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmNoUpload(false);
                  void resolve();
                }}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Resolve anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
