"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PreLead } from "@/lib/preleads/types";
import type { AppNotification } from "@/lib/notifications/types";
import { followUpsDue, pastDueFollowUps } from "@/lib/preleads/analytics";
import { formatDateTime } from "@/lib/leads/format";

export function NotificationBell() {
  type WgeNote = { id: string; status: string; generation_id: string | null; leads: { business_name: string } | null };
  const [hidden, setHidden] = useState(false);
  const [due, setDue] = useState<PreLead[]>([]);
  const [overdue, setOverdue] = useState<PreLead[]>([]);
  const [wge, setWge] = useState<WgeNote[]>([]);
  const [notes, setNotes] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/pre-leads");
        if (!res.ok) {
          if (active) setHidden(true);
          return;
        }
        const { preLeads } = (await res.json()) as { preLeads: PreLead[] };
        if (active) {
          setDue(followUpsDue(preLeads ?? []));
          setOverdue(pastDueFollowUps(preLeads ?? []));
        }
      } catch {
        if (active) setHidden(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/ai-tools/wge/queue?mine=1");
        if (res.ok && active) setWge(((await res.json()).items ?? []) as WgeNote[]);
      } catch {
        /* ignore — bell still works for pre-leads */
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/notifications?unread=1");
        if (res.ok && active) setNotes(((await res.json()).notifications ?? []) as AppNotification[]);
      } catch {
        /* ignore — bell still works for pre-leads/WGE */
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  // The pre-leads fetch failing (e.g. a user without pre_leads.view) hides the
  // bell — but still show it when there are WGE generation notifications.
  if (hidden && wge.length === 0 && notes.length === 0) return null;

  const count = notes.length + due.length + overdue.length + wge.length;

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
      await fetch("/api/notifications/all/read", { method: "POST" });
    } catch {
      /* optimistic — ignore network errors */
    }
  }

  const item = (l: PreLead) => (
    <li key={l.id}>
      <Link
        href="/pre-leads/all"
        onClick={() => setOpen(false)}
        className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-surface-2 transition-colors"
      >
        <span className="text-sm font-medium text-text truncate">{l.business_name}</span>
        <span className="text-[11px] text-text-faint whitespace-nowrap">{formatDateTime(l.follow_up_time)}</span>
      </Link>
    </li>
  );

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative text-text-muted hover:text-text transition-colors p-1.5 rounded-md hover:bg-surface-2"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span className={"absolute -top-0.5 -right-0.5 text-white text-[10px] rounded-full min-w-[16px] h-4 px-1 grid place-items-center leading-none " + (overdue.length > 0 ? "bg-dropped-fg" : "bg-accent")}>
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-surface border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold text-text">Notifications</span>
            {count > 0 && <span className="text-xs font-mono text-text-faint">{count}</span>}
          </div>

          {count === 0 ? (
            <div className="px-4 py-6 text-sm text-text-muted text-center">You&apos;re all caught up. 🎉</div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {notes.length > 0 && (
                <div>
                  <div className="px-3 pt-2.5 pb-1 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-accent-ink">Reminders ({notes.length})</span>
                    <button
                      type="button"
                      onClick={markAllRead}
                      className="text-[11px] font-medium text-text-faint hover:text-text transition-colors"
                    >
                      Mark all read
                    </button>
                  </div>
                  <ul className="pb-1">
                    {notes.slice(0, 8).map((n) => (
                      <li key={n.id}>
                        <Link
                          href={n.target_url ?? (n.lead_id ? `/leads/${n.lead_id}` : "#")}
                          onClick={() => {
                            void markRead(n.id);
                            setOpen(false);
                          }}
                          className="block px-3 py-2 hover:bg-surface-2 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-text truncate">{n.title}</span>
                            <span className="text-[11px] text-text-faint whitespace-nowrap">{formatDateTime(n.created_at)}</span>
                          </div>
                          <div className="text-xs text-text-muted truncate">{n.body}</div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {overdue.length > 0 && (
                <div className={notes.length > 0 ? "border-t border-border-subtle" : ""}>
                  <div className="px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-wide font-semibold text-dropped-fg flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-dropped-fg" /> Overdue ({overdue.length})
                  </div>
                  <ul className="pb-1">{overdue.slice(0, 6).map(item)}</ul>
                </div>
              )}
              {due.length > 0 && (
                <div className={overdue.length > 0 ? "border-t border-border-subtle" : ""}>
                  <div className="px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-wide font-semibold text-accent-ink flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" /> Due next 24h ({due.length})
                  </div>
                  <ul className="pb-1">{due.slice(0, 6).map(item)}</ul>
                </div>
              )}
              {wge.length > 0 && (
                <>
                  <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-text-faint font-semibold">Website generations</div>
                  <ul>
                    {wge.map((w) => (
                      <li key={w.id}>
                        <Link
                          href={w.status === "done" && w.generation_id ? `/ai-tools/generations/${w.generation_id}` : "/ai-tools/wge"}
                          onClick={() => setOpen(false)}
                          className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-surface-2 transition-colors"
                        >
                          <span className="text-sm font-medium text-text truncate">
                            {w.status === "done" ? "Website ready" : "Generation failed"} — {w.leads?.business_name ?? "lead"}
                          </span>
                          <span className={"text-[11px] whitespace-nowrap " + (w.status === "done" ? "text-ready-fg" : "text-dropped-fg")}>{w.status}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <Link
            href="/pre-leads"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-xs font-medium text-accent-ink border-t border-border hover:bg-surface-2 text-center"
          >
            View all follow-ups
          </Link>
        </div>
      )}
    </div>
  );
}
