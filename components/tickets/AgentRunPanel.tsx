"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  StopCircle,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { Pill, type PillTone } from "@/components/common/Panel";
import { btnGhostSm, btnPrimary, btnSecondarySm } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { formatDateTime } from "@/lib/leads/format";
import { lineDiff, type DiffOp } from "@/lib/site-agent/diff";
import { isActiveStatus, type AgentFileChange, type AgentRunStatus } from "@/lib/site-agent/types";
import { encodePathSegments } from "@/lib/site-builder/preview";
import { cn } from "@/lib/utils";

/** The run as the panel sees it — the ticket list rows carry a SUBSET of the
 *  columns (no output_tail), the detail poll carries them all. */
interface PanelRun {
  id: string;
  status: AgentRunStatus;
  site_host: string;
  files: Record<string, AgentFileChange> | null;
  output_tail?: string | null;
  summary: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

type FileDiff =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "binary"; bytes: number }
  | { state: "text"; ops: DiffOp[] };

const STATUS_PILL: Record<AgentRunStatus, { tone: PillTone; label: string }> = {
  queued: { tone: "neutral", label: "Queued" },
  running: { tone: "accent", label: "Running" },
  review: { tone: "notready", label: "Awaiting review" },
  deploying: { tone: "accent", label: "Deploying" },
  deployed: { tone: "ready", label: "Deployed" },
  failed: { tone: "dropped", label: "Failed" },
  discarded: { tone: "neutral", label: "Discarded" },
};

const ACTION_TONE: Record<AgentFileChange["action"], PillTone> = {
  edit: "accent",
  create: "ready",
  delete: "dropped",
};

/** Mirrors the discard route's wedged-approve escape hatch: past this, no
 *  deploy is still live (double the approve route's maxDuration) and the run
 *  becomes stoppable again. */
const DEPLOYING_STALE_MS = 10 * 60_000;

function kb(bytes: number): string {
  return `${Math.max(0.1, Math.round((bytes / 1024) * 10) / 10).toFixed(1)} KB`;
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/** The live output tail, pinned to its newest line on every update — its own
 *  component so the autoscroll ref/effect live beside the one element they
 *  serve (same shape as BuilderRun's LiveTail). */
function Tail({ tail }: { tail: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tail]);
  return (
    <pre
      ref={ref}
      data-testid="sa-tail"
      className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-2 p-2 font-mono text-[11px] leading-relaxed text-text-muted"
    >
      {tail}
    </pre>
  );
}

/**
 * The ticket screen's "AI developer" panel: Send to AI creates an agent run
 * for this ticket's site, the panel then follows it live (2s poll while
 * queued/running/deploying, 10s while review/failed, none once terminal) and
 * gates every change behind a human review — diff per file, sandboxed
 * preview, then Approve & Deploy / Request changes / Discard.
 *
 * All routes it talks to are built and tested elsewhere; this component only
 * renders their contract. Fetch errors toast and never crash the ticket page.
 *
 * Without `canViewAgentRuns` (tickets.resolve or studio.manage, resolved by
 * the server page) the panel renders nothing and fetches nothing — its routes
 * 403 everyone else, and sales/management viewers must not eat that toast.
 */
