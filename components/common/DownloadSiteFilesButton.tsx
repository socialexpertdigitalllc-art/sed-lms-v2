"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { iconBtn } from "@/components/common/buttons";

/**
 * Icon button that downloads a site's CURRENT files from the hosting platform
 * as a zip (GET /api/site-studio/deployments/download). Self-contained —
 * fetches to a blob so auth/permission errors surface as a toast instead of a
 * navigated-to JSON page — so every surface (deployments board, ticket
 * screen, lead screen) gets identical behavior from one import.
 */
export function DownloadSiteFilesButton({
  site,
  className = iconBtn,
  iconSize = 16,
  disabled = false,
}: {
  /** Site URL or hostname, e.g. the deployment url or the lead's website_link. */
  site: string;
  /** Button classes; defaults to the standard 32px icon button. */
  className?: string;
  iconSize?: number;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const res = await fetch(`/api/site-studio/deployments/download?site=${encodeURIComponent(site)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({ kind: "error", title: "Download failed", body: body.error ?? `Download failed (${res.status})` });
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "site-files.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ kind: "error", title: "Download failed", body: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  const host = site.replace(/^https?:\/\//, "");
  return (
    <button
      type="button"
      className={className}
      title="Download latest website files"
      aria-label={`Download the latest files of ${host}`}
      disabled={disabled || busy}
      onClick={() => void download()}
    >
      {busy ? (
        <Loader2 style={{ width: iconSize, height: iconSize }} className="animate-spin" />
      ) : (
        <Download style={{ width: iconSize, height: iconSize }} />
      )}
    </button>
  );
}
