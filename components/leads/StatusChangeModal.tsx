"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LEAD_STATUSES } from "@/lib/leads/types";

export function StatusChangeModal({
  leadId,
  current,
  businessName,
  open,
  onClose,
}: {
  leadId: string;
  current: string;
  businessName: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Failed to update");
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 bg-black/30 grid place-items-center z-50 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-border rounded-lg p-6 w-[360px]"
      >
        <h2 className="font-semibold text-text">Change status</h2>
        <p className="text-sm text-text-muted mt-1 mb-4 truncate">{businessName}</p>

        {error && <div className="mb-3 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">{error}</div>}

        <div className="grid grid-cols-2 gap-2">
          {LEAD_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={
                "text-sm rounded-md border px-3 py-2 transition-colors " +
                (status === s
                  ? "border-accent bg-accent-soft text-accent-ink font-medium"
                  : "border-border text-text-muted hover:bg-surface-2")
              }
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-border text-text-muted hover:bg-surface-2">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy || status === current}
            className="px-4 py-2 text-sm rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60"
          >
            {busy ? "Saving…" : "Update"}
          </button>
        </div>
      </div>
    </div>
  );
}
