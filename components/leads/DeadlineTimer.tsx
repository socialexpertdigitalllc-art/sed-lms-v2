"use client";

import { useEffect, useState } from "react";
import { AlarmClock, Loader2, Send, Timer } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { useNowTick } from "@/hooks/useNowTick";
import { syncLeadsNow } from "@/hooks/useLiveLeads";
import { deadlineState, formatCountdown, type DeadlinePhase } from "@/lib/leads/deadline";

const LOOK: Record<DeadlinePhase, { pill: string; label: string; hint: string | null }> = {
  main: { pill: "border-accent/40 bg-accent-soft text-accent-ink", label: "Main", hint: null },
  bonus: { pill: "border-notready-fg/40 bg-notready-bg text-notready-fg", label: "Bonus", hint: "Main time is up — send the website as soon as it's ready" },
  overdue: { pill: "border-dropped-fg/40 bg-dropped-bg text-dropped-fg", label: "Overdue", hint: "Follow-up time has passed — send the website now" },
};

const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/**
 * The website deadline under a new lead's date (lib/leads/deadline.ts), for
 * Tech and Admin: the 3-hour main timer, then the bonus timer to the
 * follow-up time, then overdue — each its own colour — and SENT, which turns
 * the lead Ready (a site waiting for review is finalized in the same click).
 */
export function DeadlineTimer({
  lead,
  hasWebsite,
  onSent,
}: {
  lead: { id: string; status: string; created_at: string; follow_up_time?: string | null; business_name: string };
  /** The lead has a website link, or a published site waiting for review. */
  hasWebsite: boolean;
  onSent: () => void;
}) {
  const now = useNowTick();
  const state = now ? deadlineState(lead, now) : null;
  if (!state) return null;
  const look = LOOK[state.phase];
  const Icon = state.phase === "main" ? Timer : AlarmClock;
  const text = state.phase === "overdue" ? `Overdue ${formatCountdown(state.overdueMs)}` : `${look.label} · ${formatCountdown(state.msLeft)}`;
  const title =
    state.phase === "main"
      ? `Main timer: send the website by ${clock(state.endsAt!)}`
      : state.phase === "bonus"
        ? `Bonus timer: the follow-up time is ${clock(state.endsAt!)}`
        : "The follow-up time has passed";
  return (
    <div data-testid="deadline-timer" data-phase={state.phase} className="mt-1 space-y-0.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          title={title}
          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${look.pill} ${state.phase === "overdue" ? "animate-pulse" : ""}`}
        >
          <Icon size={11} className="shrink-0" />
          {text}
        </span>
        <SentButton leadId={lead.id} businessName={lead.business_name} hasWebsite={hasWebsite} onSent={onSent} />
      </div>
      {look.hint && <div className={`max-w-[15rem] text-[10px] font-medium leading-tight ${state.phase === "overdue" ? "text-dropped-fg" : "text-notready-fg"}`}>{look.hint}</div>}
    </div>
  );
}

function SentButton({ leadId, businessName, hasWebsite, onSent }: { leadId: string; businessName: string; hasWebsite: boolean; onSent: () => void }) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // An unanswered "Sure?" goes back to SENT by itself.
  useEffect(() => {
    if (!confirming) return;
    const t = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirming]);

  async function send() {
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/sent`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string; finalized?: boolean };
      if (!res.ok) {
        toast({ kind: "error", title: "Couldn't mark it sent", body: body.error ?? `Error ${res.status}` });
        return;
      }
      toast({
        kind: "success",
        title: `${businessName} is Ready`,
        body: body.finalized ? "The website was finalized and the lead marked Ready." : "Marked sent — the lead is Ready.",
      });
      onSent();
      syncLeadsNow();
    } catch {
      toast({ kind: "error", title: "Couldn't mark it sent", body: "Network error — try again." });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!hasWebsite) {
    return (
      <button
        type="button"
        disabled
        title="No website yet — publish the site first"
        className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-faint opacity-60"
      >
        <Send size={10} /> Sent
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      aria-label={confirming ? `Confirm: ${businessName}'s website was sent` : `Mark ${businessName}'s website sent`}
      title={confirming ? "Click again to mark the website sent (the lead turns Ready)" : "The website was sent to the client: turn the lead Ready"}
      onClick={() => (confirming ? void send() : setConfirming(true))}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide transition-colors disabled:opacity-60 ${
        confirming ? "border-ready-fg bg-ready-fg text-white" : "border-ready-fg/50 bg-ready-bg text-ready-fg hover:bg-ready-fg hover:text-white"
      }`}
    >
      {busy ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
      {confirming ? "Sure?" : "Sent"}
    </button>
  );
}
