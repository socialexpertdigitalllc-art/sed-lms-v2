"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AddOn } from "@/lib/leads/types";

type Addon = AddOn & { is_active: boolean; sort: number };

const inputCls =
  "w-full px-3 py-2 rounded-md border border-border bg-surface text-sm text-text outline-none focus:ring-2 focus:ring-accent";

export function AddonsManager({ initial }: { initial: Addon[] }) {
  const router = useRouter();
  const [addons, setAddons] = useState<Addon[]>(initial);
  const [label, setLabel] = useState("");
  const [price, setPrice] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addAddon() {
    const trimmed = label.trim();
    if (!trimmed) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/add-ons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: trimmed,
          price: price.trim() === "" ? null : Number(price),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Failed to add add-on");
        return;
      }
      setAddons((prev) => [...prev, json.addon]);
      setLabel("");
      setPrice("");
      router.refresh();
    } finally {
      setAdding(false);
    }
  }

  async function toggleActive(a: Addon) {
    const nextActive = !a.is_active;
    setBusyId(a.id);
    setError(null);
    setAddons((prev) =>
      prev.map((x) => (x.id === a.id ? { ...x, is_active: nextActive } : x))
    );
    try {
      const res = await fetch(`/api/admin/add-ons/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: nextActive }),
      });
      if (!res.ok) {
        // revert the optimistic flip on failure
        setAddons((prev) =>
          prev.map((x) => (x.id === a.id ? { ...x, is_active: a.is_active } : x))
        );
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Failed to update add-on");
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function removeAddon(a: Addon) {
    if (!confirm(`Remove "${a.label}"? This cannot be undone.`)) return;
    setBusyId(a.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/add-ons/${a.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Failed to remove add-on");
        return;
      }
      setAddons((prev) => prev.filter((x) => x.id !== a.id));
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-text">Website Add-ons</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Manage the catalog of add-ons agents can offer on the New Lead form. Inactive
          add-ons stay attached to any lead that already has them but drop out of the picker.
        </p>
      </div>

      {error && (
        <div className="mb-4 text-sm rounded-md px-3 py-2 bg-dropped-bg text-dropped-fg">
          {error}
        </div>
      )}

      <div className="bg-surface border border-border rounded-lg p-5 mb-5">
        <div className="text-[10px] uppercase tracking-wider text-text-faint font-semibold mb-4">
          Add new add-on
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium text-text-muted mb-1">Label</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Live Chat"
              className={inputCls}
            />
          </div>
          <div className="w-32">
            <label className="block text-xs font-medium text-text-muted mb-1">
              Price (optional)
            </label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="50"
              min="0"
              step="0.01"
              className={inputCls}
            />
          </div>
          <button
            onClick={addAddon}
            disabled={adding || !label.trim()}
            className="px-4 py-2 text-sm font-semibold rounded-md bg-accent text-white hover:bg-accent-ink disabled:opacity-60"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        {addons.length === 0 ? (
          <div className="p-5 text-sm text-text-muted">No add-ons configured yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-text-faint border-b border-border-subtle">
                <th className="py-2 px-4 font-semibold">Label</th>
                <th className="px-4 font-semibold">Price</th>
                <th className="px-4 font-semibold">Status</th>
                <th className="px-4"></th>
              </tr>
            </thead>
            <tbody>
              {addons.map((a) => (
                <tr key={a.id} className="border-t border-border-subtle">
                  <td className="py-2.5 px-4 text-text">{a.label}</td>
                  <td className="px-4 text-text-muted font-mono">
                    {a.price != null ? `$${a.price}` : "—"}
                  </td>
                  <td className="px-4">
                    <button
                      onClick={() => toggleActive(a)}
                      disabled={busyId === a.id}
                      title={a.is_active ? "Click to deactivate" : "Click to activate"}
                      className={
                        a.is_active
                          ? "px-2.5 py-1 text-[11px] font-semibold rounded-md bg-ready-bg text-ready-fg disabled:opacity-60"
                          : "px-2.5 py-1 text-[11px] font-semibold rounded-md bg-dropped-bg text-dropped-fg disabled:opacity-60"
                      }
                    >
                      {a.is_active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-4 text-right">
                    <button
                      onClick={() => removeAddon(a)}
                      disabled={busyId === a.id}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded-md border border-border text-dropped-fg hover:bg-dropped-bg disabled:opacity-60"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
