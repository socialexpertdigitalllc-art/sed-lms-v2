"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Search, Upload } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { inputCls } from "@/components/forms/Field";
import { cn } from "@/lib/utils";

export type UploadResult = {
  url: string;
  subdomain: string;
  deploymentId: string | null;
  leadId: string | null;
  provisioning: boolean;
  trackingWarning: string | null;
};

/**
 * Upload a site zip to the hosting: a fresh {name}vN subdomain, or an existing
 * subdomain — either overridden in place or bumped to a {prev}vN+1 version
 * subdomain (the old one is deleted after the new version is live).
 */
export function UploadModal({
  subdomains,
  daDomain,
  initialTarget,
  onClose,
  onDone,
}: {
  /** every staging subdomain on the hosting (for the searchable target picker) */
  subdomains: string[];
  daDomain: string;
  /** preselect an existing subdomain (row action) */
  initialTarget?: string | null;
  onClose: () => void;
  onDone: (result: UploadResult) => void;
}) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState<"new" | "existing">(initialTarget ? "existing" : "new");
  const [name, setName] = useState("");
  const [query, setQuery] = useState(initialTarget ?? "");
  const [pickedSub, setPickedSub] = useState<string | null>(initialTarget ?? null);
  const [existingMode, setExistingMode] = useState<"override" | "version">("override");
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = q ? subdomains.filter((s) => s.includes(q)) : subdomains;
    return all.slice(0, 30);
  }, [subdomains, query]);

  const canUpload = Boolean(file) && (target === "new" ? name.trim().length > 0 : Boolean(pickedSub));

  async function upload() {
    if (!file || !canUpload) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (target === "new") {
        fd.append("mode", "new");
        fd.append("name", name.trim());
      } else {
        fd.append("mode", existingMode);
        fd.append("subdomain", pickedSub as string);
      }
      const res = await fetch("/api/site-studio/deployments/upload", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as UploadResult & { error?: string };
      if (!res.ok) {
        toast({ kind: "error", title: "Upload failed", body: j.error ?? "Try again" });
        return;
      }
      toast({
        kind: "success",
        title: `Site live at ${j.url.replace(/^https?:\/\//, "")}`,
        body:
          (j.provisioning ? "Provisioning — reachable shortly. " : "") +
          (j.trackingWarning ?? ""),
      });
      onDone(j);
      onClose();
    } catch {
      toast({ kind: "error", title: "Upload failed", body: "Network error — try again" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Upload a site">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
        <div className="border-b border-border-subtle p-5">
          <h3 className="text-sm font-semibold text-text">Upload a site (ZIP)</h3>
          <p className="mt-1 text-xs text-text-muted">A .zip of a static site with its files at the archive root.</p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">Site zip</label>
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-text file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-text"
            />
          </div>

          <div className="flex items-center gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input type="radio" className="accent-accent" checked={target === "new"} onChange={() => setTarget("new")} />
              New subdomain
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" className="accent-accent" checked={target === "existing"} onChange={() => setTarget("existing")} />
              Existing subdomain
            </label>
          </div>

          {target === "new" ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">Business / site name</label>
              <input className={inputCls} placeholder="e.g. Joes Plumbing" value={name} onChange={(e) => setName(e.target.value)} />
              <p className="mt-1 text-xs text-text-faint">
                Subdomain: first two words, max 20 chars, versioned — e.g.{" "}
                <span className="font-mono">{(name.trim() ? name.trim().toLowerCase().split(/\s+/).slice(0, 2).join("-").replace(/[^a-z0-9-]+/g, "").slice(0, 20) : "name") + "v1." + daDomain}</span>
              </p>
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">Pick the subdomain</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                  <input className={cn(inputCls, "pl-8")} placeholder="Search subdomains…" value={query}
                    onChange={(e) => { setQuery(e.target.value); setPickedSub(null); }} />
                </div>
                <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border-subtle">
                  {filtered.length === 0 ? (
                    <p className="p-3 text-xs text-text-faint">No matching subdomains.</p>
                  ) : (
                    filtered.map((s) => (
                      <button key={s} type="button" onClick={() => { setPickedSub(s); setQuery(s); }}
                        className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                          pickedSub === s ? "bg-accent-soft text-accent-ink" : "text-text hover:bg-surface-2")}>
                        <span className="flex-1 truncate font-mono text-xs">{s}.{daDomain}</span>
                        {pickedSub === s ? <Check className="h-3.5 w-3.5" /> : null}
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <label className="flex items-start gap-2">
                  <input type="radio" className="mt-0.5 accent-accent" checked={existingMode === "override"} onChange={() => setExistingMode("override")} />
                  <span>
                    <span className="font-medium text-text">Override in place</span>
                    <span className="block text-xs text-text-muted">Replace the files on the same subdomain — the link doesn&apos;t change.</span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="radio" className="mt-0.5 accent-accent" checked={existingMode === "version"} onChange={() => setExistingMode("version")} />
                  <span>
                    <span className="font-medium text-text">New version subdomain</span>
                    <span className="block text-xs text-text-muted">
                      Upload to {pickedSub ? <span className="font-mono">{pickedSub.replace(/v(\d+)$/, (_, n) => `v${Number(n) + 1}`) === pickedSub ? `${pickedSub}v2` : pickedSub.replace(/v(\d+)$/, (_, n) => `v${Number(n) + 1}`)}.{daDomain}</span> : "a versioned subdomain"}{" "}
                      and delete the old one. A linked lead&apos;s website link is updated.
                    </span>
                  </span>
                </label>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle p-4">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text disabled:opacity-50">Cancel</button>
          <button type="button" onClick={upload} disabled={!canUpload || busy}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload
          </button>
        </div>
      </div>
    </div>
  );
}
