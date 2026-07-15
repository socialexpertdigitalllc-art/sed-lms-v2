"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Loader2, Users, Building2, Share2, Check } from "lucide-react";

type Share = { id: string; target_type: "user" | "department"; target_id: string };
type Dept = { id: string; name: string; color: string | null };
type UserRow = { id: string; display_name: string };

/**
 * Manage who can see the caller's tags on leads. Targets are active departments
 * and other active users; each row toggles a `lead_tag_shares` row on/off.
 * Modal per Group 1: no backdrop-close — only the X / Done button closes it.
 */
export function TagSharingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [shares, setShares] = useState<Share[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [pending, setPending] = useState<string | null>(null); // `${type}:${id}` mid-toggle
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/tags/shares");
    if (!res.ok) {
      setError("Could not load sharing settings");
      setLoading(false);
      return;
    }
    const j = await res.json().catch(() => ({}));
    setShares(j.shares ?? []);
    setDepartments(j.departments ?? []);
    setUsers(j.users ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!open) return null;

  const sharedWith = (type: "user" | "department", id: string) =>
    shares.find((s) => s.target_type === type && s.target_id === id);

  async function toggle(type: "user" | "department", id: string) {
    if (pending) return;
    const key = `${type}:${id}`;
    setPending(key);
    setError(null);
    const existing = sharedWith(type, id);
    let ok = false;
    if (existing) {
      const res = await fetch(`/api/tags/shares?id=${existing.id}`, { method: "DELETE" });
      ok = res.ok;
      if (ok) setShares((prev) => prev.filter((s) => s.id !== existing.id));
    } else {
      const res = await fetch("/api/tags/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_type: type, target_id: id }),
      });
      ok = res.ok;
      if (ok) {
        const j = await res.json().catch(() => ({}));
        if (j.share) setShares((prev) => [...prev, j.share as Share]);
        else await load(); // already existed → refetch for a consistent view
      }
    }
    if (!ok) setError("Could not update sharing");
    setPending(null);
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 bg-black/30 grid place-items-center z-50 p-4">
      <div className="bg-surface border border-border rounded-lg w-full max-w-[420px] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-accent-ink" />
            <h2 className="font-semibold text-text">Manage tag sharing</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-text-faint hover:text-text">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          <p className="text-sm text-text-muted mb-4">
            Choose who can see your tags on leads. They can view and filter by your tags, but cannot edit them.
          </p>
          {error && <div className="mb-3 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex items-center justify-center gap-2 text-sm text-text-muted py-10">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="space-y-5">
              <section>
                <h3 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-faint font-semibold mb-2">
                  <Building2 className="w-3.5 h-3.5" /> Departments
                </h3>
                {departments.length === 0 ? (
                  <p className="text-xs text-text-faint">No active departments.</p>
                ) : (
                  <ul className="space-y-1">
                    {departments.map((d) => (
                      <li key={d.id}>
                        <ShareRow
                          label={d.name}
                          on={!!sharedWith("department", d.id)}
                          busy={pending === `department:${d.id}`}
                          onToggle={() => toggle("department", d.id)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-faint font-semibold mb-2">
                  <Users className="w-3.5 h-3.5" /> Users
                </h3>
                {users.length === 0 ? (
                  <p className="text-xs text-text-faint">No other users.</p>
                ) : (
                  <ul className="space-y-1">
                    {users.map((u) => (
                      <li key={u.id}>
                        <ShareRow
                          label={u.display_name}
                          on={!!sharedWith("user", u.id)}
                          busy={pending === `user:${u.id}`}
                          onToggle={() => toggle("user", u.id)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-border text-text-muted hover:bg-surface-2">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function ShareRow({
  label,
  on,
  busy,
  onToggle,
}: {
  label: string;
  on: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-pressed={on}
      className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-border hover:bg-surface-2 text-sm disabled:opacity-60"
    >
      <span className="text-text truncate">{label}</span>
      <span
        className={
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap " +
          (on
            ? "border-accent bg-accent-soft text-accent-ink"
            : "border-border text-text-faint")
        }
      >
        {busy ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : on ? (
          <Check className="w-3 h-3" />
        ) : null}
        {on ? "Shared" : "Share"}
      </span>
    </button>
  );
}
