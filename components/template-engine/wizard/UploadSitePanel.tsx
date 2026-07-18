"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileArchive, Loader2, Upload } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { inputCls } from "@/components/forms/Field";
import { cn } from "@/lib/utils";

// Manually deploy a hand-built / edited site zip to a dmviral subdomain —
// stand up a NEW subdomain or overwrite an EXISTING one — outside the generator.
export function UploadSitePanel({ daDomain }: { daDomain: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [subdomain, setSubdomain] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function submit() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast({ kind: "error", title: "Pick a zip", body: "Choose a .zip of the site first." });
      return;
    }
    if (!subdomain.trim()) {
      toast({ kind: "error", title: "Subdomain required", body: "Enter the subdomain name." });
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", mode);
      fd.append("subdomain", subdomain.trim());
      const res = await fetch("/api/template-engine/deployments/upload", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: "Upload failed", body: j.error ?? "Try again" });
        return;
      }
      toast({
        kind: "success",
        title: mode === "new" ? "Site uploaded" : "Subdomain updated",
        body: j.provisioning ? `${j.url} — provisioning, live shortly.` : j.url,
      });
      setSubdomain("");
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch {
      toast({ kind: "error", title: "Upload failed", body: "Network error — try again" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-medium text-text hover:bg-surface-2">
        <FileArchive className="h-4 w-4 text-text-faint" />
        Upload a site (ZIP)
        <span className="text-xs font-normal text-text-faint">— deploy hand-edited files to a subdomain</span>
      </button>
      {open ? (
        <div className="space-y-4 border-t border-border-subtle p-5">
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-text">
              <input type="radio" name="mode" checked={mode === "new"} onChange={() => setMode("new")} className="accent-accent" />
              New subdomain
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-text">
              <input type="radio" name="mode" checked={mode === "existing"} onChange={() => setMode("existing")} className="accent-accent" />
              Update existing subdomain
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">Subdomain</label>
              <div className="flex items-center">
                <input className={cn(inputCls, "rounded-r-none")} placeholder="business-name"
                  value={subdomain} onChange={(e) => setSubdomain(e.target.value)} aria-label="Subdomain name" />
                <span className="rounded-r-md border border-l-0 border-border bg-surface-2 px-2 py-2 text-sm text-text-faint">.{daDomain}</span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">Site zip</label>
              <input ref={fileRef} type="file" accept=".zip,application/zip"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
                className="block w-full text-sm text-text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-text hover:file:bg-surface" />
              {fileName ? <p className="mt-1 truncate text-xs text-text-faint">{fileName}</p> : null}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-text-faint">The zip&apos;s files should sit at its root (index.html, style.css, …).</p>
            <button type="button" onClick={submit} disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {mode === "new" ? "Create & upload" : "Overwrite subdomain"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
