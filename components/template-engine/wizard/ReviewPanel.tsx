"use client";

import { useMemo, useState } from "react";
import { Download, ExternalLink, Globe, Loader2, PencilLine, Rocket, ShieldCheck, TriangleAlert } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { CopyButton } from "@/components/common/CopyButton";
import { isDeployableStatus } from "@/lib/template-engine/wizard";
import { RedoButton, StaleNotice } from "./RedoControls";
import type { GenerationDetail } from "./GenerationWizard";
import { cn } from "@/lib/utils";

export function ReviewPanel({ gen, canDeploy, onChanged }: {
  gen: GenerationDetail; canDeploy: boolean; onChanged: () => void;
}) {
  // Prefer the steps-derived list of pages that actually got built — requested_pages
  // can include pages pageSelect dropped, which would 404 in the preview iframe.
  // Fall back to requested_pages for v1-legacy rows with no build:* steps.
  const built = useMemo(
    () => gen.steps
      .filter((s) => s.key.startsWith("build:") && s.key.endsWith(".html") && s.status !== "failed")
      .map((s) => s.key.slice(6)),
    [gen.steps],
  );
  const pages = built.length > 0 ? built : (gen.requested_pages ?? []);
  const entry = useMemo(
    () => pages.find((f) => /index|home/i.test(f)) ?? pages[0] ?? "index.html",
    [pages],
  );
  const [page, setPage] = useState(entry);
  const [deploying, setDeploying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reopening, setReopening] = useState(false);
  const { toast } = useToast();
  const ready = isDeployableStatus(gen.status);
  const gatesFailed = gen.gate_results?.ok === false;
  const previewSrc = `/api/template-engine/preview/${gen.id}/${page}`;

  async function deploy() {
    setConfirming(false);
    setDeploying(true);
    try {
      const res = await fetch(`/api/template-engine/generations/${gen.id}/deploy`, { method: "POST" });
      if (!res.ok) {
        toast({ kind: "error", title: "Deploy failed", body: (await res.json().catch(() => ({}))).error ?? "DirectAdmin deploy failed" });
        return;
      }
      const { url, provisioning } = await res.json();
      toast({
        kind: "success",
        title: "Site deployed",
        body: provisioning
          ? `${url} — provisioning, usually live within a minute or two.`
          : `${url} — saved to the lead's website link.`,
      });
      onChanged();
    } catch {
      toast({ kind: "error", title: "Deploy failed", body: "Network error — please try again." });
    } finally {
      setDeploying(false);
    }
  }

  async function reopen() {
    setReopening(true);
    try {
      const res = await fetch(`/api/template-engine/generations/${gen.id}/reopen`, { method: "POST" });
      if (!res.ok) {
        toast({ kind: "error", title: "Could not reopen", body: (await res.json().catch(() => ({}))).error ?? "Try again" });
        return;
      }
      toast({ kind: "info", title: "Run reopened", body: "Edit content or images, then build again." });
      onChanged(); // status is curating now — the shell's rail follows to step 3
    } catch {
      toast({ kind: "error", title: "Could not reopen", body: "Network error — please try again." });
    } finally {
      setReopening(false);
    }
  }

  if (!ready) {
    return <div className="rounded-lg border border-border bg-surface p-5 text-sm text-text-muted">The review opens when the build finishes.</div>;
  }

  return (
    <div className="space-y-4">
      {/* The site below was built before the content or images last changed. */}
      <StaleNotice gen={gen} step="build" onDone={onChanged} />

      {/* Gate summary + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {gen.gate_results ? (
          <p className={cn("inline-flex items-center gap-1.5 text-sm font-medium", gen.gate_results.ok ? "text-accent-ink" : "text-dropped-fg")}>
            {gen.gate_results.ok ? <ShieldCheck className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
            {gen.gate_results.ok ? "All verification gates passed" : "Verification gates FAILED — inspect before deploying"}
          </p>
        ) : <span />}
        <div className="flex items-center gap-2">
          <a href={previewSrc} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text">
            <ExternalLink className="h-4 w-4" /> Open preview
          </a>
          <a href={`/api/template-engine/generations/${gen.id}/download`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text">
            <Download className="h-4 w-4" /> Download zip
          </a>
          <RedoButton gen={gen} step="build" onDone={onChanged} label="Rebuild site" />
          {gen.status === "review" ? (
            <button type="button" disabled={reopening || deploying} onClick={reopen}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text disabled:opacity-50">
              {reopening ? <Loader2 className="h-4 w-4 animate-spin" /> : <PencilLine className="h-4 w-4" />}
              Reopen for edits
            </button>
          ) : null}
          {canDeploy ? (
            <div className="flex items-center gap-2">
              {gatesFailed ? (
                <span className="inline-flex items-center gap-1 text-xs text-dropped-fg">
                  <TriangleAlert className="h-3.5 w-3.5" /> Rebuild — verification gates failed
                </span>
              ) : null}
              <button type="button" onClick={() => setConfirming(true)} disabled={deploying || reopening || gatesFailed}
                title={gatesFailed ? "Verification gates failed — rebuild before deploying" : undefined}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                {gen.status === "deployed" ? "Redeploy" : "Deploy"}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {gen.deployed_url ? (
        <p className="inline-flex items-center gap-2 rounded-md border border-ready-fg/20 bg-ready-bg px-3 py-2 text-sm text-ready-fg">
          <Globe className="h-4 w-4" /> Live at <a className="underline" href={gen.deployed_url} target="_blank" rel="noreferrer">{gen.deployed_url}</a>
          <CopyButton value={gen.deployed_url} title="Copy live URL" />— written to the lead's website link.
        </p>
      ) : null}

      {/* Per-page tabs + iframe. Rebuilt pages reference assets relatively, so
          the iframe resolves them under the same preview prefix. */}
      {pages.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-5 text-sm text-text-muted">
          No pages were built for this run — check the Build step's timeline for what happened.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex flex-wrap gap-1 border-b border-border-subtle p-2">
            {pages.map((f) => (
              <button key={f} type="button" onClick={() => setPage(f)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs",
                  f === page ? "bg-accent-soft font-medium text-accent-ink" : "text-text-muted hover:text-text",
                )}>
                {f}
              </button>
            ))}
          </div>
          {/* sandbox WITHOUT allow-same-origin: the preview runs AI-generated
              HTML+JS which must never touch this origin's storage/session. */}
          <iframe key={page} src={previewSrc} title={`Preview ${page}`}
            sandbox="allow-scripts allow-popups allow-forms"
            className="h-[70vh] w-full bg-white" />
        </div>
      )}

      {/* Deploy confirm — modal closes only via its buttons (house rule) */}
      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Deploy this site?">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h3 className="text-sm font-semibold text-text">Deploy this site?</h3>
            <p className="mt-2 text-sm text-text-muted">
              It goes live on a public subdomain and the URL is saved to the lead's website link
              {gen.gate_results && !gen.gate_results.ok ? " — and its verification gates FAILED." : "."}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)}
                className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text">Cancel</button>
              <button type="button" onClick={deploy}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">Deploy</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
