"use client";

import type { LeadFollowUp } from "@/lib/leads/followups";
import { formatDateTime } from "@/lib/leads/format";
import { FuStatusChip } from "./FuStatusChip";

export function FollowUpLogModal({
  followUps,
  open,
  onClose,
  onSelect,
}: {
  followUps: LeadFollowUp[];
  open: boolean;
  onClose: () => void;
  onSelect: (fu: LeadFollowUp) => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/30 grid place-items-center z-50 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-border rounded-lg p-6 w-[460px]"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-text">Follow-up history ({followUps.length})</h2>
          <button
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded-md border border-border text-text-muted hover:bg-surface-2"
          >
            Close
          </button>
        </div>

        {followUps.length === 0 ? (
          <p className="text-sm text-text-muted">No follow-ups yet.</p>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto -mx-2">
            {followUps.map((fu) => (
              <button
                key={fu.id}
                onClick={() => onSelect(fu)}
                className="w-full text-left rounded-md px-2 py-2.5 hover:bg-surface-2 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <FuStatusChip status={fu.fu_status} />
                  <span className="text-xs text-text-muted">{formatDateTime(fu.created_at)}</span>
                </div>
                <p className="text-xs text-text-muted mt-1 truncate">
                  {fu.fu_status === "Pickup" ? fu.comments || "—" : "No pickup"}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
