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
  size = "sm",
}: {
  leadId: string;
  businessName: string;
  /** Opens the follow-up modal preset to Pickup. */
  onPickup: () => void;
  size?: "sm" | "md";
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

  const box =
    size === "md"
      ? "h-7 w-7"
      : "h-5 w-5";
  const icon = size === "md" ? "h-4 w-4" : "h-3 w-3";
  const base =
    "inline-flex items-center justify-center rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={onPickup}
        disabled={busy}
        title="Picked up — log the follow-up"
        aria-label="Log a Pickup follow-up"
        className={`${base} ${box} border-ready-fg/30 text-ready-fg hover:bg-ready-bg`}
      >
        <Check className={icon} />
      </button>
      <button
        type="button"
        onClick={() => void logNoPickup()}
        disabled={busy}
        title="No pickup — log it and retry in 24 hours"
        aria-label="Log a No Pickup follow-up and retry in 24 hours"
        className={`${base} ${box} border-dropped-fg/30 text-dropped-fg hover:bg-dropped-bg`}
      >
        <X className={icon} />
      </button>
    </span>
  );
}
