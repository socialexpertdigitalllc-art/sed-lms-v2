"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ChevronDown, ChevronRight, Download, Loader2, Pause, Play, ShieldCheck, X,
} from "lucide-react";
import { PageHeader, Pill } from "@/components/common/Panel";
import { btnPrimary, btnSecondarySm } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { runStatusPill } from "@/lib/site-studio/ui/status";
import { awaitingGate, isTerminal, type StudioRunRow } from "@/lib/site-studio/run/types";
import type { RunContentDoc } from "@/lib/site-studio/run/applyWritten";
import type { TemplateManifest } from "@/lib/site-studio/schema";
import { RunPageCard } from "@/components/site-studio/RunPageCard";
import { RunPreview } from "@/components/site-studio/RunPreview";
import { ThemePanel } from "@/components/site-studio/ThemePanel";

interface TemplateDetail { manifest: TemplateManifest | null; }

/** A best-effort, human-readable timeline built from the run's own `steps`
 *  bookkeeping (prepare/write/images/render/finalize) — there is no separate
 *  events API surfaced to the client in 3b, so this reads directly off the
 *  same row the cockpit already has, rather than adding a new endpoint. */
function timelineEntries(run: StudioRunRow): { label: string; tone: "neutral" | "ready" | "dropped" }[] {
  const entries: { label: string; tone: "neutral" | "ready" | "dropped" }[] = [];
  if (run.steps.prepare) entries.push({ label: `Prepared ${run.steps.prepare.pages} page(s).`, tone: "neutral" });
  if (run.steps.write) {
    const pages = Object.values(run.steps.write.pages);
    const written = pages.filter((p) => p.status === "written").length;
    const failed = pages.filter((p) => p.status === "failed").length;
    entries.push({ label: `Write: ${written}/${pages.length} page(s) written${failed ? `, ${failed} failed` : ""}.`, tone: failed ? "dropped" : "neutral" });
  }
  if (run.steps.images) {
    const slots = Object.values(run.steps.images.slots);
    const sourced = slots.filter((s) => s.candidates.length > 0).length;
    entries.push({ label: `Images: ${sourced}/${slots.length} slot(s) have candidates.`, tone: "neutral" });
  }
  if (run.steps.render) entries.push({ label: `Rendered ${run.steps.render.files} file(s).`, tone: "neutral" });
  if (run.steps.finalize) entries.push({ label: `Finalized: ${run.steps.finalize.zip_bytes} byte zip.`, tone: "ready" });
  if (run.error) entries.push({ label: run.error, tone: "dropped" });
  return entries;
}

