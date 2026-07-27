"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck, UploadCloud } from "lucide-react";
import { PageHeader, Pill, type PillTone } from "@/components/common/Panel";
import { btnGhostSm, btnPrimary, btnSecondarySm } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";

type BuilderRunStatus = "queued" | "generating" | "review" | "approved" | "deployed" | "failed";

interface PageState {
  status: "ok" | "failed";
  kind: "existing" | "new";
  name?: string;
  html?: string;
  error?: string;
}

interface BuilderRunRow {
  id: string;
  lead_id: string | null;
  template_id: string;
  status: BuilderRunStatus;
  images: { url: string; purpose: string }[];
  pages: Record<string, PageState>;
  output_path: string | null;
  deployed_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_PILL: Record<BuilderRunStatus, { tone: PillTone; label: string }> = {
  queued: { tone: "neutral", label: "Queued" },
  generating: { tone: "accent", label: "Generating" },
  review: { tone: "notready", label: "Awaiting review" },
  approved: { tone: "accent", label: "Approved" },
  deployed: { tone: "ready", label: "Deployed" },
  failed: { tone: "dropped", label: "Failed" },
};

const IN_FLIGHT = new Set<BuilderRunStatus>(["queued", "generating"]);

/**
 * The run screen: per-page generation state, a page-by-page preview iframe,
 * "Regenerate this page" with an optional instruction, Approve, and Deploy.
 * Failed pages show their error and a Retry. There is no click-to-edit here
 * (unlike Site Studio's `RunPreview`) — a Site Builder page is the AI's own
 * complete, final HTML; the only lever the operator has is regenerating it,
 * optionally steered by a note.
 */
export function BuilderRun({ runId }: { runId: string }) {
  const { toast } = useToast();
  const [run, setRun] = useState<BuilderRunRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [regeneratingFile, setRegeneratingFile] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [deploying, setDeploying] = useState(false);

  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadRun = useCallback(async (): Promise<BuilderRunRow | null> => {
    try {
      const res = await fetch(`/api/site-builder/runs/${runId}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load this run");
      return body.run as BuilderRunRow;
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load this run" });
      return null;
    }
  }, [runId, toast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const row = await loadRun();
      if (cancelled) return;
      setRun(row);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [loadRun]);

  // Poll while the run is still in flight — a fresh POST /runs already
  // resolves generation synchronously before this screen ever mounts, but a
  // run can still be `queued`/`generating` here if the operator arrived via
  // a bookmark or the runs list while another tab's create is still running.
  useEffect(() => {
    if (!run || !IN_FLIGHT.has(run.status)) return;
    const id = setInterval(() => {
      void loadRun().then((row) => { if (row && mountedRef.current) setRun(row); });
    }, 3000);
    return () => clearInterval(id);
  }, [run, loadRun]);

  const pageFiles = useMemo(() => (run ? Object.keys(run.pages ?? {}).sort() : []), [run]);
  const okFiles = useMemo(() => pageFiles.filter((f) => run?.pages[f]?.status === "ok"), [pageFiles, run]);

  /**
   * The previewed page is DERIVED, not stored-then-corrected by an effect.
   *
   * It used to be plain state that an effect filled in on the next tick, which
   * meant the preview and the regenerate control were briefly absent even
   * though the run was fully loaded and had a good page to show. The operator
   * saw a flash of nothing; a test querying right after render saw nothing at
   * all. Deriving removes the gap entirely: the moment a run with a usable
   * page is in hand, there is a selected page.
   *
   * `picked` holds only an EXPLICIT choice (a tab click) and is ignored the
   * moment that page stops being usable — e.g. the operator regenerates it and
   * it comes back failed — so the selection can never point at a page that
   * isn't there.
   */
  const selectedFile = picked && okFiles.includes(picked) ? picked : okFiles[0] ?? null;

  async function regenerate(file: string, withInstruction: boolean) {
    setRegeneratingFile(file);
    try {
      const res = await fetch(`/api/site-builder/runs/${runId}/pages/${encodeURIComponent(file)}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: withInstruction ? instruction.trim() || undefined : undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 502) {
        toast({ kind: "error", title: body.error ?? "Regenerate failed" });
        return;
      }
      if (body.run) setRun(body.run as BuilderRunRow);
      if (res.status === 502) {
        toast({ kind: "error", title: body.error ?? "This page failed to regenerate" });
      } else {
        toast({ kind: "success", title: `"${file}" regenerated` });
        if (withInstruction) setInstruction("");
      }
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Regenerate failed" });
    } finally {
      setRegeneratingFile(null);
    }
  }

  async function approve() {
    setApproving(true);
    try {
      const res = await fetch(`/api/site-builder/runs/${runId}/approve`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ kind: "error", title: body.error ?? "Could not approve" }); return; }
      toast({ kind: "success", title: "Approved" });
      setRun(body.run as BuilderRunRow);
    } finally {
      setApproving(false);
    }
  }

