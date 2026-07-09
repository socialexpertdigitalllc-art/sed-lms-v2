"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AppNotification, NotifyBell } from "@/lib/notifications/types";
import { formatDateTime } from "@/lib/leads/format";
import { inputCls } from "@/components/forms/Field";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { cn } from "@/lib/utils";

function BellTag({ bell }: { bell: NotifyBell }) {
  return (
    <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-surface-2 text-text-faint">
      {bell === "website" ? "Website" : "General"}
    </span>
  );
}

export function NotificationInbox({ initial }: { initial: AppNotification[] }) {
  const router = useRouter();
  // Keeps the list current as new notifications land or existing ones are read
  // elsewhere (e.g. from a bell dropdown).
  useRealtimeRefresh("notifications");

  const [bellFilter, setBellFilter] = useState<NotifyBell | "">("");
  const [statusFilter, setStatusFilter] = useState<"" | "unread">("");
  const [marking, setMarking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const unreadCount = useMemo(() => initial.filter((n) => n.read_at === null).length, [initial]);

  const filtered = useMemo(() => {
    return initial.filter((n) => {
      if (bellFilter && n.bell !== bellFilter) return false;
      if (statusFilter === "unread" && n.read_at !== null) return false;
      return true;
    });
  }, [initial, bellFilter, statusFilter]);

  async function markAllRead() {
    setMarking(true);
    try {
      // Unscoped — clears both bells, unlike the per-bell dropdowns.
      await fetch("/api/notifications/all/read", { method: "POST" });
    } catch {
      /* best-effort */
    } finally {
      setMarking(false);
      router.refresh();
    }
  }

  async function openNotification(n: AppNotification) {
    setBusyId(n.id);
    try {
      await fetch(`/api/notifications/${n.id}/read`, { method: "POST" });
    } catch {
      /* best-effort — still navigate */
    }
    setBusyId(null);
    const url = n.target_url ?? (n.lead_id ? `/leads/${n.lead_id}` : "#");
    if (url === "#") {
      router.refresh();
    } else {
      router.push(url);
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">Notifications</h1>
          <p className="text-sm text-text-muted mt-0.5">
            {unreadCount} unread &middot; {initial.length} total
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            className={inputCls + " w-auto"}
            value={bellFilter}
            onChange={(e) => setBellFilter(e.target.value as NotifyBell | "")}
          >
            <option value="">All bells</option>
            <option value="website">Website</option>
            <option value="general">General</option>
          </select>
          <select
            className={inputCls + " w-auto"}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | "unread")}
          >
            <option value="">All</option>
            <option value="unread">Unread</option>
          </select>
          <button
            type="button"
            onClick={markAllRead}
            disabled={marking || unreadCount === 0}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {marking ? "Marking…" : "Mark all read"}
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg px-4 py-12 text-center text-text-faint">
          No notifications found.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((n) => {
            const unread = n.read_at === null;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => openNotification(n)}
                disabled={busyId === n.id}
                className="w-full text-left flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3 hover:bg-surface-2 transition-colors disabled:opacity-70"
              >
                <span
                  className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", unread ? "bg-accent" : "bg-transparent")}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("text-sm truncate", unread ? "font-semibold text-text" : "font-medium text-text")}>
                      {n.title}
                    </span>
                    <BellTag bell={n.bell} />
                    <span className="text-[11px] text-text-faint ml-auto whitespace-nowrap">
                      {formatDateTime(n.created_at)}
                    </span>
                  </div>
                  {n.body && <p className="text-sm text-text-muted mt-0.5">{n.body}</p>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
