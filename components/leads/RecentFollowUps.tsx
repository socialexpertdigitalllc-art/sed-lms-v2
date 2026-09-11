"use client";

import { useState } from "react";
import type { LeadFollowUp } from "@/lib/leads/followups";
import { isFollowUpEligible } from "@/lib/leads/followups";
import { formatDateTime, formatRelative } from "@/lib/leads/format";
import { usePermissions } from "@/hooks/usePermissions";
import { FuStatusChip } from "./FuStatusChip";
import { FollowUpModal } from "./FollowUpModal";
import { FollowUpDetailModal } from "./FollowUpDetailModal";
import { FollowUpLogModal } from "./FollowUpLogModal";
import { PhoneCall, Plus } from "lucide-react";
import { CollapsibleCard } from "@/components/common/CollapsibleCard";
import { btnSecondarySm } from "@/components/common/buttons";

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

  const last = followUps[0] ?? null;
  return (
    <>
      <CollapsibleCard
        icon={PhoneCall}
        title="Follow-ups"
        count={followUps.length}
        summary={last ? `${last.fu_status} · ${formatRelative(last.created_at)}` : "none yet"}
        action={
          has("leads.followup") && isFollowUpEligible(leadStatus) ? (
            // Same style as every other side-card create button (item: one
            // visual language for the right rail — see LeadContractsCard).
            <button type="button" onClick={() => setEntryOpen(true)} className={btnSecondarySm}>
              <Plus className="h-3.5 w-3.5" /> Follow Up
            </button>
          ) : null
        }
      >
        {followUps.length === 0 ? (
          <p className="text-sm text-text-muted">No follow-ups yet.</p>
        ) : (
          <div className="space-y-2">
            {followUps.slice(0, 3).map((fu) => (
              <FollowUpCard key={fu.id} followUp={fu} onClick={() => setSelected(fu)} />
            ))}
          </div>
        )}
        {followUps.length > 0 && (
          <button
            onClick={() => setLogOpen(true)}
            className="mt-4 w-full text-xs text-text-muted hover:text-text rounded-md border border-border px-3 py-2 hover:bg-surface-2 transition-colors"
          >
            See all follow-ups ({followUps.length})
          </button>
        )}
      </CollapsibleCard>

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
    </>
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
