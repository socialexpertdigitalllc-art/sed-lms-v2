"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FEEDBACK_STATUSES, type Feedback, type FeedbackStatus } from "@/lib/feedback/types";
import { formatDateTime } from "@/lib/leads/format";
import { inputCls } from "@/components/forms/Field";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { Select } from "@/components/common/Select";

const STATUS_CLS: Record<FeedbackStatus, string> = {
  Open: "bg-surface-2 text-text-muted",
  Resolved: "bg-ready-bg text-ready-fg",
};

function StatusChip({ status }: { status: FeedbackStatus }) {
  return (
    <span className={"rounded-md px-2 py-0.5 text-xs font-medium " + (STATUS_CLS[status] ?? "bg-surface-2 text-text-muted")}>
      {status}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className="rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-surface-2 text-text-faint">
      {type}
    </span>
  );
}

export function FeedbackList({
  title,
  items,
  manage,
}: {
  title: string;
  items: Feedback[];
  manage: boolean;
}) {
  const router = useRouter();
  // Unconditional (both the personal and manage views get live status updates)
  // — mirrors TicketQueue, which subscribes regardless of the viewer's role.
  useRealtimeRefresh("feedback");

  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | "">("");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!manage || !statusFilter) return items;
    return items.filter((f) => f.status === statusFilter);
  }, [items, manage, statusFilter]);

  const labelCls = "block text-[10px] uppercase tracking-wide text-text-faint mb-1";

  function startResolving(id: string) {
    setRowError(null);
    setNote("");
    setResolvingId(id);
  }

  function cancelResolving() {
    setResolvingId(null);
    setNote("");
  }

  async function resolve(id: string) {
    setBusyId(id);
    setRowError(null);
    const res = await fetch(`/api/feedback/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution_note: note.trim() || null }),
    });
    setBusyId(null);
    if (!res.ok) {
      setRowError((await res.json().catch(() => ({}))).error ?? "Could not resolve feedback");
      return;
    }
    setResolvingId(null);
    setNote("");
    router.refresh();
  }

  return (
    <section className="bg-surface border border-border rounded-lg p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="text-sm font-semibold text-text">{title}</div>
        {manage && (
          <Select
            className={inputCls + " w-auto"}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as FeedbackStatus | "")}
          >
            <option value="">All statuses</option>
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
      </div>

      {rowError && (
        <div className="mb-4 text-sm rounded-md px-3 py-2 bg-dropped-bg text-dropped-fg">{rowError}</div>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-text-muted">
          {manage ? "No feedback found." : "You haven't submitted any feedback yet."}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((f) => (
            <div key={f.id} className="rounded-lg border border-border px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <TypeBadge type={f.type} />
                <span className="text-sm font-medium text-text">{f.title}</span>
                <StatusChip status={f.status} />
                {manage && f.user_name && (
                  <span className="text-xs text-text-faint">by {f.user_name}</span>
                )}
                <span className="text-xs text-text-faint ml-auto whitespace-nowrap">
                  {formatDateTime(f.created_at)}
                </span>
              </div>

              {f.description && (
                <p className="text-sm text-text-muted mt-1.5 whitespace-pre-wrap">{f.description}</p>
              )}

              {manage && f.screenshot_url && (
                <a href={f.screenshot_url} target="_blank" rel="noreferrer" className="mt-2 inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.screenshot_url}
                    alt=""
                    className="h-16 w-16 object-cover rounded border border-border"
                  />
                </a>
              )}

              {f.status === "Resolved" && f.resolution_note && (
                <div className="mt-2">
                  <label className={labelCls}>Resolution note</label>
                  <p className="text-sm text-text bg-surface-2 rounded-lg px-3 py-2 whitespace-pre-wrap">
                    {f.resolution_note}
                  </p>
                </div>
              )}

              {manage && f.status === "Open" && (
                <div className="mt-2">
                  {resolvingId === f.id ? (
                    <div>
                      <textarea
                        className={inputCls}
                        rows={2}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Resolution note (optional)…"
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          onClick={cancelResolving}
                          className="px-3 py-1.5 text-sm rounded-md border border-border text-text-muted hover:bg-surface-2"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => resolve(f.id)}
                          disabled={busyId === f.id}
                          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60"
                        >
                          {busyId === f.id ? "Resolving…" : "Confirm resolve"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => startResolving(f.id)}
                      className="text-xs font-medium text-accent-ink px-2 py-1 rounded hover:bg-accent-soft"
                    >
                      Resolve
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
