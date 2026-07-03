"use client";

import { useMemo, useState } from "react";
import { formatDateTime } from "@/lib/leads/format";

type Audit = { id: string; user_id: string | null; action: string; entity_type: string | null; entity_id: string | null; old_value: unknown; new_value: unknown; created_at: string };
type Activity = { id: string; user_id: string | null; type: string; path: string | null; label: string | null; meta: Record<string, unknown> | null; created_at: string };
type Tab = "audit" | "movement";

export function LogsViewer({ audit, activity, nameById }: { audit: Audit[]; activity: Activity[]; nameById: Record<string, string> }) {
  const [tab, setTab] = useState<Tab>("movement");
  const [q, setQ] = useState("");
  const [actor, setActor] = useState("");

  const actors = useMemo(() => {
    const s = new Set<string>();
    [...audit, ...activity].forEach((r) => r.user_id && s.add(r.user_id));
    return [...s].map((id) => ({ id, name: nameById[id] ?? id })).sort((a, b) => a.name.localeCompare(b.name));
  }, [audit, activity, nameById]);

  const auditRows = useMemo(() => audit.filter((r) => (!actor || r.user_id === actor) && (!q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()))), [audit, actor, q]);
  const moveRows = useMemo(() => activity.filter((r) => (!actor || r.user_id === actor) && (!q || `${r.type} ${r.path} ${r.label}`.toLowerCase().includes(q.toLowerCase()))), [activity, actor, q]);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-text">Activity Log</h1>
        <p className="text-sm text-text-muted mt-0.5">Audited changes and raw user movement.</p>
      </div>

      <div className="flex gap-1 mb-4">
        {(["movement", "audit"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={"text-sm px-3 py-1.5 rounded-md font-medium " + (tab === t ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2")}>
            {t === "movement" ? "User Activity" : "Audit"}
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
    </div>
  );
}
