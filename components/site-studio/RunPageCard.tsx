"use client";

import { useState } from "react";
import { AlertTriangle, Check, ImageIcon, Loader2, Pencil, RefreshCw } from "lucide-react";
import { btnGhostSm, btnSecondarySm } from "@/components/common/buttons";
import { Pill } from "@/components/common/Panel";
import { cn } from "@/lib/utils";
import type { ContentDocPage, PageDef } from "@/lib/site-studio/schema";
import type { PageProvenance } from "@/lib/site-studio/run/applyWritten";
import type { PageWriteState } from "@/lib/site-studio/run/types";
import { ImagePicker } from "./ImagePicker";
import type { StudioRunRow } from "@/lib/site-studio/run/types";

const isOperator = (field?: { written_by: "ai" | "operator" }) => field?.written_by === "operator";

export interface RunPageCardProps {
  index: number;
  page: ContentDocPage;
  pageDef?: PageDef;
  provenance?: PageProvenance;
  writeState?: PageWriteState;
  gate: boolean;
  /** True once the whole run has moved past the gate into render/finalize
   *  (or is done/failed/cancelled) — changes the non-gate copy from "still
   *  writing" to something that doesn't imply work is still in flight. */
  runFinished?: boolean;
  runId: string;
  leadId: string | null;
  clientPhotos: string[];
  disabled: boolean;
  onEditSlot: (slotId: string, value: string) => Promise<void>;
  onEditTitle: (value: string) => Promise<void>;
  onRerollSlot: (slotId: string, includeOperator: boolean) => Promise<void>;
  onRerollPage: (includeOperator: boolean) => Promise<void>;
  onRetryWrite: () => Promise<void>;
  onImagePicked: (run: StudioRunRow) => void;
}

/** One doc-page's write status, and — once the run is at the gate — its
 *  full editable slot surface: click-to-edit text, image pickers, and
 *  per-slot / per-page re-roll (confirming before it would clobber an
 *  operator's own edit). */
