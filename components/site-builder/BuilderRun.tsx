"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { PageHeader, Pill, type PillTone } from "@/components/common/Panel";
import { btnGhostSm, btnPrimary, btnSecondarySm } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { encodePathSegments } from "@/lib/site-builder/preview";
import { cn } from "@/lib/utils";

type BuilderRunStatus = "queued" | "generating" | "review" | "approved" | "deployed" | "failed";

interface PageState {
  status: "pending" | "generating" | "ok" | "failed";
  kind: "existing" | "new" | "component";
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

const KIND_LABEL: Record<PageState["kind"], string> = {
  existing: "existing page",
  new: "new page",
  component: "shared components",
};

/**
 * The run screen: LIVE per-page progress (the generate route persists every
 * page-state change, this screen polls it), a page-by-page preview iframe,
 * open-in-new-tab whole-site preview, zip download, "Regenerate this page"
 * with an optional instruction, Approve, Deploy, and Delete. Failed pages
 * show their error and a Retry.
 *
 * Generation itself is KICKED from here: a freshly-created run arrives
 * "queued", and the first mount that sees it fires `POST .../generate`
 * (idempotent — the route claims the run by CAS, extra kicks 409 silently).
 * That is what makes the progress live: the operator lands here immediately
 * after Create, watching pages finish one by one.
 */
export function BuilderRun({ runId }: { runId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [run, setRun] = useState<BuilderRunRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [regeneratingFile, setRegeneratingFile] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  // Kick generation for a queued run, exactly once per mount. The route is
  // CAS-guarded, so a second tab (or a remount) kicking again just 409s.
  // The fetch resolves only when generation FINISHES — its result is the
  // final run row; until then the poll below keeps the screen live.
  const kickedRef = useRef(false);
  useEffect(() => {
    if (!run || run.status !== "queued" || kickedRef.current) return;
    kickedRef.current = true;
    void fetch(`/api/site-builder/runs/${runId}/generate`, { method: "POST" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.run && mountedRef.current) setRun(body.run as BuilderRunRow);
      })
      .catch(() => {});
  }, [run, runId]);

  // Poll while the run is in flight — this is what makes the per-page
  // progress cards move as the generate route persists each state change.
  useEffect(() => {
    if (!run || !IN_FLIGHT.has(run.status)) return;
    const id = setInterval(() => {
      void loadRun().then((row) => { if (row && mountedRef.current) setRun(row); });
    }, 2000);
    return () => clearInterval(id);
  }, [run, loadRun]);

  const pageFiles = useMemo(() => {
    if (!run) return [];
    // Components first (it generates first), then pages alphabetically.
    return Object.keys(run.pages ?? {}).sort((a, b) => {
      const ka = run.pages[a]?.kind === "component" ? 0 : 1;
      const kb = run.pages[b]?.kind === "component" ? 0 : 1;
      return ka - kb || a.localeCompare(b);
    });
  }, [run]);
  const okFiles = useMemo(
    () =>
      pageFiles.filter(
        (f) => run?.pages[f]?.status === "ok" && run.pages[f].kind !== "component" && /\.html?$/i.test(f),
      ),
    [pageFiles, run],
  );

  const progress = useMemo(() => {
    if (!run) return null;
    const states = pageFiles.map((f) => run.pages[f]);
    const total = states.length;
    if (total === 0) return null;
    const done = states.filter((p) => p.status === "ok").length;
    const failed = states.filter((p) => p.status === "failed").length;
    const generating = pageFiles.filter((f) => run.pages[f].status === "generating");
    return { total, done, failed, generating };
  }, [run, pageFiles]);

  /**
   * The previewed page is DERIVED, not stored-then-corrected by an effect.
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

  async function deleteRun() {
    if (!confirm("Delete this run and its packaged zip? A deployed site stays live — take it down from the Deployments board.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/site-builder/runs/${runId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ kind: "error", title: body.error ?? "Could not delete this run" }); return; }
      toast({ kind: "success", title: "Run deleted" });
      router.push("/ai-tools/site-builder/runs");
    } finally {
      setDeleting(false);
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
  const previewRoot = `/api/site-builder/runs/${runId}/preview/`;
  const previewSrc = selectedFile
    ? `${previewRoot}${encodePathSegments(selectedFile)}?v=${encodeURIComponent(run.updated_at)}`
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
          {okFiles.length > 0 ? (
            <a href={previewRoot} target="_blank" rel="noreferrer" className={btnSecondarySm}>
              <ExternalLink className="h-3.5 w-3.5" /> Open preview
            </a>
          ) : null}
          {run.output_path ? (
            <a href={`/api/site-builder/runs/${runId}/download`} className={btnSecondarySm}>
              <Download className="h-3.5 w-3.5" /> Download zip
            </a>
          ) : null}
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
          <button
            className={btnGhostSm}
            onClick={() => void deleteRun()}
            disabled={deleting || IN_FLIGHT.has(run.status)}
            title="Delete this run"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete
          </button>
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
        <div className="rounded-lg border border-border bg-surface p-4 text-sm text-text-muted">
          <p className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {progress
              ? `Generating — ${progress.done} of ${progress.total} done${progress.failed ? `, ${progress.failed} failed` : ""}.`
              : "Starting this site's generation…"}
          </p>
          {progress && progress.generating.length > 0 ? (
            <p className="mt-1 text-xs text-text-faint">
              Writing now: {progress.generating.map((f) => run.pages[f]?.name ?? f).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Per-page state — live during generation, the review checklist after. */}
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
                  ) : p.status === "failed" ? (
                    <Pill tone="dropped" icon={AlertTriangle}>Failed</Pill>
                  ) : p.status === "generating" ? (
                    <Pill tone="accent" icon={Loader2}>Writing…</Pill>
                  ) : (
                    <Pill tone="neutral" icon={Clock}>Waiting</Pill>
                  )}
                </div>
                <p className="truncate text-xs text-text-faint">{file} · {KIND_LABEL[p.kind]}</p>
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
              // allow-scripts (mirrored by the response's CSP sandbox, see the
              // preview route) so the template's components.js can render the
              // shared header/footer — origin stays opaque, so no LMS reach.
              <iframe title="Site preview" src={previewSrc} sandbox="allow-scripts" className="h-full w-full" />
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
