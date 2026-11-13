"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, Hourglass, Loader2 } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { syncLeadsNow } from "@/hooks/useLiveLeads";

/**
 * A published website waiting for the developer (lib/leads/siteReview.ts).
 *
 * Developers see the link, open it, fix what needs fixing, then press
 * Finalize: the link becomes the lead's website link for everyone and the
 * agent and closer hear "Website live". Everyone else sees only that the
 * developer is finishing it: no link, so nobody can send it to the client early.
 */
export type SiteReviewView = {
  /** Only ever filled in for developers. */
  url: string | null;
  published_at: string;
};

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function SiteReviewBox({
  leadId,
  review,
  isDeveloper,
  hasFinishedLink,
}: {
  leadId: string;
  review: SiteReviewView;
  isDeveloper: boolean;
  /** The lead already has a finished website (this is an update to it). */
  hasFinishedLink: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (!isDeveloper || !review.url) {
    return (
      <div
        data-testid="site-review-note"
        className="mt-4 flex items-start gap-2 rounded-lg border border-notready-fg/30 bg-notready-bg px-3 py-2.5 text-sm text-notready-fg"
      >
        <Hourglass size={16} className="mt-0.5 shrink-0" />
        <div>
          <div className="font-medium">
            {hasFinishedLink ? "The developer is finishing an update to this website" : "The website is being finalized by the developer"}
          </div>
          <div className="text-xs opacity-90">
            {hasFinishedLink
              ? "The link above is the last finished version. You'll be notified when the update is final."
              : "The link will appear here once the developer has checked it and finalized it. You'll be notified."}
          </div>
        </div>
      </div>
    );
  }

  async function finalize() {
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/site-review/finalize`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string; url?: string };
      if (!res.ok) {
        toast({ kind: "error", title: "Could not finalize the website", body: body.error ?? `Error ${res.status}` });
        return;
      }
      toast({ kind: "success", title: "Website finalized", body: "Everyone can see the link now, and the agent was told it's live." });
      setConfirming(false);
      void syncLeadsNow();
      router.refresh();
    } catch {
      toast({ kind: "error", title: "Could not finalize the website", body: "Network error — try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="site-review-box" className="mt-4 rounded-lg border border-notready-fg/40 bg-notready-bg px-3 py-3 text-sm">
      <div className="flex items-start gap-2 text-notready-fg">
        <Hourglass size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{hasFinishedLink ? "Website update waiting for your review" : "Website waiting for your review"}</div>
          <div className="text-xs opacity-90">
            Only developers can see this link. Check the site, make any fixes, then finalize it: the link then shows for everyone and
            the agent is told it&apos;s live.
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
        <a
          href={review.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-w-0 max-w-full items-center gap-1 break-all font-medium text-accent-ink underline-offset-2 hover:underline"
        >
          {review.url} <ExternalLink size={12} className="shrink-0" />
        </a>
        <span className="text-xs text-text-faint">published {when(review.published_at)}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-6">
        {confirming ? (
          <>
            <span className="text-xs text-text-muted">Is the website finished and ready for the client?</span>
            <button
              type="button"
              onClick={finalize}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-ready-fg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Yes, finalize
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-2"
            >
              Not yet
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-ready-fg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            <CheckCircle2 size={13} /> Finalize website
          </button>
        )}
      </div>
    </div>
  );
}