export function RunPageCard({
  index, page, pageDef, provenance, writeState, gate, runFinished, runId, leadId, clientPhotos, disabled,
  onEditSlot, onEditTitle, onRerollSlot, onRerollPage, onRetryWrite, onImagePicked,
}: RunPageCardProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(page.title);
  const [editingSlot, setEditingSlot] = useState<string | null>(null);
  const [slotDraft, setSlotDraft] = useState("");
  const [imageSlotOpen, setImageSlotOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const textSlotDefs = (pageDef?.slots ?? []).filter((s) => s.type === "text" && !s.id.endsWith("_alt"));
  const imageSlotDefs = (pageDef?.slots ?? []).filter((s) => s.type === "image");

  const pageHasOperatorFields =
    isOperator(provenance?.title) ||
    Object.values(provenance?.slots ?? {}).some(isOperator) ||
    Object.values(provenance?.repeats ?? {}).some(isOperator);

  async function saveTitle() {
    setBusy(true);
    try {
      await onEditTitle(titleDraft);
      setEditingTitle(false);
    } finally {
      setBusy(false);
    }
  }

  async function saveSlot(slotId: string) {
    setBusy(true);
    try {
      await onEditSlot(slotId, slotDraft);
      setEditingSlot(null);
    } finally {
      setBusy(false);
    }
  }

  async function rerollOneSlot(slotId: string) {
    const owned = isOperator(provenance?.slots?.[slotId]);
    if (owned && !confirm(`"${slotId}" was edited by hand. Overwrite it with a fresh AI re-roll?`)) return;
    setBusy(true);
    try {
      await onRerollSlot(slotId, owned);
    } finally {
      setBusy(false);
    }
  }

  async function rerollWholePage() {
    // Whole-page re-roll never fails on operator fields — it just leaves them
    // alone unless the operator explicitly opts in here. "Cancel" on the
    // confirm still re-rolls, it just keeps the hand-edited fields as they are.
    const includeOperator = pageHasOperatorFields
      ? confirm("This page has edits you made by hand. Overwrite them too?")
      : false;
    setBusy(true);
    try {
      await onRerollPage(includeOperator);
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setRetrying(true);
    try {
      await onRetryWrite();
    } finally {
      setRetrying(false);
    }
  }

  const status = writeState?.status ?? "pending";

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium text-text">{pageDef?.id ?? page.page_id}</h3>
          {page.output ? <p className="truncate text-xs text-text-faint">{page.output}</p> : null}
        </div>
        {status === "written" ? (
          <Pill tone="ready" icon={Check}>Written</Pill>
        ) : status === "failed" ? (
          <Pill tone="dropped" icon={AlertTriangle}>Failed</Pill>
        ) : (
          <Pill tone="neutral" icon={Loader2}>Pending</Pill>
        )}
      </div>

      {status === "failed" ? (
        <div className="mb-3 rounded-md border border-dropped-bg bg-dropped-bg/40 p-2 text-xs text-dropped-fg">
          <p className="mb-1">{writeState?.error ?? "Write failed."}</p>
          <button className={btnSecondarySm} onClick={() => void retry()} disabled={retrying}>
            {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Retry
          </button>
        </div>
      ) : null}

      {!gate ? (
        <p className="text-xs text-text-muted">
          {status === "written"
            ? runFinished ? "Written." : "Written — waiting for the rest of the run."
            : "Writing…"}
        </p>
      ) : (
        <div className="space-y-3">
          {/* Title */}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-faint">Title</label>
            {editingTitle ? (
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  autoFocus
                />
                <button className={btnSecondarySm} onClick={() => void saveTitle()} disabled={busy || disabled}>Save</button>
                <button className={btnGhostSm} onClick={() => { setEditingTitle(false); setTitleDraft(page.title); }}>Cancel</button>
              </div>
            ) : (
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-md border border-transparent p-1 text-left text-sm text-text hover:border-border"
                onClick={() => { setTitleDraft(page.title); setEditingTitle(true); }}
                disabled={disabled}
              >
                <Pencil className="h-3 w-3 shrink-0 text-text-faint" /> {page.title}
              </button>
            )}
          </div>

          {/* Text slots */}
          {textSlotDefs.map((def) => {
            const value = page.slots[def.id] ?? def.sample;
            const owned = isOperator(provenance?.slots?.[def.id]);
            return (
              <div key={def.id}>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-text-faint">
                  {def.id}
                  {owned ? <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent-ink">edited</span> : null}
                </label>
                {editingSlot === def.id ? (
                  <div className="flex gap-2">
                    <textarea
                      className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-text"
                      value={slotDraft}
                      onChange={(e) => setSlotDraft(e.target.value)}
                      rows={2}
                      autoFocus
                    />
                    <div className="flex flex-col gap-1">
                      <button className={btnSecondarySm} onClick={() => void saveSlot(def.id)} disabled={busy || disabled}>Save</button>
                      <button className={btnGhostSm} onClick={() => setEditingSlot(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-1.5">
                    <button
                      type="button"
                      className="flex-1 rounded-md border border-transparent p-1 text-left text-sm text-text hover:border-border"
                      onClick={() => { setSlotDraft(value); setEditingSlot(def.id); }}
                      disabled={disabled}
                    >
                      {value}
                    </button>
                    <button
                      type="button"
                      className={btnGhostSm}
                      title={`Re-roll "${def.id}"`}
                      aria-label={`Re-roll ${def.id}`}
                      onClick={() => void rerollOneSlot(def.id)}
                      disabled={busy || disabled}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Image slots */}
          {imageSlotDefs.map((def) => {
            const value = page.slots[def.id] ?? def.sample;
            const picked = value.startsWith("asset:");
            const altId = `${def.id}_alt`;
            return (
              <div key={def.id}>
                <label className="mb-1 block text-xs font-medium text-text-faint">{def.id}</label>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm text-text hover:bg-surface-2"
                  onClick={() => setImageSlotOpen(def.id)}
                  disabled={disabled}
                >
                  <ImageIcon className="h-4 w-4 text-text-faint" />
                  {picked ? "Custom image picked" : "Using template sample — choose an image"}
                </button>

                {imageSlotOpen === def.id ? (
                  <ImagePicker
                    runId={runId}
                    leadId={leadId}
                    pageIndex={index}
                    slotId={def.id}
                    clientPhotos={clientPhotos}
                    altValue={page.slots[altId] ?? ""}
                    onEditAlt={(v) => onEditSlot(altId, v)}
                    onPicked={onImagePicked}
                    onClose={() => setImageSlotOpen(null)}
                  />
                ) : null}
              </div>
            );
          })}

          {/* Repeats: read-only summary — full row editing is Gate 2 (Phase 4) */}
          {Object.entries(page.repeats).map(([id, rows]) => (
            <p key={id} className="text-xs text-text-faint">{rows.length} item(s) in "{id}"</p>
          ))}

          <div className="border-t border-border pt-2">
            <button className={btnSecondarySm} onClick={() => void rerollWholePage()} disabled={busy || disabled}>
              <RefreshCw className="h-3.5 w-3.5" /> Re-roll page
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
