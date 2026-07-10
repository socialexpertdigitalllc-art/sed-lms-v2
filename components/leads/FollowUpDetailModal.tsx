"use client";

import type { LeadFollowUp } from "@/lib/leads/followups";
import { formatDateTime } from "@/lib/leads/format";
import { FuStatusChip } from "./FuStatusChip";

export function FollowUpDetailModal({
  followUp,
  open,
  onClose,
}: {
  followUp: LeadFollowUp | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!open || !followUp) return null;

  const labelCls = "block text-[10px] uppercase tracking-wide text-text-faint mb-1";

  return (
    <div className="fixed inset-0 bg-black/30 grid place-items-center z-50 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-border rounded-lg p-6 w-full max-w-[400px] max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center gap-2">
          <FuStatusChip status={followUp.fu_status} />
        </div>
        <p className="text-xs text-text-muted mt-2">
          Logged by {followUp.logger_name ?? "Unknown"} · {formatDateTime(followUp.created_at)}
        </p>

        <div className="mt-4 space-y-4">
          {followUp.comments && (
            <div>
              <label className={labelCls}>Comments</label>
              <p className="text-sm text-text whitespace-pre-wrap">{followUp.comments}</p>
            </div>
          )}

          <div>
            <label className={labelCls}>Next follow-up</label>
            <p className="text-sm text-text">
              {followUp.next_follow_up_time ? formatDateTime(followUp.next_follow_up_time) : "—"}
            </p>
          </div>

          {followUp.status_change && (
            <div>
              <label className={labelCls}>Status set to</label>
              <p className="text-sm text-text">{followUp.status_change}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md border border-border text-text-muted hover:bg-surface-2"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
