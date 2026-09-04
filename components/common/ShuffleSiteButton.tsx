"use client";

import { useState } from "react";
import { Loader2, Shuffle } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { iconBtn } from "@/components/common/buttons";

/**
 * Icon button that shuffles a hosted site to a FRESH subdomain
 * (POST /api/site-studio/deployments/shuffle?site=) — the deployments board's
 * shuffle, brought to the ticket screen, the lead screen and the lead table
 * beside the download and upload icons. Bound to ONE site, and the confirm
 * dialog names it out loud before anything moves: a shuffle deletes the old
 * address, so moving the wrong lead's site is the mistake this prevents.
 */
export function ShuffleSiteButton({
  site,
  className = iconBtn,
  iconSize = 16,
  disabled = false,
  onShuffled,
}: {
  /** Site URL or hostname — the lead's website_link or a deployment url. */
  site: string;
  className?: string;
  iconSize?: number;
  disabled?: boolean;
  /** Called with the NEW url after a successful shuffle (e.g. router.refresh). */
  onShuffled?: (url: string) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const host = site.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  async function shuffle() {
    setBusy(true);
    try {
      const res = await fetch(`/api/site-studio/deployments/shuffle?site=${encodeURIComponent(site)}`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; url?: string };
      if (!res.ok || !body.url) {
        toast({ kind: "error", title: "Shuffle failed", body: body.error ?? `Shuffle failed (${res.status})` });
        return;
      }
      const newHost = body.url.replace(/^https?:\/\//, "");
      toast({ kind: "success", title: "Website moved", body: `${host} is now live at ${newHost}` });
      onShuffled?.(body.url);
    } catch {
      toast({ kind: "error", title: "Shuffle failed", body: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        title="Shuffle to a new subdomain"
        aria-label={`Shuffle ${host} to a new subdomain`}
        disabled={disabled || busy}
        onClick={() => setConfirming(true)}
      >
        {busy ? (
          <Loader2 style={{ width: iconSize, height: iconSize }} className="animate-spin" />
        ) : (
          <Shuffle style={{ width: iconSize, height: iconSize }} />
        )}
      </button>
      {confirming ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Shuffle ${host} to a new subdomain?`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h3 className="text-sm font-semibold text-text">Shuffle {host} to a new subdomain?</h3>
            <p className="mt-2 text-sm text-text-muted">
              The current files of <span className="font-semibold text-text">{host}</span> move to the next
              version of its address, the old address is deleted, the lead&apos;s website link is updated and
              the agent is notified.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  void shuffle();
                }}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Shuffle {host}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
