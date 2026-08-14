"use client";

import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { iconBtn } from "@/components/common/buttons";

/**
 * Icon button that uploads a zip OVER a hosted site's live files
 * (POST /api/site-studio/deployments/override) — the write mirror of
 * DownloadSiteFilesButton, for the download → fix → re-upload loop on the
 * ticket and lead screens. The button is bound to ONE site (the lead's
 * website), and the confirm dialog names that site out loud before anything
 * is sent — the mistake this exists to prevent is files landing on the wrong
 * lead's website from a generic board picker.
 */
export function UploadSiteFilesButton({
  site,
  className = iconBtn,
  iconSize = 16,
  disabled = false,
  onUploaded,
}: {
  /** Site URL or hostname — the lead's website_link or a deployment url. */
  site: string;
  className?: string;
  iconSize?: number;
  disabled?: boolean;
  /** Called after a successful upload (e.g. router.refresh). */
  onUploaded?: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const host = site.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/site-studio/deployments/override?site=${encodeURIComponent(site)}`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; files?: number };
      if (!res.ok) {
        toast({ kind: "error", title: "Upload failed", body: body.error ?? `Upload failed (${res.status})` });
        return;
      }
      toast({ kind: "success", title: "Website updated", body: `${body.files ?? "The"} file(s) are now live on ${host}` });
      onUploaded?.();
    } catch {
      toast({ kind: "error", title: "Upload failed", body: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = ""; // allow re-picking the same file next time
    if (file) setPendingFile(file);
  }

  return (
    <>
      <button
        type="button"
        className={className}
        title="Upload updated website files"
        aria-label={`Upload updated files to ${host}`}
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
      >
        {busy ? (
          <Loader2 style={{ width: iconSize, height: iconSize }} className="animate-spin" />
        ) : (
          <Upload style={{ width: iconSize, height: iconSize }} />
        )}
      </button>
      <input ref={input} type="file" accept=".zip,application/zip" className="hidden" onChange={onPick} />
      {pendingFile ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Upload new files to ${host}?`}
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h3 className="text-sm font-semibold text-text">Upload new files to {host}?</h3>
            <p className="mt-2 text-sm text-text-muted">
              This replaces the live files of <span className="font-semibold text-text">{host}</span> with{" "}
              <span className="font-mono text-xs">{pendingFile.name}</span>. The website address stays the same.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingFile(null)}
                className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const file = pendingFile;
                  setPendingFile(null);
                  if (file) void upload(file);
                }}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Upload to {host}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
