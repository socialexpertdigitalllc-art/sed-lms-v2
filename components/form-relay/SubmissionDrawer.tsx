"use client";

import { useState } from "react";
import { X, RotateCw, ShieldOff, ShieldCheck, Trash2 } from "lucide-react";
import { btnSecondarySm, btnGhostSm, iconBtn } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { formatDateTime } from "@/lib/leads/format";
import { DeliveryPill } from "@/components/form-relay/DeliveryPill";
import type { SubmissionListItem } from "@/lib/forms/types";

export function SubmissionDrawer({
  submission,
  canManage,
  onClose,
  onChanged,
}: {
  submission: SubmissionListItem;
  canManage: boolean;
  onClose: () => void;
  /** Called after any mutation so the list refetches. */
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const s = submission;

  async function act(label: string, fn: () => Promise<Response>) {
    setBusy(label);
    const res = await fn();
    setBusy(null);
    if (!res.ok) { toast({ kind: "error", title: `${label} failed`, body: (await res.json().catch(() => ({}))).error }); return; }
    toast({ kind: "success", title: `${label} done` });
    onChanged();
  }
  const patch = (body: Record<string, unknown>) =>
    fetch(`/api/forms/submissions/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-full max-w-lg overflow-y-auto border-l border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-base font-semibold text-text">{s.subject || "(no subject)"}</h2>
            <p className="mt-0.5 text-xs text-text-muted">{s.endpoint_name ?? "Unknown endpoint"}{s.lead_name ? ` · ${s.lead_name}` : ""} · {formatDateTime(s.created_at)}</p>
          </div>
          <button type="button" className={iconBtn} onClick={onClose} title="Close" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <DeliveryPill status={s.delivery_status} spam={s.is_spam} />
          {s.is_spam && s.spam_reason ? <span className="text-xs text-text-muted">reason: {s.spam_reason}</span> : null}
        </div>

        <table className="mt-4 w-full text-sm">
          <tbody>
            {s.payload.map((f, i) => (
              <tr key={i} className="border-t border-border-subtle align-top">
                <td className="w-1/3 py-2 pr-3 font-medium text-text-muted">{f.key}</td>
                <td className="whitespace-pre-wrap break-words py-2 text-text">
                  {f.key.toLowerCase().includes("email") && f.value.includes("@") ? <a className="text-accent-ink underline" href={`mailto:${f.value}`}>{f.value}</a> : f.value}
                </td>
              </tr>
            ))}
            {s.payload.length === 0 ? <tr><td className="py-2 text-text-muted">No fields.</td></tr> : null}
          </tbody>
        </table>

        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-text-muted">
          <dt>From</dt><dd className="text-text">{s.submitter_name ?? "—"} {s.submitter_email ? <a className="underline" href={`mailto:${s.submitter_email}`}>{s.submitter_email}</a> : null}</dd>
          <dt>Site</dt><dd className="text-text">{s.origin ?? "—"}</dd>
          <dt>Referer</dt><dd className="break-all text-text">{s.referer ?? "—"}</dd>
          <dt>IP</dt><dd className="text-text">{s.ip ?? "—"}</dd>
          <dt>Browser</dt><dd className="break-all text-text">{s.user_agent ?? "—"}</dd>
          <dt>Delivery</dt>
          <dd className="text-text">
            {s.delivery_attempts} attempt{s.delivery_attempts === 1 ? "" : "s"}
            {s.delivered_at ? ` · sent ${formatDateTime(s.delivered_at)}` : ""}
            {s.last_error ? <span className="block text-dropped-fg">{s.last_error}</span> : null}
          </dd>
        </dl>

        {canManage ? (
          <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
            {!s.is_spam ? (
              <button type="button" className={btnSecondarySm} disabled={busy !== null} onClick={() => act("Resend", () => fetch(`/api/forms/submissions/${s.id}/resend`, { method: "POST" }))}>
                <RotateCw className="h-3.5 w-3.5" /> Resend
              </button>
            ) : null}
            {s.is_spam ? (
              <button type="button" className={btnSecondarySm} disabled={busy !== null} onClick={() => act("Not spam", () => patch({ spam: false }))}>
                <ShieldCheck className="h-3.5 w-3.5" /> Not spam (deliver)
              </button>
            ) : (
              <button type="button" className={btnSecondarySm} disabled={busy !== null} onClick={() => act("Mark spam", () => patch({ spam: true }))}>
                <ShieldOff className="h-3.5 w-3.5" /> Mark spam
              </button>
            )}
            <button
              type="button"
              className={btnGhostSm}
              disabled={busy !== null}
              onClick={() => { if (confirm("Delete this submission permanently?")) act("Delete", () => fetch(`/api/forms/submissions/${s.id}`, { method: "DELETE" })).then(onClose); }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