export function AgentRunPanel({
  ticketId,
  websiteLink,
  canViewAgentRuns,
  canResolve,
  ticketStatus,
}: {
  ticketId: string;
  websiteLink: string | null;
  canViewAgentRuns: boolean;
  canResolve: boolean;
  ticketStatus: string;
}) {
  const { toast } = useToast();
  const [loaded, setLoaded] = useState(false);
  const [runs, setRuns] = useState<PanelRun[]>([]);
  const [run, setRun] = useState<PanelRun | null>(null);
  const [workerOnline, setWorkerOnline] = useState(true);
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [revising, setRevising] = useState(false);
  const [instructions, setInstructions] = useState("");
  // Diff/preview selections are KEYED to the run version they were made on
  // and IGNORED — never cleared by an effect — once a revise round moves
  // updated_at: the same derived-not-stored rule as BuilderRun's selectedFile.
  const [picked, setPicked] = useState<{ key: string; path: string } | null>(null);
  const [pickedPage, setPickedPage] = useState<{ key: string; page: string } | null>(null);
  const [fileDiffs, setFileDiffs] = useState<Record<string, FileDiff>>({});

  // The ticket's runs, newest first. The newest still-active run is the
  // panel's focus; failing that, the newest overall.
  useEffect(() => {
    if (!websiteLink || !canViewAgentRuns) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tickets/${ticketId}/agent-runs`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Could not load the AI runs");
        if (cancelled) return;
        const list = (body.runs ?? []) as PanelRun[];
        setRuns(list);
        setRun(list.find((r) => isActiveStatus(r.status)) ?? list[0] ?? null);
      } catch (e) {
        if (!cancelled) toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load the AI runs" });
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [ticketId, websiteLink, canViewAgentRuns, toast]);

  /**
   * The focus poll. Cadence follows the status — 2s while the worker owes us
   * movement, a lazy 10s on review/failed (only another tab can change those),
   * none once terminal. Keyed on id+cadence so each restart pulls immediately
   * (a status flip refreshes at once instead of waiting a whole interval out),
   * while the fresh row object every tick does NOT restart the effect. The
   * `cancelled` flag makes stale in-flight pulls harmless — critical around
   * approve, where an optimistic flip must not be clobbered by a pull that
   * left before the click.
   */
  const runId = run?.id ?? null;
  const status = run?.status ?? null;
  const pollMs =
    status === "queued" || status === "running" || status === "deploying"
      ? 2000
      : status === "review" || status === "failed"
        ? 10_000
        : null;
  useEffect(() => {
    if (!canViewAgentRuns || !runId || pollMs === null) return;
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await fetch(`/api/site-agent/runs/${runId}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Could not check the AI run");
        if (cancelled || !body.run) return;
        setRun(body.run as PanelRun);
        setWorkerOnline(body.workerOnline !== false);
      } catch (e) {
        if (!cancelled) toast({ kind: "error", title: e instanceof Error ? e.message : "Could not check the AI run" });
      }
    };
    void pull();
    const iv = setInterval(() => void pull(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [canViewAgentRuns, runId, pollMs, toast]);

  // Coarse clock for elapsed-time and the wedged-deploy check — the lint
  // (correctly) forbids Date.now() in render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(iv);
  }, []);

  const htmlPages = useMemo(() => {
    const pages = new Set<string>(["index.html"]);
    for (const [f, chg] of Object.entries(run?.files ?? {})) {
      // A DELETED page is gone from the result zip — offering it would only
      // 404 inside the preview iframe.
      if (/\.html?$/i.test(f) && chg.action !== "delete") pages.add(f);
    }
    return [...pages].sort();
  }, [run?.files]);

  const fileEntries = useMemo(
    () => Object.entries(run?.files ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    [run?.files],
  );

  /** One review round = one result-zip version; the diff cache and both
   *  selections hang off this key, so a revise round starts clean while the
   *  stale entries are simply never read again. */
  const versionKey = run ? `${run.id}:${run.updated_at}` : "";
  const openFile = picked && picked.key === versionKey ? picked.path : null;
  const selectedPage =
    pickedPage && pickedPage.key === versionKey && htmlPages.includes(pickedPage.page)
      ? pickedPage.page
      : "index.html";

  /** Send to AI — also the failed run's Try again (a retry IS a new run). */
  async function send() {
    setSending(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/agent-runs`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Could not start the AI run" });
        return;
      }
      const created = body.run as PanelRun;
      setRuns((prev) => [created, ...prev]);
      setWorkerOnline(true); // until the first poll says otherwise
      setRun(created);
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not start the AI run" });
    } finally {
      setSending(false);
    }
  }

  async function discard() {
    if (!run) return;
    const ask =
      run.status === "review"
        ? "Discard these edits? Nothing has touched the live site, and the result is thrown away."
        : run.status === "deploying"
          ? "This deploy has been stuck for a while — discard the run? If the deploy actually finished, the site is already updated."
          : "Stop this AI run? The worker abandons it and nothing touches the live site.";
    if (!confirm(ask)) return;
    setDiscarding(true);
    try {
      const res = await fetch(`/api/site-agent/runs/${run.id}/discard`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Could not stop this run" });
        return;
      }
      setRun((r) => (r ? { ...r, status: "discarded" } : r));
      setRuns((prev) => prev.map((r) => (r.id === run.id ? { ...r, status: "discarded" } : r)));
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not stop this run" });
    } finally {
      setDiscarding(false);
    }
  }

  async function approve() {
    if (!run) return;
    if (!confirm(`Deploy these changes to ${run.site_host}? A snapshot is taken first.`)) return;
    setApproving(true);
    // Optimistic flip: the approve POST deploys in-band (minutes at worst),
    // and the 2s "deploying" cadence keeps the screen honest meanwhile. The
    // fresh updated_at matters — a stale one would offer the wedged-deploy
    // Stop button on a deploy that only just started.
    setRun((r) => (r ? { ...r, status: "deploying", updated_at: new Date().toISOString() } : r));
    try {
      const res = await fetch(`/api/site-agent/runs/${run.id}/approve`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Deploy failed" });
        // The route rolled the row back to review with the error on it — the
        // restarted poll's immediate pull fetches the truth.
        setRun((r) => (r ? { ...r, status: "review" } : r));
        return;
      }
      toast({ kind: "success", title: `Deployed — ${body.url ?? `https://${run.site_host}`}` });
      setRun((r) => (r ? { ...r, status: "deployed", error: null } : r));
      setRuns((prev) => prev.map((r) => (r.id === run.id ? { ...r, status: "deployed" } : r)));
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Deploy failed" });
      setRun((r) => (r ? { ...r, status: "review" } : r));
    } finally {
      setApproving(false);
    }
  }

  async function revise() {
    if (!run) return;
    const text = instructions.trim();
    if (!text) return;
    setRevising(true);
    try {
      const res = await fetch(`/api/site-agent/runs/${run.id}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Could not send the changes back" });
        return;
      }
      setInstructions("");
      setRun((r) => (r ? { ...r, status: "queued" } : r));
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not send the changes back" });
    } finally {
      setRevising(false);
    }
  }

  async function openDiff(path: string) {
    if (!run) return;
    if (openFile === path) {
      setPicked(null);
      return;
    }
    const cacheKey = `${versionKey}:${path}`;
    setPicked({ key: versionKey, path });
    if (fileDiffs[cacheKey]) return;
    setFileDiffs((prev) => ({ ...prev, [cacheKey]: { state: "loading" } }));
    try {
      const res = await fetch(`/api/site-agent/runs/${run.id}/files/${encodePathSegments(path)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load this file");
      setFileDiffs((prev) => ({
        ...prev,
        [cacheKey]: body.binary
          ? { state: "binary", bytes: (body.afterBytes ?? body.beforeBytes ?? 0) as number }
          : { state: "text", ops: lineDiff(body.before ?? null, body.after ?? null) },
      }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not load this file";
      setFileDiffs((prev) => ({ ...prev, [cacheKey]: { state: "error", message } }));
      toast({ kind: "error", title: message });
    }
  }

  if (!websiteLink) return null;
  if (!canViewAgentRuns) return null;
  if (!loaded) return null;

  const busy = sending || approving || discarding || revising;
  // The create route's own gate, mirrored: tickets only take a run while
  // someone is actually working them.
  const canSend = canResolve && (ticketStatus === "Assigned" || ticketStatus === "In Progress");
  const showSend = canSend && (!run || run.status === "discarded");
  if (!run && !canSend) return null;

  const past = runs.filter((r) => r.id !== run?.id);
  const previewRoot = run ? `/api/site-agent/runs/${run.id}/preview/` : "";
  const previewSrc = selectedPage === "index.html" ? previewRoot : `${previewRoot}${encodePathSegments(selectedPage)}`;
  const deployingStale =
    run?.status === "deploying" && now - new Date(run.updated_at).getTime() > DEPLOYING_STALE_MS;
  const openDiffState = openFile ? fileDiffs[`${versionKey}:${openFile}`] : undefined;

  const stopBtn =
    canResolve && run ? (
      <button
        type="button"
        data-testid="sa-discard"
        className={btnGhostSm}
        onClick={() => void discard()}
        disabled={busy}
      >
        {discarding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <StopCircle className="h-3.5 w-3.5" />}
        Stop
      </button>
    ) : null;

  const sendBlock = showSend ? (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button
        type="button"
        data-testid="sa-send"
        className={btnPrimary}
        onClick={() => void send()}
        disabled={busy}
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Send to AI
      </button>
      <p className="text-xs text-text-muted">
        The AI developer edits the site from this ticket — you review every change before it goes live.
      </p>
    </div>
  ) : null;

  return (
    <div data-testid="sa-panel" className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text">
          <Bot className="h-4 w-4 text-accent-ink" /> AI developer
        </h2>
        {run ? <Pill tone={STATUS_PILL[run.status].tone}>{STATUS_PILL[run.status].label}</Pill> : null}
      </div>

      {!run ? sendBlock : null}

      {run?.status === "queued" ? (
        <div className="mt-3 space-y-2 text-sm text-text-muted">
          <p className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Waiting for the agent worker…
          </p>
          {!workerOnline ? (
            <p
              data-testid="sa-offline"
              className="rounded-md border border-notready-bg bg-notready-bg/40 px-2.5 py-1.5 text-xs text-notready-fg"
            >
              Agent worker is offline — it runs on the office machine. The run starts when it&rsquo;s back.
            </p>
          ) : null}
          {stopBtn}
        </div>
      ) : null}

      {run?.status === "running" ? (
        <div className="mt-3 space-y-2">
          <p className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> The AI is editing the site…
            <span className="text-xs text-text-faint">
              running for {fmtElapsed(now - new Date(run.created_at).getTime())}
            </span>
          </p>
          <Tail tail={run.output_tail ?? ""} />
          {stopBtn}
        </div>
      ) : null}

      {run?.status === "review" ? (
        <div className="mt-3 space-y-3">
          {run.error ? (
            /* A failed approve rolls the run back to review with `error` set —
               without this card the only trace was a toast long since gone. */
            <div
              data-testid="sa-review-error"
              className="rounded-md border border-dropped-bg bg-dropped-bg/40 p-2 text-xs text-dropped-fg"
            >
              The last deploy attempt failed: {run.error}
            </div>
          ) : null}
          {run.summary ? <p className="text-sm text-text">{run.summary}</p> : null}

          <div data-testid="sa-files" className="space-y-1">
            {fileEntries.map(([path, chg]) => (
              <div key={path} className="rounded-md border border-border">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-surface-2"
                  onClick={() => void openDiff(path)}
                  aria-expanded={openFile === path}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-text">{path}</span>
                  <Pill tone={ACTION_TONE[chg.action]}>{chg.action}</Pill>
                  <span className="shrink-0 text-text-faint">{kb(chg.bytes)}</span>
                </button>
                {openFile === path ? (
                  <div className="border-t border-border p-2">
                    {!openDiffState || openDiffState.state === "loading" ? (
                      <p className="flex items-center gap-2 text-xs text-text-faint">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the diff…
                      </p>
                    ) : openDiffState.state === "error" ? (
                      <p className="text-xs text-dropped-fg">{openDiffState.message}</p>
                    ) : openDiffState.state === "binary" ? (
                      <p className="text-xs text-text-muted">binary file — {kb(openDiffState.bytes)}</p>
                    ) : (
                      <div className="max-h-72 overflow-auto rounded-md bg-surface-2 font-mono text-[11px] leading-relaxed">
                        {openDiffState.ops.map((op, i) => (
                          <div
                            key={i}
                            data-testid={`sa-diff-${op.type}`}
                            className={cn(
                              "flex gap-2 whitespace-pre-wrap break-all px-2",
                              op.type === "add" && "bg-ready-bg/60 text-ready-fg",
                              op.type === "del" && "bg-dropped-bg/60 text-dropped-fg",
                              op.type === "same" && "text-text-faint",
                            )}
                          >
                            <span className="select-none">{op.type === "add" ? "+" : op.type === "del" ? "−" : " "}</span>
                            <span>{op.text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="sa-page" className="text-xs text-text-muted">
                Preview page
              </label>
              <select
                id="sa-page"
                className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
                value={selectedPage}
                onChange={(e) => setPickedPage({ key: versionKey, page: e.target.value })}
              >
                {htmlPages.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <a href={previewRoot} target="_blank" rel="noreferrer" className={cn(btnGhostSm, "ml-auto")}>
                <ExternalLink className="h-3.5 w-3.5" /> Open in a new tab
              </a>
            </div>
            <div className="overflow-hidden rounded-lg border border-border bg-white" style={{ height: "50vh" }}>
              {/* allow-scripts (mirrored by the preview route's CSP sandbox) so
                  the site's runtime-rendered nav/footer work — origin stays
                  opaque, so no cookies and no reach into the LMS. */}
              <iframe
                data-testid="sa-preview-frame"
                title="AI-edited site preview"
                src={previewSrc}
                sandbox="allow-scripts"
                className="h-full w-full"
              />
            </div>
          </div>

          {canResolve ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  data-testid="sa-deploy"
                  className={btnPrimary}
                  onClick={() => void approve()}
                  disabled={busy}
                >
                  {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                  Approve &amp; Deploy
                </button>
                <button
                  type="button"
                  data-testid="sa-discard"
                  className={btnGhostSm}
                  onClick={() => void discard()}
                  disabled={busy}
                >
                  {discarding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Discard
                </button>
              </div>
              <div>
                <label htmlFor="sa-instructions" className="mb-1 block text-xs font-medium text-text-muted">
                  Request changes — sent back to the same AI conversation
                </label>
                <textarea
                  id="sa-instructions"
                  rows={2}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-accent"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="e.g. keep the new phone number, but also update it on the contact page"
                />
                <button
                  type="button"
                  data-testid="sa-revise"
                  className={cn(btnSecondarySm, "mt-1")}
                  onClick={() => void revise()}
                  disabled={busy || !instructions.trim()}
                >
                  {revising ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Request changes
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {run?.status === "deploying" ? (
        <div className="mt-3 space-y-2 text-sm text-text-muted">
          <p className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Deploying to {run.site_host}…
          </p>
          {deployingStale ? (
            <>
              <p className="text-xs text-text-faint">
                This deploy has not moved for over ten minutes — it likely died mid-flight. Stopping it frees the
                ticket for a new run.
              </p>
              {stopBtn}
            </>
          ) : null}
        </div>
      ) : null}

      {run?.status === "deployed" ? (
        <div className="mt-3 rounded-lg border border-ready-bg bg-ready-bg/30 p-3 text-sm">
          <p className="flex flex-wrap items-center gap-2 font-medium text-ready-fg">
            <CheckCircle2 className="h-4 w-4" /> Deployed to
            <a href={`https://${run.site_host}`} target="_blank" rel="noreferrer" className="underline">
              {run.site_host}
            </a>
          </p>
          {run.summary ? <p className="mt-1 text-text-muted">{run.summary}</p> : null}
          <p className="mt-1 text-xs text-text-faint">
            To roll back, use Website updates → snapshots on this ticket.
          </p>
        </div>
      ) : null}

      {run?.status === "failed" ? (
        <div className="mt-3 rounded-lg border border-dropped-bg bg-dropped-bg/40 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-dropped-fg">
            <AlertTriangle className="h-4 w-4" /> This run failed.
          </p>
          <p className="mt-1 whitespace-pre-wrap text-dropped-fg">
            {run.error ?? "The run failed without an error message."}
          </p>
          {canSend ? (
            <button
              type="button"
              data-testid="sa-retry"
              className={cn(btnSecondarySm, "mt-2")}
              onClick={() => void send()}
              disabled={busy}
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      {run?.status === "discarded" ? (
        <>
          <p className="mt-3 text-sm text-text-faint">The last run was discarded — nothing reached the live site.</p>
          {sendBlock}
        </>
      ) : null}

      {past.length > 0 ? (
        <details className="mt-4 border-t border-border pt-2">
          <summary className="cursor-pointer text-xs font-medium text-text-muted hover:text-text">
            Past runs ({past.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {past.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                <Pill tone={STATUS_PILL[r.status].tone}>{STATUS_PILL[r.status].label}</Pill>
                <span className="font-mono">{r.site_host}</span>
                <span className="text-text-faint">{formatDateTime(r.created_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