  async function deploy() {
    if (!confirm("This publishes a real client site to a live subdomain. Continue?")) return;
    setDeploying(true);
    try {
      const res = await fetch(`/api/site-builder/runs/${runId}/deploy`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ kind: "error", title: body.error ?? "Deploy failed" }); return; }
      toast({ kind: "success", title: `Deployed to ${body.url}` });
      if (body.clearWarning) toast({ kind: "info", title: body.clearWarning });
      const fresh = await loadRun();
      if (fresh) setRun(fresh);
    } finally {
      setDeploying(false);
    }
  }

  if (loading || !run) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading run…
      </div>
    );
  }

  const pill = STATUS_PILL[run.status];
  const gate = run.status === "review" || run.status === "approved";
  const previewSrc = selectedFile
    ? `/api/site-builder/runs/${runId}/preview?file=${encodeURIComponent(selectedFile)}&v=${encodeURIComponent(run.updated_at)}`
    : null;

  return (
    <div className="space-y-4 pb-10">
      <PageHeader title="Site Builder run" description="Live per-page progress, preview, and deploy." />

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
        <Pill tone={pill.tone}>{pill.label}</Pill>
        {run.deployed_url ? (
          <a href={run.deployed_url} target="_blank" rel="noreferrer" className="text-xs text-accent underline">
            {run.deployed_url}
          </a>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {run.status === "review" ? (
            <button className={btnPrimary} onClick={() => void approve()} disabled={approving}>
              {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Approve
            </button>
          ) : null}
          {run.status === "approved" ? (
            <button className={btnPrimary} onClick={() => void deploy()} disabled={deploying}>
              {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              Deploy
            </button>
          ) : null}
        </div>
      </div>

      {run.status === "failed" ? (
        <div className="rounded-lg border border-dropped-bg bg-dropped-bg/40 p-4">
          <p className="flex items-center gap-2 font-medium text-dropped-fg"><AlertTriangle className="h-4 w-4" /> This run failed.</p>
          <p className="mt-1 text-sm text-dropped-fg">{run.error ?? "Every page failed to generate."}</p>
          <p className="mt-2 text-xs text-text-muted">Start a new site for this lead — this run cannot be resumed.</p>
        </div>
      ) : null}

      {IN_FLIGHT.has(run.status) ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-4 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Generating this site…
        </div>
      ) : null}

      {/* Per-page state */}
      {pageFiles.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {pageFiles.map((file) => {
            const p = run.pages[file];
            const busy = regeneratingFile === file;
            return (
              <div key={file} className="rounded-lg border border-border bg-surface p-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{p.name ?? file}</span>
                  {p.status === "ok" ? (
                    <Pill tone="ready" icon={CheckCircle2}>OK</Pill>
                  ) : (
                    <Pill tone="dropped" icon={AlertTriangle}>Failed</Pill>
                  )}
                </div>
                <p className="truncate text-xs text-text-faint">{file} · {p.kind === "new" ? "new page" : "existing page"}</p>
                {p.status === "failed" ? (
                  <div className="mt-2 rounded-md border border-dropped-bg bg-dropped-bg/30 p-2 text-xs text-dropped-fg">
                    <p className="mb-1">{p.error ?? "Generation failed."}</p>
                    <button className={btnSecondarySm} onClick={() => void regenerate(file, false)} disabled={!gate || busy}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      Retry
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Preview */}
      {okFiles.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2">
            {okFiles.map((file) => (
              <button
                key={file}
                type="button"
                data-testid="sb-page-tab"
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium",
                  file === selectedFile ? "bg-accent text-white" : "bg-surface-2 text-text-muted hover:text-text",
                )}
                onClick={() => setPicked(file)}
              >
                {run.pages[file]?.name ?? file}
              </button>
            ))}
          </div>

          <div
            data-testid="sb-preview-frame"
            className="mx-auto overflow-hidden rounded-lg border border-border bg-white"
            style={{ width: "100%", height: "60vh" }}
          >
            {previewSrc ? (
              <iframe title="Site preview" src={previewSrc} sandbox="" className="h-full w-full" />
            ) : null}
          </div>

          {gate && selectedFile ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="sb-instruction">
                  Regenerate "{selectedFile}" — optional instruction
                </label>
                <input
                  id="sb-instruction"
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-accent"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="e.g. make the hero shorter, use a warmer tone"
                />
              </div>
              <button
                className={btnGhostSm}
                onClick={() => void regenerate(selectedFile, true)}
                disabled={regeneratingFile === selectedFile}
              >
                {regeneratingFile === selectedFile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Regenerate this page
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
