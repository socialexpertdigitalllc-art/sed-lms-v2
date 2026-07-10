"use client";

import { useMemo, useState } from "react";
import { formatDateTime } from "@/lib/leads/format";
import { summarize } from "@/lib/signin/analytics";
import type { AppSettings } from "@/lib/settings/appSettings";

type Audit = { id: string; user_id: string | null; action: string; entity_type: string | null; entity_id: string | null; old_value: unknown; new_value: unknown; created_at: string };
type Activity = { id: string; user_id: string | null; type: string; path: string | null; label: string | null; meta: Record<string, unknown> | null; created_at: string };
type Session = { user_id: string; signed_in_at: string; signed_out_at: string | null; last_seen_at: string; ip: string | null; user_agent: string | null };
type Tab = "audit" | "movement" | "signin";

export function LogsViewer({
  audit,
  activity,
  nameById,
  sessions,
  settings,
}: {
  audit: Audit[];
  activity: Activity[];
  nameById: Record<string, string>;
  sessions: Session[];
  settings: AppSettings;
}) {
  const [tab, setTab] = useState<Tab>("movement");
  const [q, setQ] = useState("");
  const [actor, setActor] = useState("");

  const actors = useMemo(() => {
    const s = new Set<string>();
    [...audit, ...activity].forEach((r) => r.user_id && s.add(r.user_id));
    sessions.forEach((r) => s.add(r.user_id));
    return [...s].map((id) => ({ id, name: nameById[id] ?? id })).sort((a, b) => a.name.localeCompare(b.name));
  }, [audit, activity, sessions, nameById]);

  const auditRows = useMemo(() => audit.filter((r) => (!actor || r.user_id === actor) && (!q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()))), [audit, actor, q]);
  const moveRows = useMemo(() => activity.filter((r) => (!actor || r.user_id === actor) && (!q || `${r.type} ${r.path} ${r.label}`.toLowerCase().includes(q.toLowerCase()))), [activity, actor, q]);

  const { perUserDay, online } = useMemo(
    () =>
      summarize(sessions, {
        tz: settings.work_timezone,
        workStart: settings.work_start_time,
        now: new Date(),
        idleMin: settings.idle_timeout_minutes,
      }),
    [sessions, settings]
  );
  const signinRows = useMemo(
    () =>
      perUserDay.filter(
        (r) =>
          (!actor || r.userId === actor) &&
          (!q || `${r.date} ${nameById[r.userId] ?? r.userId}`.toLowerCase().includes(q.toLowerCase()))
      ),
    [perUserDay, actor, q, nameById]
  );

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-text">Activity Log</h1>
        <p className="text-sm text-text-muted mt-0.5">Audited changes and raw user movement.</p>
      </div>

      <div className="flex gap-1 mb-4">
        {(["movement", "audit", "signin"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={"text-sm px-3 py-1.5 rounded-md font-medium " + (tab === t ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2")}>
            {t === "movement" ? "User Activity" : t === "audit" ? "Audit" : "Sign-In Logs"}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="flex-1 min-w-[220px] px-3 py-2 rounded-md border border-border bg-surface text-sm outline-none focus:ring-2 focus:ring-accent" />
        <select value={actor} onChange={(e) => setActor(e.target.value)} className="px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-muted outline-none focus:ring-2 focus:ring-accent">
          <option value="">All users</option>
          {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {tab === "signin" ? (
        <div>
          <div className="bg-surface border border-border rounded-lg p-4 mb-4">
            <div className="text-[10px] uppercase tracking-wide text-text-faint mb-2">Online now</div>
            {online.length === 0 ? (
              <p className="text-sm text-text-faint">No one is currently online.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {online.map((o) => (
                  <span key={o.userId} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-ready-bg text-ready-fg font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-ready-fg" />
                    {nameById[o.userId] ?? o.userId}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2">
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-text-faint">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">First in</th>
                    <th className="px-4 py-3">Last out</th>
                    <th className="px-4 py-3">Hours</th>
                    <th className="px-4 py-3">Sessions</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {signinRows.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-text-faint">No sign-in activity.</td></tr>
                  ) : (
                    signinRows.map((r) => (
                      <tr key={`${r.userId}|${r.date}`} className="border-b border-border-subtle last:border-0">
                        <td className="px-4 py-2 text-text-muted whitespace-nowrap">{r.date}</td>
                        <td className="px-4 py-2 text-text">{nameById[r.userId] ?? r.userId}</td>
                        <td className="px-4 py-2 text-text-muted font-mono text-xs">{r.firstIn}</td>
                        <td className="px-4 py-2 text-text-muted font-mono text-xs">{r.lastOut}</td>
                        <td className="px-4 py-2 text-text font-mono">{r.hours.toFixed(1)}</td>
                        <td className="px-4 py-2 text-text-muted font-mono">{r.sessions}</td>
                        <td className="px-4 py-2">
                          {r.lateMinutes > 0 ? (
                            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-notready-bg text-notready-fg">Late {r.lateMinutes}m</span>
                          ) : (
                            <span className="text-xs text-text-faint">On time</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2">
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-text-faint">
                  <th className="px-4 py-3">When</th><th className="px-4 py-3">User</th>
                  {tab === "movement" ? (<><th className="px-4 py-3">Type</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Path</th></>)
                    : (<><th className="px-4 py-3">Action</th><th className="px-4 py-3">Entity</th><th className="px-4 py-3">Details</th></>)}
                </tr>
              </thead>
              <tbody>
                {tab === "movement" ? (
                  moveRows.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-text-faint">No activity.</td></tr> :
                  moveRows.map((r) => (
                    <tr key={r.id} className="border-b border-border-subtle last:border-0">
                      <td className="px-4 py-2 text-text-muted whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                      <td className="px-4 py-2 text-text">{r.user_id ? (nameById[r.user_id] ?? "—") : "—"}</td>
                      <td className="px-4 py-2"><span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-2 text-text-muted">{r.type}</span></td>
                      <td className="px-4 py-2 text-text">{r.label ?? "—"}</td>
                      <td className="px-4 py-2 text-text-faint font-mono text-xs">{r.path ?? "—"}</td>
                    </tr>
                  ))
                ) : (
                  auditRows.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-text-faint">No audit entries.</td></tr> :
                  auditRows.map((r) => (
                    <tr key={r.id} className="border-b border-border-subtle last:border-0">
                      <td className="px-4 py-2 text-text-muted whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                      <td className="px-4 py-2 text-text">{r.user_id ? (nameById[r.user_id] ?? "—") : "—"}</td>
                      <td className="px-4 py-2 text-text font-mono text-xs">{r.action}</td>
                      <td className="px-4 py-2 text-text-faint text-xs">{r.entity_type ?? ""} {r.entity_id ? r.entity_id.slice(0, 8) : ""}</td>
                      <td className="px-4 py-2 text-text-faint font-mono text-[11px] max-w-[320px] truncate">{r.new_value ? JSON.stringify(r.new_value) : (r.old_value ? JSON.stringify(r.old_value) : "")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
