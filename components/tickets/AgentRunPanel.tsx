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
import { composeTicketTask } from "@/lib/site-agent/task";
import { isActiveStatus, type AgentFileChange, type AgentRunStatus, type AgyModel } from "@/lib/site-agent/types";
import { encodePathSegments } from "@/lib/site-builder/preview";
import { cn } from "@/lib/utils";

/** The run as the panel sees it — the ticket list rows carry a SUBSET of the
 *  columns (no output_tail, no v2 scope/task/model), the detail poll carries
 *  them all. */
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
  /** v2: null/absent = whole ticket. */
  item_ids?: string[] | null;
  /** v2: the operator-edited task, sent verbatim to the worker. */
  task_text?: string | null;
  /** v2: agy model id; null = Antigravity default. */
  model?: string | null;
}

/** A ticket change item as TicketDetail holds it — only what the dialog needs. */
export interface AgentRunPanelItem {
  id: string;
  body: string;
  is_done: boolean;
}

/** The pre-send dialog's state — non-null while it is open. `selected` is
 *  kept in item order so the composed checklist and the POSTed item_ids read
 *  the way the ticket does. `edited` is the operator's prompt lock: once they
 *  type, selection changes stop re-composing the text. */
interface DialogState {
  selected: string[];
  task: string;
  edited: boolean;
  /** "" = Antigravity default (no model sent). */
  model: string;
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

/** The worker's own fallback for a title-less ticket (lib/site-agent/worker.ts). */
const UNTITLED = "Untitled change request";

const labelCls = "mb-1 block text-xs font-medium text-text-muted";
const fieldCls =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-accent";

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

/** v2: what this run was asked to do — the chosen model (label when the
 *  worker still publishes that id, else the raw id) and, for a scoped ticket
 *  run, how many of the ticket's changes it covers. Nothing to say → nothing
 *  rendered, so a v1 run's header looks exactly as before. */
function RunMeta({ run, models, totalItems }: { run: PanelRun; models: AgyModel[]; totalItems: number | null }) {
  const modelLabel = run.model ? models.find((m) => m.id === run.model)?.label ?? run.model : null;
  const scope =
    totalItems !== null && Array.isArray(run.item_ids)
      ? `Scope: ${run.item_ids.length} of ${totalItems} changes`
      : null;
  if (!modelLabel && !scope) return null;
  return (
    <p data-testid="sa-run-meta" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-faint">
      {modelLabel ? <span>Model: {modelLabel}</span> : null}
      {scope ? <span>{scope}</span> : null}
    </p>
  );
}

/**
 * The "AI developer" panel — on a TICKET (Send to AI creates a run for the
 * ticket's site) or, v2, on a LEAD ("AI edit site": a ticketless direct
 * change). Either way the panel follows the run live (2s poll while
 * queued/running/deploying, 10s while review/failed, none once terminal) and
 * gates every change behind a human review — diff per file, sandboxed
 * preview, then Approve & Deploy / Request changes / Discard.
 *
 * v2: Send opens a pre-send dialog first — which undone items to include,
 * the task text (prefilled from the selection, editable), and the model from
 * the worker's live-published list. Exactly one of `ticketId` / `leadId` is
 * given; lead mode has no items section, requires the task text, and gates
 * only on `canResolve` + a website link (no ticket status).
 *
 * All routes it talks to are built and tested elsewhere; this component only
 * renders their contract. Fetch errors toast and never crash the page.
 *
 * Without `canViewAgentRuns` (tickets.resolve or studio.manage, resolved by
 * the server page) the panel renders nothing and fetches nothing — its routes
 * 403 everyone else, and sales/management viewers must not eat that toast.
 */
export function AgentRunPanel({
  ticketId,
  leadId,
  ticketTitle,
  items,
  websiteLink,
  canViewAgentRuns,
  canResolve,
  ticketStatus,
}: {
  /** Ticket mode — exactly one of ticketId / leadId. */
  ticketId?: string;
  /** Lead mode (ticketless runs) — exactly one of ticketId / leadId. */
  leadId?: string;
  /** Ticket mode: the title the default task is composed from. */
  ticketTitle?: string;
  /** Ticket mode: the ticket's items — the dialog offers the undone ones. */
  items?: AgentRunPanelItem[];
  websiteLink: string | null;
  canViewAgentRuns: boolean;
  canResolve: boolean;
  /** Ticket mode: Send is offered only while Assigned / In Progress. */
  ticketStatus?: string;
}) {
  const { toast } = useToast();
  const leadMode = !ticketId;
  const listUrl = ticketId
    ? `/api/tickets/${ticketId}/agent-runs`
    : leadId
      ? `/api/leads/${leadId}/agent-runs`
      : null;

  const [loaded, setLoaded] = useState(false);
  const [runs, setRuns] = useState<PanelRun[]>([]);
  const [run, setRun] = useState<PanelRun | null>(null);
  const [workerOnline, setWorkerOnline] = useState(true);
  const [models, setModels] = useState<AgyModel[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
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

  // The owner's runs, newest first. The newest still-active run is the
  // panel's focus; failing that, the newest overall. The list response also
  // carries the model catalogue — the dialog opens before any run exists.
  useEffect(() => {
    if (!websiteLink || !canViewAgentRuns || !listUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(listUrl);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Could not load the AI runs");
        if (cancelled) return;
        const list = (body.runs ?? []) as PanelRun[];
        setRuns(list);
        setRun(list.find((r) => isActiveStatus(r.status)) ?? list[0] ?? null);
        if (Array.isArray(body.models)) setModels(body.models as AgyModel[]);
      } catch (e) {
        if (!cancelled) toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load the AI runs" });
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [listUrl, websiteLink, canViewAgentRuns, toast]);

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
        if (Array.isArray(body.models)) setModels(body.models as AgyModel[]);
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

  /** The dialog only ever offers UNDONE items — done ones are neither shown
   *  nor accepted by the create route. */
  const undone = useMemo(() => (items ?? []).filter((i) => !i.is_done), [items]);
  const title = ticketTitle?.trim() || UNTITLED;
  /** The default task for a selection — exactly what the worker composes. */
  const compose = (selected: string[]) =>
    composeTicketTask(title, undone.filter((i) => selected.includes(i.id)).map((i) => i.body));
  /** A seeded model id is only preselected while the worker still publishes it. */
  const knownModel = (id: string | null | undefined) => (id && models.some((m) => m.id === id) ? id : "");

  /** One review round = one result-zip version; the diff cache and both
   *  selections hang off this key, so a revise round starts clean while the
   *  stale entries are simply never read again. */
  const versionKey = run ? `${run.id}:${run.updated_at}` : "";
  const openFile = picked && picked.key === versionKey ? picked.path : null;
  const selectedPage =
    pickedPage && pickedPage.key === versionKey && htmlPages.includes(pickedPage.page)
      ? pickedPage.page
      : "index.html";

  /**
   * Open the pre-send dialog. Fresh: every undone item selected, the task
   * composed from them, the default model. Seeded from a failed run (Try
   * again): its scope narrowed to what is STILL undone, its task text (and
   * the edited lock with it), its model if still published — a retry IS a
   * new run, and after "quota exhausted" switching model is the whole point.
   */
  function openDialog(seed: PanelRun | null) {
    if (leadMode) {
      setDialog({ selected: [], task: seed?.task_text ?? "", edited: false, model: knownModel(seed?.model) });
      return;
    }
    const seedIds = seed?.item_ids;
    const selected =
      Array.isArray(seedIds) && seedIds.length
        ? undone.filter((i) => seedIds.includes(i.id)).map((i) => i.id)
        : undone.map((i) => i.id);
    const custom = seed?.task_text?.trim() ? seed.task_text : null;
    setDialog({
      selected,
      task: custom ?? compose(selected),
      edited: custom !== null,
      model: knownModel(seed?.model),
    });
  }

  function toggleItem(id: string) {
    setDialog((d) => {
      if (!d) return d;
      const selected = d.selected.includes(id)
        ? d.selected.filter((x) => x !== id)
        : undone.filter((i) => i.id === id || d.selected.includes(i.id)).map((i) => i.id);
      return { ...d, selected, task: d.edited ? d.task : compose(selected) };
    });
  }

  /**
   * The dialog's Send. Body normalization is the create routes' contract:
   * item_ids only for a real SUBSET of the undone items (all of them = whole
   * ticket = no key), task_text only once the operator edited it (lead mode:
   * always — there is no ticket to compose from), model only when not the
   * default. A failed create toasts and leaves the dialog open to fix.
   */
  async function send() {
    if (!dialog || !listUrl) return;
    const body: Record<string, unknown> = {};
    if (leadMode) {
      body.task_text = dialog.task;
    } else {
      if (undone.length > 0 && dialog.selected.length === 0) return;
      if (undone.length > 0 && dialog.selected.length !== undone.length) body.item_ids = dialog.selected;
      if (dialog.edited) body.task_text = dialog.task;
    }
    if (dialog.model) body.model = dialog.model;
    setSending(true);
    try {
      const res = await fetch(listUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: resBody.error ?? "Could not start the AI run" });
        return;
      }
      const created = resBody.run as PanelRun;
      setDialog(null);
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

  if (!websiteLink || !listUrl) return null;
  if (!canViewAgentRuns) return null;
  if (!loaded) return null;

  const busy = sending || approving || discarding || revising;
  // The create routes' own gates, mirrored: a ticket only takes a run while
  // someone is actually working it; a lead needs only the permission.
  const canSend = canResolve && (leadMode || ticketStatus === "Assigned" || ticketStatus === "In Progress");
  // Terminal states offer a fresh send: clients ask for changes again and
  // again, so a deployed run must never dead-end the panel.
  const showSend = canSend && (!run || run.status === "discarded" || run.status === "deployed");
  if (!run && !canSend) return null;

  const past = runs.filter((r) => r.id !== run?.id);
  const previewRoot = run ? `/api/site-agent/runs/${run.id}/preview/` : "";
  const previewSrc = selectedPage === "index.html" ? previewRoot : `${previewRoot}${encodePathSegments(selectedPage)}`;
  const deployingStale =
    run?.status === "deploying" && now - new Date(run.updated_at).getTime() > DEPLOYING_STALE_MS;
  const openDiffState = openFile ? fileDiffs[`${versionKey}:${openFile}`] : undefined;
  const totalItems = leadMode ? null : (items ?? []).length;

  const dialogNoItems = !leadMode && undone.length > 0 && dialog?.selected.length === 0;
  const canDialogSend = !!dialog && !busy && !!dialog.task.trim() && !dialogNoItems;

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
        onClick={() => openDialog(null)}
        disabled={busy}
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {leadMode ? "AI edit site" : "Send to AI"}
      </button>
      <p className="text-xs text-text-muted">
        {leadMode
          ? "The AI developer edits this site from your description — you review every change before it goes live."
          : "The AI developer edits the site from this ticket — you review every change before it goes live."}
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
          <RunMeta run={run} models={models} totalItems={totalItems} />
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
          <RunMeta run={run} models={models} totalItems={totalItems} />
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
                <label htmlFor="sa-instructions" className={labelCls}>
                  Request changes — sent back to the same AI conversation
                </label>
                <textarea
                  id="sa-instructions"
                  rows={2}
                  className={fieldCls}
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
                {leadMode ? " site" : " ticket"} for a new run.
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
            {leadMode
              ? "To roll back, use the snapshots on the deployments board."
              : "To roll back, use Website updates → snapshots on this ticket."}
          </p>
        </div>
      ) : null}
      {run?.status === "deployed" ? sendBlock : null}

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
              onClick={() => openDialog(run)}
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

      {/* v2 — the pre-send dialog. Same shell as the ticket screen's own
          confirm dialog (fixed overlay, bordered surface card). Rendered only
          while open so its textarea/select never collide with the review
          pane's own textbox/combobox. */}
      {dialog ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={leadMode ? "AI edit site" : "Send to AI"}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h3 className="text-sm font-semibold text-text">{leadMode ? "AI edit site" : "Send to AI"}</h3>
            <p className="mt-1 text-sm text-text-muted">
              {leadMode
                ? "Describe the change for this site. You review every edit before it goes live."
                : "Choose what to send, adjust the task if needed, and pick a model."}
            </p>

            {!leadMode && undone.length > 0 ? (
              <fieldset className="mt-4">
                <legend className={labelCls}>Changes to include</legend>
                <div className="space-y-0.5">
                  {undone.map((item) => (
                    <label
                      key={item.id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2"
                    >
                      <input
                        type="checkbox"
                        data-testid={`sa-item-${item.id}`}
                        className="accent-accent mt-0.5 h-4 w-4 shrink-0"
                        checked={dialog.selected.includes(item.id)}
                        onChange={() => toggleItem(item.id)}
                      />
                      <span className="text-text">{item.body}</span>
                    </label>
                  ))}
                </div>
                {dialogNoItems ? <p className="mt-1 text-xs text-dropped-fg">Select at least one change.</p> : null}
              </fieldset>
            ) : null}

            <div className="mt-4">
              <label htmlFor="sa-task" className={labelCls}>
                Task for the AI
              </label>
              <textarea
                id="sa-task"
                data-testid="sa-task"
                rows={leadMode ? 5 : 6}
                className={fieldCls}
                value={dialog.task}
                onChange={(e) => {
                  const task = e.target.value;
                  setDialog((d) => (d ? { ...d, task, edited: true } : d));
                }}
                placeholder={leadMode ? "Describe the change you want on this site…" : undefined}
              />
              {!leadMode ? (
                <p className="mt-1 text-xs text-text-faint">
                  {dialog.edited
                    ? "Edited — sent to the AI exactly as written."
                    : "Composed from the selected changes — edit it freely; your text is then sent as written."}
                </p>
              ) : null}
            </div>

            <div className="mt-4">
              <label htmlFor="sa-model" className={labelCls}>
                Model
              </label>
              <select
                id="sa-model"
                data-testid="sa-model"
                className={fieldCls}
                value={dialog.model}
                onChange={(e) => {
                  const model = e.target.value;
                  setDialog((d) => (d ? { ...d, model } : d));
                }}
              >
                <option value="">Antigravity default</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              {models.length === 0 ? (
                <p className="mt-1 text-xs text-text-faint">Model list appears once the worker publishes it.</p>
              ) : null}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                data-testid="sa-dialog-cancel"
                onClick={() => setDialog(null)}
                disabled={sending}
                className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="sa-dialog-send"
                onClick={() => void send()}
                disabled={!canDialogSend}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
