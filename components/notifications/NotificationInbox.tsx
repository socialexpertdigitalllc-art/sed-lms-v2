"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import type { AppNotification, NotifyBell } from "@/lib/notifications/types";
import { formatDateTime } from "@/lib/leads/format";
import { inputCls } from "@/components/forms/Field";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { cn } from "@/lib/utils";
import { Select } from "@/components/common/Select";
import MultiSelect from "@/components/common/MultiSelect";
import { useToast } from "@/components/common/Toast";

function BellTag({ bell }: { bell: NotifyBell }) {
  return (
    <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-surface-2 text-text-faint">
      {bell === "website" ? "Website" : "General"}
    </span>
  );
}

/** Per-user follow-up reminder preferences (statuses that trigger the reminder). */
function ReminderSettingsCard() {
  const { toast } = useToast();
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [available, setAvailable] = useState<string[]>(["Ready", "Long Term"]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me/notification-settings");
        const j = await res.json().catch(() => ({}));
        if (res.ok) {
          setEnabled(j.enabled ?? true);
          setStatuses(j.statuses ?? []);
          if (Array.isArray(j.availableStatuses)) setAvailable(j.availableStatuses);
        }
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  async function save(next: { enabled?: boolean; statuses?: string[] }) {
    const body = { enabled: next.enabled ?? enabled, statuses: next.statuses ?? statuses };
    if (next.enabled !== undefined) setEnabled(next.enabled);
    if (next.statuses !== undefined) setStatuses(next.statuses);
    try {
      const res = await fetch("/api/me/notification-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) toast({ kind: "error", title: j.error ?? "Could not save reminder settings" });
      else if (j.warning) toast({ kind: "info", title: j.warning });
    } catch {
      toast({ kind: "error", title: "Network error — settings not saved" });
    }
  }

  if (!loaded) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text">Follow-up reminders</p>
        <p className="text-xs text-text-muted">
          Choose which lead statuses remind you before a follow-up is due. Nothing selected = all.
        </p>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <MultiSelect
          label="Statuses"
          options={available.map((s) => ({ value: s }))}
          selected={statuses}
          onChange={(next) => void save({ statuses: next })}
        />
        <label className="flex items-center gap-1.5 text-sm text-text-muted whitespace-nowrap">
          <input
            type="checkbox"
            className="accent-accent w-4 h-4"
            checked={enabled}
            onChange={(e) => void save({ enabled: e.target.checked })}
          />
          Enabled
        </label>
      </div>
    </div>
  );
}

export function NotificationInbox({ initial }: { initial: AppNotification[] }) {
  const router = useRouter();
  // Keeps the list current as new notifications land or existing ones are read
  // elsewhere (e.g. from a bell dropdown).
  useRealtimeRefresh("notifications");

  const [bellSel, setBellSel] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<"" | "unread">("");
  const [marking, setMarking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const unreadCount = useMemo(() => initial.filter((n) => n.read_at === null).length, [initial]);

  const filtered = useMemo(() => {
    return initial.filter((n) => {
      if (bellSel.length && !bellSel.includes(n.bell)) return false;
      if (statusFilter === "unread" && n.read_at !== null) return false;
      return true;
    });
  }, [initial, bellSel, statusFilter]);

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

  async function markRead(n: AppNotification) {
    try {
      await fetch(`/api/notifications/${n.id}/read`, { method: "POST" });
    } catch {
      /* best-effort */
    }
  }

  async function openNotification(n: AppNotification) {
    setBusyId(n.id);
    await markRead(n);
    setBusyId(null);
    const url = n.target_url ?? (n.lead_id ? `/leads/${n.lead_id}` : "#");
    if (url === "#") {
      router.refresh();
    } else {
      router.push(url);
    }
  }

  function openWebsite(n: AppNotification) {
    window.open(n.website_url as string, "_blank", "noopener");
    void markRead(n).then(() => router.refresh());
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
          <MultiSelect
            label="Bell"
            options={[
              { value: "website", label: "Website" },
              { value: "general", label: "General" },
            ]}
            selected={bellSel}
            onChange={setBellSel}
          />
          <Select
            className={inputCls + " w-auto"}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | "unread")}
          >
            <option value="">All</option>
            <option value="unread">Unread</option>
          </Select>
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

      <ReminderSettingsCard />

      {filtered.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg px-4 py-12 text-center text-text-faint">
          No notifications found.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((n) => {
            const unread = n.read_at === null;
            return (
              <div
                key={n.id}
                className="flex items-stretch rounded-lg border border-border bg-surface transition-colors hover:bg-surface-2"
              >
                <button
                  type="button"
                  onClick={() => openNotification(n)}
                  disabled={busyId === n.id}
                  className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left disabled:opacity-70"
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
                {n.website_url && (
                  <button
                    type="button"
                    title="Open the website in a new tab"
                    aria-label={`Open ${n.title}'s website in a new tab`}
                    onClick={() => openWebsite(n)}
                    className="grid w-11 shrink-0 place-items-center rounded-r-lg text-text-faint hover:text-accent-ink"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
