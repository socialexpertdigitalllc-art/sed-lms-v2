"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, Inbox } from "lucide-react";
import type { AppNotification, NotifyBell } from "@/lib/notifications/types";
import { formatDateTime } from "@/lib/leads/format";
import { createClient } from "@/lib/supabase/client";

/** Shared notification-table-backed bell. Wrapped by WebsiteBell/GeneralBell with a fixed `bell`. */
export function BellBase({
  bell,
  icon: Icon,
  label,
}: {
  bell: NotifyBell;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  const [notes, setNotes] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/notifications?bell=${bell}&unread=1`);
        if (res.ok && active) setNotes(((await res.json()).notifications ?? []) as AppNotification[]);
      } catch {
        /* fail-soft — bell just shows nothing */
      }
    })();
    return () => {
      active = false;
    };
  }, [bell, refreshTick]);

  // Live badge updates. Not useRealtimeRefresh: that hook calls router.refresh()
  // (a server-tree refetch), which wouldn't re-run this component's own
  // client-side fetch effect above since it has no server-supplied props. So we
  // subscribe directly and bump refreshTick to re-run that effect instead.
  useEffect(() => {
    const supabase = createClient();
    let t: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const channel = supabase.channel(`rt-bell-${bell}`);

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
          if (t) clearTimeout(t);
          t = setTimeout(() => setRefreshTick((n) => n + 1), 400);
        })
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, [bell]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const count = notes.length;

  async function markRead(id: string) {
    setNotes((ns) => ns.filter((n) => n.id !== id));
    try {
      await fetch("/api/notifications/" + id + "/read", { method: "POST" });
    } catch {
      /* optimistic — ignore network errors */
    }
  }

  async function markAllRead() {
    setNotes([]);
    try {
      // Scoped to this bell via ?bell= so clearing one bell's unread state
      // leaves the other bell untouched. Refetch here to stay in sync with
      // the server in case anything landed mid-flight.
      await fetch(`/api/notifications/all/read?bell=${bell}`, { method: "POST" });
      const res = await fetch(`/api/notifications?bell=${bell}&unread=1`);
      if (res.ok) setNotes(((await res.json()).notifications ?? []) as AppNotification[]);
    } catch {
      /* optimistic — ignore network errors */
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        className="relative text-text-muted hover:text-text transition-colors p-1.5 rounded-md hover:bg-surface-2"
      >
        <Icon className="w-[18px] h-[18px]" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 text-white text-[10px] rounded-full min-w-[16px] h-4 px-1 grid place-items-center leading-none bg-accent">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-surface border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold text-text">{label}</span>
            <div className="flex items-center gap-2">
              {count > 0 && <span className="text-xs font-mono text-text-faint">{count}</span>}
              {count > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-[11px] font-medium text-text-faint hover:text-text transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {count === 0 ? (
            <div className="px-4 py-6 text-sm text-text-muted text-center flex flex-col items-center gap-2">
              <Inbox className="w-6 h-6 text-text-faint" />
              <span>You&apos;re all caught up.</span>
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto">
              {/* Every unread notification — the badge and this list always agree. */}
              <ul className="pb-1">
                {notes.map((n) => (
                  <li key={n.id} className="flex items-stretch hover:bg-surface-2 transition-colors">
                    <Link
                      href={n.target_url ?? (n.lead_id ? `/leads/${n.lead_id}` : "#")}
                      onClick={() => {
                        void markRead(n.id);
                        setOpen(false);
                      }}
                      className="block min-w-0 flex-1 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-text truncate">{n.title}</span>
                        <span className="text-[11px] text-text-faint whitespace-nowrap">{formatDateTime(n.created_at)}</span>
                      </div>
                      <div className="text-xs text-text-muted truncate">{n.body}</div>
                    </Link>
                    {n.website_url && (
                      <button
                        type="button"
                        title="Open the website in a new tab"
                        aria-label={`Open ${n.title}'s website in a new tab`}
                        onClick={() => {
                          window.open(n.website_url as string, "_blank", "noopener");
                          void markRead(n.id);
                        }}
                        className="grid w-9 shrink-0 place-items-center text-text-faint hover:text-accent-ink"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-border px-4 py-2 text-center text-xs font-medium text-accent-ink hover:bg-surface-2"
          >
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