export function RunCockpit({ runId }: { runId: string }) {
  const { toast } = useToast();
  const [run, setRun] = useState<StudioRunRow | null>(null);
  const [manifest, setManifest] = useState<TemplateManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTimeline, setShowTimeline] = useState(false);
  const [approving, setApproving] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);

  const drivingRef = useRef(false);
  // Starts false and flips true in the effect BODY (not at ref-init time) —
  // under React 18 Strict Mode's dev mount->cleanup->remount, a `useRef(true)`
  // with only a cleanup setting it false gets stuck permanently false after
  // the first (throwaway) mount/unmount pass, which silently kills both the
  // drive loop's `while (mountedRef.current && ...)` and the 3s poll's
  // `if (row && mountedRef.current)` for the rest of the component's life —
  // the run looks frozen in dev while working fine in prod (no Strict Mode
  // double-invoke there). Setting it true in the body means the SECOND
  // (real) mount flips it back on before anything reads it.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadRun = useCallback(async (): Promise<StudioRunRow | null> => {
    try {
      const res = await fetch(`/api/site-studio/runs/${runId}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load this run");
      return body.run as StudioRunRow;
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load this run" });
      return null;
    }
  }, [runId, toast]);

  const loadManifest = useCallback(async (templateId: string) => {
    try {
      const res = await fetch(`/api/site-studio/templates/${templateId}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load the template");
      setManifest((body.template as TemplateDetail).manifest ?? null);
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load the template" });
    }
  }, [toast]);

  /**
   * Drives `POST /step` in a loop for exactly as long as there is real work
   * to do. The loop condition is re-checked at the TOP of every iteration
   * against the freshest row, so the moment a step's response parks the run
   * at Gate 1 (`reviewing`), pauses it, or lands it on a terminal status, the
   * next iteration simply never starts — no extra call is made "to notice"
   * that. `drivingRef` makes re-entrant calls (poll tick landing while a
   * drive is already in flight, or an approve/resume firing one) a no-op
   * instead of a second concurrent loop. The only genuine spin risk is
   * `claimed:false` (another tab or the advancer cron won the race for this
   * exact step) — that's throttled with an explicit delay rather than
   * retried immediately, so two cockpits (or a cockpit and the advancer)
   * never hammer each other.
   */
  const driveStep = useCallback(async (initial: StudioRunRow) => {
    if (drivingRef.current) return;
    drivingRef.current = true;
    try {
      let current = initial;
      while (mountedRef.current && !current.paused && !awaitingGate(current.status) && !isTerminal(current.status)) {
        let res: Response;
        try {
          res = await fetch(`/api/site-studio/runs/${runId}/step`, { method: "POST" });
        } catch (e) {
          toast({ kind: "error", title: e instanceof Error ? e.message : "Step failed" });
          return;
        }
        const body = await res.json().catch(() => ({}));
        if (!mountedRef.current) return;
        if (!res.ok) {
          toast({ kind: "error", title: body.error ?? "Step failed" });
          return;
        }
        current = body.run as StudioRunRow;
        setRun(current);
        if (body.paused) return; // engine short-circuited on the pause flag
        if (!body.claimed) {
          // Lost the claim race — wait a beat rather than spin against
          // whoever currently holds it, then re-check with fresh state.
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        if (body.done) return; // reached the gate, or already terminal
        // else: real progress happened this call — loop straight back.
      }
    } finally {
      drivingRef.current = false;
    }
  }, [runId, toast]);

  const applyRun = useCallback((row: StudioRunRow) => {
    setRun(row);
    void driveStep(row);
  }, [driveStep]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const row = await loadRun();
      if (cancelled || !row) { setLoading(false); return; }
      setRun(row);
      await loadManifest(row.template_id);
      setLoading(false);
      void driveStep(row);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Fallback poll — a second tab or the advancer cron can move this run
  // forward independently; this is what picks that up here.
  useEffect(() => {
    const id = setInterval(() => {
      void loadRun().then((row) => { if (row && mountedRef.current) applyRun(row); });
    }, 3000);
    return () => clearInterval(id);
  }, [loadRun, applyRun]);

  // A 409 here means the row changed under us (another edit or an image
  // pick landed first, see content/route.ts's CAS comment) — the operator's
  // draft is now against a stale doc, so refetch the real row and toast the
  // server's message verbatim rather than leaving the stale draft on screen.
  // Returns normally (doesn't throw) so the caller's editor closes against
  // the refreshed state instead of getting stuck open on a failed save.
  async function handleStaleWrite(body: { error?: string }) {
    toast({
      kind: "error",
      title: body.error ?? "This run changed while you were editing — your view has been refreshed, please redo that change",
    });
    const fresh = await loadRun();
    if (fresh) setRun(fresh);
  }

  async function editSlot(pageIndex: number, slotId: string, value: string) {
    const res = await fetch(`/api/site-studio/runs/${runId}/content`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_index: pageIndex, slots: { [slotId]: value } }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) { await handleStaleWrite(body); return; }
    if (!res.ok) {
      toast({ kind: "error", title: body.error ?? "Edit rejected" });
      throw new Error(body.error ?? "Edit rejected");
    }
    setRun(body.run);
  }

  async function editTitle(pageIndex: number, value: string) {
    const res = await fetch(`/api/site-studio/runs/${runId}/content`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_index: pageIndex, title: value }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) { await handleStaleWrite(body); return; }
    if (!res.ok) {
      toast({ kind: "error", title: body.error ?? "Edit rejected" });
      throw new Error(body.error ?? "Edit rejected");
    }
    setRun(body.run);
  }

  async function rerollSlot(pageIndex: number, slotId: string, includeOperator: boolean) {
    const res = await fetch(`/api/site-studio/runs/${runId}/reroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_index: pageIndex, slot_id: slotId, include_operator: includeOperator }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast({ kind: "error", title: body.error ?? "Re-roll failed" }); return; }
    toast({ kind: "success", title: "Re-rolled" });
    setRun(body.run);
  }

  async function rerollPage(pageIndex: number, includeOperator: boolean) {
    const res = await fetch(`/api/site-studio/runs/${runId}/reroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_index: pageIndex, include_operator: includeOperator }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast({ kind: "error", title: body.error ?? "Re-roll failed" }); return; }
    toast({ kind: "success", title: "Page re-rolled" });
    setRun(body.run);
  }

  async function retryWrite() {
    const res = await fetch(`/api/site-studio/runs/${runId}/step`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast({ kind: "error", title: body.error ?? "Retry failed" }); return; }
    applyRun(body.run);
  }

  async function approve() {
    setApproving(true);
    try {
      const res = await fetch(`/api/site-studio/runs/${runId}/approve`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ kind: "error", title: body.error ?? "Could not approve" }); return; }
      toast({ kind: "success", title: "Approved — rendering will start" });
      applyRun(body.run);
    } finally {
      setApproving(false);
    }
  }

  async function control(action: "pause" | "resume" | "cancel") {
    setControlBusy(true);
    try {
      const res = await fetch(`/api/site-studio/runs/${runId}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ kind: "error", title: body.error ?? `Could not ${action}` }); return; }
      applyRun(body.run);
    } finally {
      setControlBusy(false);
    }
  }

  async function download() {
    const res = await fetch(`/api/site-studio/runs/${runId}/download`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast({ kind: "error", title: body.error ?? "Could not create a download link" }); return; }
    window.open(body.url as string, "_blank", "noopener,noreferrer");
  }

  const pageDefsById = useMemo(() => {
    const map = new Map<string, TemplateManifest["pages"][number]>();
    for (const p of manifest?.pages ?? []) map.set(p.id, p);
    return map;
  }, [manifest]);

  const timeline = useMemo(() => (run ? timelineEntries(run) : []), [run]);

  const emptySlotCount = useMemo(() => {
    if (!run?.content_doc) return 0;
    let count = 0;
    for (const page of run.content_doc.pages) {
      for (const [id, value] of Object.entries(page.slots)) {
        if (id.endsWith("_alt")) continue;
        if (!value || value.trim() === "") count++;
      }
    }
    return count;
  }, [run]);

  if (loading || !run) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading run…
      </div>
    );
  }

  const pill = runStatusPill(run.status);
  const gate = run.status === "reviewing";
  const doc = run.content_doc as RunContentDoc | null;

  return (
    <div className="space-y-4 pb-24">
      <PageHeader
        title="Generation run"
        description={run.error ? undefined : "Live progress, Gate 1 review, and download."}
      />

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
        <Pill tone={pill.tone}>{pill.label}</Pill>
        {run.paused ? <Pill tone="notready">Paused</Pill> : null}
        <div className="ml-auto flex items-center gap-2">
          {!isTerminal(run.status) ? (
            run.paused ? (
              <button className={btnSecondarySm} onClick={() => void control("resume")} disabled={controlBusy}>
                <Play className="h-3.5 w-3.5" /> Resume
              </button>
            ) : (
              <button className={btnSecondarySm} onClick={() => void control("pause")} disabled={controlBusy}>
                <Pause className="h-3.5 w-3.5" /> Pause
              </button>
            )
          ) : null}
          {!isTerminal(run.status) ? (
            <button className={btnSecondarySm} onClick={() => void control("cancel")} disabled={controlBusy}>
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface">
        <button
          type="button"
          className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-text-muted"
          onClick={() => setShowTimeline((v) => !v)}
        >
          {showTimeline ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Event timeline
        </button>
        {showTimeline ? (
          <ul className="space-y-1 border-t border-border p-3 text-xs">
            {timeline.length === 0 ? (
              <li className="text-text-faint">Nothing yet.</li>
            ) : timeline.map((e, i) => (
              <li key={i} className={e.tone === "dropped" ? "text-dropped-fg" : "text-text-muted"}>{e.label}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {run.status === "failed" ? (
        <div className="rounded-lg border border-dropped-bg bg-dropped-bg/40 p-4">
          <p className="flex items-center gap-2 font-medium text-dropped-fg"><AlertTriangle className="h-4 w-4" /> This run failed.</p>
          <p className="mt-1 text-sm text-dropped-fg">{run.error}</p>
          <p className="mt-2 text-xs text-text-muted">Start a new run for this lead — this one cannot be resumed.</p>
        </div>
      ) : null}

      {doc && run.status !== "ready" ? (
        <div className="space-y-3">
          {doc.pages.map((page, index) => (
            <RunPageCard
              key={index}
              index={index}
              page={page}
              pageDef={pageDefsById.get(page.page_id)}
              provenance={doc.provenance?.[index]}
              writeState={run.steps.write?.pages?.[String(index)]}
              gate={gate}
              runFinished={run.status === "rendering" || isTerminal(run.status)}
              runId={runId}
              leadId={run.lead_id}
              clientPhotos={run.client_photos}
              disabled={!gate}
              onEditSlot={(slotId, value) => editSlot(index, slotId, value)}
              onEditTitle={(value) => editTitle(index, value)}
              onRerollSlot={(slotId, includeOperator) => rerollSlot(index, slotId, includeOperator)}
              onRerollPage={(includeOperator) => rerollPage(index, includeOperator)}
              onRetryWrite={retryWrite}
              onImagePicked={applyRun}
            />
          ))}
        </div>
      ) : null}

      {/* Gate 2: the editable preview + live theme replace Gate 1's page
       *  cards once the run is ready — see Task 7. `manifest` gates the
       *  panel too since ThemePanel needs the template's declared roles. */}
      {doc && run.status === "ready" && manifest ? (
        <div className="space-y-4">
          <ThemePanel runId={runId} manifest={manifest} theme={doc.theme} onRunUpdated={applyRun} />
          <RunPreview run={run} onRunUpdated={applyRun} />
        </div>
      ) : null}

      {run.status === "ready" ? (
        <div className="rounded-lg border border-ready-bg bg-ready-bg/30 p-4">
          <p className="mb-2 flex items-center gap-2 font-medium text-ready-fg"><ShieldCheck className="h-4 w-4" /> Ready to download.</p>
          <button className={btnPrimary} onClick={() => void download()}>
            <Download className="h-4 w-4" /> Download site
          </button>
          <p className="mt-2 text-xs text-text-faint">Deploy comes in Phase 4 — for now, download and hand off the zip.</p>
        </div>
      ) : null}

      {gate ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface p-3">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <p className="flex-1 text-xs text-text-muted">
              {emptySlotCount > 0
                ? `${emptySlotCount} slot(s) still look empty — approval is allowed either way; the render step is the hard guard.`
                : "Everything looks filled in."}
            </p>
            <button className={btnPrimary} onClick={() => void approve()} disabled={approving}>
              {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Approve &amp; render
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
