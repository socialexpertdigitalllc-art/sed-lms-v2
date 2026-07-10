"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteLeadModal({
  leadId,
  businessName,
  open,
  onClose,
}: {
  leadId: string;
  businessName: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/leads/${leadId}`, { method: "DELETE" });
    if (!res.ok) {
      setBusy(false);
      setError((await res.json().catch(() => ({}))).error ?? "Failed to delete");
      return;
    }
    router.push("/leads");
    router.refresh();
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 bg-black/30 grid place-items-center z-50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-surface border border-border rounded-lg p-6 w-full max-w-[400px] max-h-[90vh] overflow-y-auto">
        <h2 className="font-semibold text-text">Delete lead</h2>
        <p className="text-sm text-text-muted mt-2">
          This removes <span className="font-medium text-text">{businessName}</span> from your active
          pipeline. It is a soft-delete — the record is recoverable by an administrator.
        </p>
        {error && <div className="mt-3 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">{error}</div>}
        <label className="flex items-center gap-2 mt-4 text-sm text-text-muted">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="accent-dropped-fg w-4 h-4" />
          I understand this removes it from the pipeline.
        </label>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-border text-text-muted hover:bg-surface-2">
            Cancel
          </button>
          <button
            onClick={remove}
            disabled={!confirmed || busy}
            className="px-4 py-2 text-sm rounded-md bg-dropped-fg text-white font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Delete lead"}
          </button>
        </div>
      </div>
    </div>
  );
}
