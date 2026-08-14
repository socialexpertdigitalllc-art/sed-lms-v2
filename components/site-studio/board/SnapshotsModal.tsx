"use client";

import { useEffect, useState } from "react";
import { History, Loader2, Undo2 } from "lucide-react";
import { RelativeTime } from "@/components/common/RelativeTime";
import { useToast } from "@/components/common/Toast";

interface Snapshot {
  path: string;
  name: string;
  takenAt: string | null;
  bytes: number | null;
}

/**
 * File history for one site: the snapshots taken automatically before every
 * override/restore, each restorable in one click. Restoring snapshots the
 * current files first, so the restore itself can be undone from this same
 * list.
 */
export function SnapshotsModal({
  site,
  onClose,
  onRestored,
}: {
  site: string;
  onClose: () => void;
  onRestored: () => void;
}) {
  const { toast } = useToast();
  const host = site.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/site-studio/deployments/snapshots?site=${encodeURIComponent(site)}`);
        const body = (await res.json().catch(() => ({}))) as { snapshots?: Snapshot[]; error?: string };
        if (cancelled) return;
        if (!res.ok) setError(body.error ?? "Could not load the file history");
        else setSnapshots(body.snapshots ?? []);
      } catch {
        if (!cancelled) setError("Network error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [site]);

  async function restore(snapshot: Snapshot) {
    setBusy(true);
    try {
      const res = await fetch(`/api/site-studio/deployments/restore?site=${encodeURIComponent(site)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: snapshot.path }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({ kind: "error", title: "Restore failed", body: body.error ?? `Restore failed (${res.status})` });
        return;
      }
      toast({ kind: "success", title: "Website restored", body: `${host} is back on the selected version` });
      onRestored();
      onClose();
    } catch {
      toast({ kind: "error", title: "Restore failed", body: "Network error" });
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  const kb = (n: number | null) => (n === null ? "" : `${Math.max(1, Math.round(n / 1024))} KB`);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`File history of ${host}`}
    >
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-lg">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
          <History className="h-4 w-4" /> File history — {host}
        </h3>
        <p className="mt-1 text-xs text-text-faint">
          A snapshot is saved automatically before every upload. Restoring also snapshots the current files first.
        </p>

        <div className="mt-3 max-h-72 overflow-auto rounded-md border border-border">
          {error ? (
            <p className="px-3 py-4 text-sm text-dropped-fg">{error}</p>
          ) : snapshots === null ? (
            <p className="flex items-center gap-2 px-3 py-4 text-sm text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : snapshots.length === 0 ? (
            <p className="px-3 py-4 text-sm text-text-muted">
              No snapshots yet — one is taken automatically the first time new files are uploaded.
            </p>
          ) : (
            <ul>
              {snapshots.map((s) => (
                <li key={s.path} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-0">
                  <span className="text-text">
                    {s.takenAt ? <RelativeTime iso={s.takenAt} /> : s.name}
                    <span className="ml-2 text-xs text-text-faint">{kb(s.bytes)}</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirming(s)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-text hover:bg-surface-2 disabled:opacity-50"
                  >
                    <Undo2 className="h-3.5 w-3.5" /> Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text"
          >
            Close
          </button>
        </div>
      </div>

      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true"
          aria-label={`Restore ${host}?`}>
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h3 className="text-sm font-semibold text-text">Restore {host}?</h3>
            <p className="mt-2 text-sm text-text-muted">
              The live files of <span className="font-semibold text-text">{host}</span> will be replaced with the
              snapshot from{" "}
              <span className="font-semibold text-text">
                {confirming.takenAt ? <RelativeTime iso={confirming.takenAt} /> : confirming.name}
              </span>
              . The current files are snapshotted first, so this can be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setConfirming(null)}
                className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text">
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={() => void restore(confirming)}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                {busy ? "Restoring…" : "Restore this version"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
