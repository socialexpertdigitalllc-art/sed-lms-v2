"use client";

import { useState } from "react";
import type { LeadFollowUp } from "@/lib/leads/followups";
import { isFollowUpEligible } from "@/lib/leads/followups";
import { formatDateTime } from "@/lib/leads/format";
import { usePermissions } from "@/hooks/usePermissions";
import { FuStatusChip } from "./FuStatusChip";
import { FollowUpModal } from "./FollowUpModal";
import { FollowUpDetailModal } from "./FollowUpDetailModal";
import { FollowUpLogModal } from "./FollowUpLogModal";

export function RecentFollowUps({
  leadId,
  businessName,
  leadStatus,
  followUps,
}: {
  leadId: string;
  businessName: string;
  leadStatus: string;
  followUps: LeadFollowUp[];
}) {
  const { has } = usePermissions();
  const [entryOpen, setEntryOpen] = useState(false);
  const [selected, setSelected] = useState<LeadFollowUp | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  return (
    <div className="sticky top-6 rounded-2xl border border-border bg-surface shadow-sm p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">Recent follow-ups</h2>
        {has("leads.followup") && isFollowUpEligible(leadStatus) && (
          <button
            onClick={() => setEntryOpen(true)}
            className="bg-accent text-white text-xs font-semibold rounded-md px-3 py-1.5 hover:bg-accent-ink"
          >
            Follow Up
          </button>
        )}
      </div>

      <div className="mt-4">
        {followUps.length === 0 ? (
          <p className="text-sm text-text-muted">No follow-ups yet.</p>
        ) : (
          <div className="space-y-2">
            {followUps.slice(0, 3).map((fu) => (
              <FollowUpCard key={fu.id} followUp={fu} onClick={() => setSelected(fu)} />
            ))}
          </div>
        )}
      </div>

      {followUps.length > 0 && (
        <button
          onClick={() => setLogOpen(true)}
          className="mt-4 w-full text-xs text-text-muted hover:text-text rounded-md border border-border px-3 py-2 hover:bg-surface-2 transition-colors"
        >
          See all follow-ups ({followUps.length})
        </button>
      )}

      <FollowUpModal
        leadId={leadId}
        businessName={businessName}
        open={entryOpen}
        onClose={() => setEntryOpen(false)}
      />
      <FollowUpDetailModal
        followUp={selected}
        open={selected !== null}
        onClose={() => setSelected(null)}
      />
      <FollowUpLogModal
        followUps={followUps}
        open={logOpen}
        onClose={() => setLogOpen(false)}
        onSelect={(fu) => {
          setLogOpen(false);
          setSelected(fu);
        }}
      />
    </div>
  );
}

function FollowUpCard({
  followUp,
  onClick,
}: {
  followUp: LeadFollowUp;
  onClick: () => void;
}) {
  const snippet =
    followUp.fu_status === "Pickup" ? followUp.comments || "—" : "No pickup";
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-surface hover:bg-surface-2 transition-colors px-3 py-2.5"
    >
      <div className="flex items-center gap-2">
        <FuStatusChip status={followUp.fu_status} />
        <span className="text-xs text-text-muted">{formatDateTime(followUp.created_at)}</span>
      </div>
      <p className="text-xs text-text-muted mt-1 truncate">{snippet}</p>
      {followUp.next_follow_up_time && (
        <p className="text-[11px] text-text-faint mt-1">
          Next: {formatDateTime(followUp.next_follow_up_time)}
        </p>
      )}
    </button>
  );
}
