"use client";

import { useState } from "react";
import { Loader2, SquarePen } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { iconBtn } from "@/components/common/buttons";

function followLink(url: string) {
  window.location.assign(url);
}

/** What the LMS asks a manager to confirm before SED CMS may change a site. */
interface Confirmation {
  code: "CONFIRM_LINK" | "CONFIRM_HOST_CHANGE";
  host: string;
  message: string;
}

function confirmationOf(status: number, body: Record<string, unknown>): Confirmation | null {
  if (status !== 409 || (body.code !== "CONFIRM_LINK" && body.code !== "CONFIRM_HOST_CHANGE")) return null;
  if (typeof body.host !== "string" || typeof body.message !== "string") return null;
  return { code: body.code, host: body.host, message: body.message };
}

/**
 * Icon button: open this lead's website in SED CMS, signed in as the
 * developer's own CMS account. POST /api/sedcms/open { leadId } answers a
 * one-time sign-in link on the CMS's own address, which the browser follows
 * in this tab. Beside the site-file icons on the lead and ticket pages, for
 * the people who may overwrite a site (studio.manage or tickets.resolve).
 *
 * The first time (or after the lead's website address changed) the LMS asks
 * a manager to confirm, in plain words, that the CMS may change this
 * website's files; the dialog names the site, and only its confirm button
 * sends the request again with confirmHost.
 */
export function OpenInCmsButton({
  leadId,
  className = iconBtn,
  iconSize = 16,
  navigate = followLink,
}: {
  leadId: string;
  className?: string;
  iconSize?: number;
  /** Where the browser goes; replaced only in tests. */
  navigate?: (url: string) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);

  async function open(confirmHost?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/sedcms/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmHost ? { leadId, confirmHost } : { leadId }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const confirmation = confirmationOf(res.status, body);
      if (confirmation) {
        setConfirming(confirmation);
        return;
      }
      let url: URL | null = null;
      try {
        url = typeof body.url === "string" ? new URL(body.url) : null;
      } catch {
        url = null;
      }
      if (!res.ok || !url || (url.protocol !== "https:" && url.protocol !== "http:")) {
        toast({
          kind: "error",
          title: "Couldn't open the CMS",
          body: typeof body.error === "string" ? body.error : `The CMS couldn't be opened (${res.status})`,
        });
        return;
      }
      navigate(url.toString());
    } catch {
      toast({ kind: "error", title: "Couldn't open the CMS", body: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  const moving = confirming?.code === "CONFIRM_HOST_CHANGE";
  const title = moving ? "Confirm the new website address?" : "Turn on SED CMS?";

  return (
    <>
      <button type="button" className={className} title="Open in SED CMS" aria-label="Open in CMS" disabled={busy} onClick={() => void open()}>
        {busy ? (
          <Loader2 style={{ width: iconSize, height: iconSize }} className="animate-spin" />
        ) : (
          <SquarePen style={{ width: iconSize, height: iconSize }} />
        )}
      </button>
      {confirming ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h3 className="text-sm font-semibold text-text">{title}</h3>
            <p className="mt-2 text-sm text-text-muted">{confirming.message}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const host = confirming.host;
                  setConfirming(null);
                  void open(host);
                }}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                {moving ? `Confirm ${confirming.host}` : `Turn on SED CMS for ${confirming.host}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
