"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { settableStatuses } from "@/lib/leads/categories";
import { usePermissions } from "@/hooks/usePermissions";

export function StatusChangeModal({
  leadId,
  current,
  businessName,
  websiteLink,
  open,
  onClose,
}: {
  leadId: string;
  current: string;
  businessName: string;
  websiteLink: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { all } = usePermissions();
  const [status, setStatus] = useState(current);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = settableStatuses(all);
  const needsLink = status === "Ready" && !(websiteLink && websiteLink.trim());

  if (!open) return null;

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(needsLink ? { status, website_link: link.trim() } : { status }),
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
    <div role="dialog" aria-modal="true" className="fixed inset-0 bg-black/30 grid place-items-center z-50 p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-border rounded-lg p-6 w-full max-w-[360px] max-h-[90vh] overflow-y-auto"
      >
        <h2 className="font-semibold text-text">Change status</h2>
        <p className="text-sm text-text-muted mt-1 mb-4 truncate">{businessName}</p>

        {error && <div className="mb-3 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">{error}</div>}

        {options.length === 0 ? (
          <p className="text-sm text-text-muted">No statuses available to you.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {options.map((s) => (
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
        )}

        {needsLink && (
          <div className="mt-4">
            <label htmlFor="ready-website-link" className="block text-sm text-text-muted mb-1">
              Website link (required for Ready)
            </label>
            <input
              id="ready-website-link"
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://…"
              className="w-full px-3 py-2 rounded-md border border-border bg-surface text-sm outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-border text-text-muted hover:bg-surface-2">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy || status === current || !options.includes(status as (typeof options)[number]) || (needsLink && !link.trim())}
            className="px-4 py-2 text-sm rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60"
          >
            {busy ? "Saving…" : "Update"}
          </button>
        </div>
      </div>
    </div>
  );
}
