"use client";

import { useState } from "react";
import { Loader2, SquarePen } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { iconBtn } from "@/components/common/buttons";

function followLink(url: string) {
  window.location.assign(url);
}

/**
 * Icon button: open this lead's website in SED CMS, signed in as the
 * developer's own CMS account. POST /api/sedcms/open { leadId } answers a
 * one-time sign-in link on the CMS's own address, which the browser follows
 * in this tab. Beside the site-file icons on the lead and ticket pages, for
 * the people who may overwrite a site (studio.manage or tickets.resolve).
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

  async function open() {
    setBusy(true);
    try {
      const res = await fetch("/api/sedcms/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: unknown; error?: unknown };
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

  return (
    <button type="button" className={className} title="Open in SED CMS" aria-label="Open in CMS" disabled={busy} onClick={open}>
      {busy ? (
        <Loader2 style={{ width: iconSize, height: iconSize }} className="animate-spin" />
      ) : (
        <SquarePen style={{ width: iconSize, height: iconSize }} />
      )}
    </button>
  );
}
