"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { QUICK_NO_PICKUP_MS } from "@/lib/leads/followups";

/**
 * The two outcomes of a call, one click each.
 *
 * Nearly every follow-up is one of these, and making an agent open a modal to
 * say "nobody answered" is the slowest part of working a queue. So:
 *   Tick  — opens the modal already set to Pickup, because a pickup always has
 *           something to write down and a time to agree on.
 *   Cross — posts the No Pickup outright and books the retry a day out. There
 *           is nothing to type: the API stores no comment for a No Pickup.
 */
export function FollowUpQuickActions({
  leadId,
  businessName,
  onPickup,
  className = "",
}: {
  leadId: string;
  businessName: string;
  /** Opens the follow-up modal preset to Pickup. */
  onPickup: () => void;
  /** Spacing/reveal rules from the surface embedding these. */
  className?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function logNoPickup() {
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/follow-ups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fu_status: "No Pickup",
          comments: null,
          next_follow_up_time: new Date(Date.now() + QUICK_NO_PICKUP_MS).toISOString(),
          status_change: null,
          is_specific_time: false,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Could not log the follow-up" });
        return;
      }
      toast({ kind: "success", title: `No Pickup logged`, body: `${businessName} — retry in 24h` });
      router.refresh();
    } catch {
      toast({ kind: "error", title: "Network error — try again" });
    } finally {
      setBusy(false);
    }
  }

  // Borderless at rest. These sit beside a pill and a streak count, and a
  // bordered box around each one turned that cluster into four competing
  // chips; the colour arrives on hover, where the intent is.
  const base =
    "inline-grid h-6 w-6 place-items-center rounded-md text-text-faint transition-colors " +
    "disabled:cursor-not-allowed disabled:opacity-40 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 ${className}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={onPickup}
        disabled={busy}
        title="Picked up — log the follow-up"
        aria-label="Log a Pickup follow-up"
        className={`${base} hover:bg-ready-bg hover:text-ready-fg`}
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => void logNoPickup()}
        disabled={busy}
        title="No pickup — log it and retry in 24 hours"
        aria-label="Log a No Pickup follow-up and retry in 24 hours"
        className={`${base} hover:bg-dropped-bg hover:text-dropped-fg`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
