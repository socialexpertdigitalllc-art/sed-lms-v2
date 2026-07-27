"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Monitor, Smartphone, Undo2, UploadCloud, X } from "lucide-react";
import { btnGhostSm, btnPrimary, btnSecondarySm, iconBtn } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import type { RunContentDoc } from "@/lib/site-studio/run/applyWritten";
import type { StudioRunRow } from "@/lib/site-studio/run/types";
import { ImagePicker } from "./ImagePicker";

/**
 * A parsed slot key, either shape documented on `SLOT_ATTR`
 * (`lib/site-studio/render/annotate.ts`):
 *  - plain page-level: `"${docPageIndex}:${slotId}"`
 *  - repeat row:       `"${docPageIndex}:${repeatId}#${rowIndex}:${slotId}"`
 * `repeat` is set only for the second shape — `#` never appears in the
 * first, which is exactly what lets this tell them apart before parsing
 * either one further.
 */
export interface ParsedSlotKey {
  pageIndex: number;
  slotId: string;
  repeat?: { repeatId: string; rowIndex: number };
}

export function parseSlotKey(key: string): ParsedSlotKey | null {
  const firstColon = key.indexOf(":");
  if (firstColon === -1) return null;
  const pageIndex = Number(key.slice(0, firstColon));
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;
  const rest = key.slice(firstColon + 1);
  const hashIdx = rest.indexOf("#");
  if (hashIdx === -1) {
    if (!rest) return null;
    return { pageIndex, slotId: rest };
  }
  const repeatId = rest.slice(0, hashIdx);
  const afterHash = rest.slice(hashIdx + 1); // "${rowIndex}:${slotId}"
  const secondColon = afterHash.indexOf(":");
  if (!repeatId || secondColon === -1) return null;
  const rowIndex = Number(afterHash.slice(0, secondColon));
  const slotId = afterHash.slice(secondColon + 1);
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || !slotId) return null;
  return { pageIndex, slotId, repeat: { repeatId, rowIndex } };
}

export interface SlotEditorProps {
  title: string;
  value: string;
  operatorOwned: boolean;
  busy?: boolean;
  onSave: (value: string) => Promise<void>;
  /** Omit entirely (never merely disable) when a revert isn't offered for
   *  this field — see this file's own note on why an image slot never gets
   *  one here. */
  onRevert?: () => Promise<void>;
  onClose: () => void;
}

/**
 * The inline editor a click on an annotated text slot (or an image's alt
 * text, which is itself a plain text slot under the hood — see
 * `annotate.ts`'s `ALT_ATTR`) opens. Kept as its own exported component,
 * separate from the iframe-click plumbing in `RunPreview`, specifically so
 * it can be mounted and asserted on directly in tests: jsdom does not
 * execute the preview iframe's own navigation/rendering, so nothing inside
 * it (and therefore no click delivered through it) is reachable from a
 * test the way a real browser click would be. `ImagePicker` (Phase 3b) is
 * the same shape of dialog and is tested the same standalone way.
 */
export function SlotEditor({ title, value, operatorOwned, busy, onSave, onRevert, onClose }: SlotEditorProps) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [reverting, setReverting] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  async function revert() {
    if (!onRevert) return;
    setReverting(true);
    try {
      await onRevert();
    } finally {
      setReverting(false);
    }
  }

  const disabled = Boolean(busy) || saving || reverting;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[520px] rounded-lg border border-border bg-surface p-4"
        role="dialog"
        aria-label={`Edit ${title}`}
      >
        <div className="mb-2 flex items-center gap-2">
          <h3 className="flex-1 truncate text-sm font-medium text-text">{title}</h3>
          <button className={iconBtn} onClick={onClose} title="Close" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <textarea
          className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text"
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
        <div className="mt-3 flex items-center gap-2">
          <button className={btnPrimary} onClick={() => void save()} disabled={disabled}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
          </button>
          <button className={btnGhostSm} onClick={onClose} disabled={disabled}>Cancel</button>
          {/* Only ever rendered for a field this run's provenance currently
           *  marks "operator" — an image slot's revert always 422s (images
           *  have no AI value, see the revert route's own note), so
           *  `RunPreview` never passes `onRevert` for an image edit and this
           *  button simply never appears there rather than appearing and
           *  failing. */}
          {operatorOwned && onRevert ? (
            <button className={cn(btnSecondarySm, "ml-auto")} onClick={() => void revert()} disabled={disabled}>
              {reverting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Revert to AI
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type EditState =
  | {
      kind: "text";
      pageIndex: number;
      slotId: string;
      value: string;
      operatorOwned: boolean;
      /** Present only for a repeat-row click — see `parseSlotKey`/`SLOT_ATTR`.
       *  Absent for a plain page-level slot, which is the existing (Gate 1
       *  and pre-4a Gate 2) shape. */
      repeat?: { repeatId: string; rowIndex: number };
    }
  | {
      kind: "image";
      pageIndex: number;
      slotId: string;
      altSlotId?: string;
      altValue: string;
      /** Present only for a repeat-row image click (Phase 4c) — carried
       *  straight through to `ImagePicker`, which builds the exact same
       *  `"${pageIndex}:${repeatId}#${rowIndex}:${slotId}"` key the images
       *  route (and everything else in `annotate.ts`'s `SLOT_ATTR` family)
       *  already uses, so nothing downstream needs a second key format. */
      repeat?: { repeatId: string; rowIndex: number };
    };

/**
 * Pure decision logic behind a preview click: given the doc, the clicked
 * slot's key, whether it's an image, and the paired alt-text key (if any),
 * returns the `EditState` the click should open — or null when the key
 * doesn't resolve to anything in the current doc (e.g. a stale preview).
 * Split out from the click handler itself (which lives inside `RunPreview`
 * and needs a live DOM `Document` to attach to) specifically so this
 * decision can be unit-tested directly: jsdom does not execute the preview
 * iframe's own navigation, so a real click delivered through it is not
 * reachable from a test the way a browser click would be (see this file's
 * own note on the iframe sandbox), and this is what stays testable anyway.
 *
 * REPEAT-ROW IMAGES (Phase 4c): previously, an image click inside a repeat
 * row toasted "not supported" — `ImagePicker` only knew a flat
 * `pageIndex`/`slotId`. Now it opens `ImagePicker` exactly like a page-level
 * image click does, with the row's `repeat` key carried through unchanged.
 */
export function resolveClickTarget(
  doc: RunContentDoc,
  key: string,
  isImage: boolean,
  altKey: string | null,
): EditState | null {
  const parsed = parseSlotKey(key);
  if (!parsed) return null;
  const { pageIndex: idx, slotId } = parsed;
  const page = doc.pages[idx];
  if (!page) return null;

  if (parsed.repeat) {
    const { repeatId, rowIndex } = parsed.repeat;
    const row = page.repeats[repeatId]?.[rowIndex];
    if (!row) return null;

    if (isImage) {
      // The alt-text key, if present, is only used when it names the SAME
      // row (repeatId + rowIndex) — a mismatched or flat altKey is treated
      // as "no alt slot" rather than guessed at.
      const altParsed = altKey ? parseSlotKey(altKey) : null;
      const altSlotId =
        altParsed?.repeat && altParsed.repeat.repeatId === repeatId && altParsed.repeat.rowIndex === rowIndex
          ? altParsed.slotId
          : undefined;
      return {
        kind: "image",
        pageIndex: idx,
        slotId,
        altSlotId,
        altValue: altSlotId ? row[altSlotId] ?? "" : "",
        repeat: { repeatId, rowIndex },
      };
    }

    const owned = doc.provenance?.[idx]?.repeats?.[repeatId]?.[String(rowIndex)]?.[slotId]?.written_by === "operator";
    return {
      kind: "text",
      pageIndex: idx,
      slotId,
      value: row[slotId] ?? "",
      operatorOwned: owned,
      repeat: { repeatId, rowIndex },
    };
  }

  if (isImage) {
    const altParsed = altKey ? parseSlotKey(altKey) : null;
    const altSlotId = altParsed && !altParsed.repeat ? altParsed.slotId : undefined;
    return {
      kind: "image",
      pageIndex: idx,
      slotId,
      altSlotId,
      altValue: altSlotId ? page.slots[altSlotId] ?? "" : "",
    };
  }

  const owned = doc.provenance?.[idx]?.slots?.[slotId]?.written_by === "operator";
  return { kind: "text", pageIndex: idx, slotId, value: page.slots[slotId] ?? "", operatorOwned: owned };
}

export interface RunPreviewProps {
  run: StudioRunRow;
  onRunUpdated: (run: StudioRunRow) => void;
}

/**
 * Gate 2 — the navigable, click-to-edit preview (Task 7). Follows the 3b
 * conventions exactly (`RunCockpit`/`RunPageCard`/`ImagePicker` are the
 * precedent): plain `fetch` calls, the shared toast hook, and a local
 * `handleStaleWrite` matching `RunCockpit`'s own.
 *
 * IFRAME SANDBOX DECISION: the plan's starting point was `sandbox=""` (the
 * 2b `ReviewDrawer` posture) with a parent-side click listener attached via
 * `iframe.contentDocument`. That does NOT work: per the HTML sandboxing
 * spec, a sandboxed iframe WITHOUT `allow-same-origin` is forced into a
 * unique, opaque origin regardless of what its `src` actually serves from —
 * so even though `/preview` is served from this app's own origin, the
 * browser treats the framed document as cross-origin from the parent, and
 * `contentDocument` access throws a cross-origin `SecurityError`. This is a
 * DIFFERENT concern from script execution (`allow-scripts`): the click
 * wiring here never needs a script to run INSIDE the frame — it needs the
 * PARENT to reach into the frame's DOM, which needs `document.domain`-style
 * origin agreement, which `sandbox=""` deliberately breaks. `sandbox=
 * "allow-same-origin"` (still WITHOUT `allow-scripts`) is therefore used
 * instead: the frame keeps its real origin (this app's), so
 * `contentDocument` is reachable from here, while every script-execution,
 * form-submission, top-navigation, and popup privilege sandbox normally
 * strips stays stripped — an uploaded template's own `<script>` (left
 * un-rewritten by `buildPreview` on purpose, see that file) still never
 * runs.
 *
 * CROSS-REFERENCE (FIX 1, Phase 4a review) — this iframe attribute is only
 * HALF the story: the server's `untrustedContentHeaders` CSP `sandbox`
 * directive on the `/preview` response ITSELF also gates origin, and the two
 * combine RESTRICTIVELY (whichever side omits a token wins). A bare CSP
 * `sandbox` (no `allow-same-origin`) forces an opaque origin regardless of
 * this attribute — which is exactly how click-to-edit shipped dead in every
 * real browser (`contentDocument` was `null`; jsdom doesn't enforce CSP, so
 * the test suite never caught it). The route this iframe's `src` points at
 * (`app/api/site-studio/runs/[id]/preview/route.ts`) now passes
 * `{ allowSameOrigin: true }` to `untrustedContentHeaders` for exactly this
 * reason — if that route's CSP is ever changed back to bare `sandbox`
 * without changing this attribute (or vice versa), click-to-edit goes dead
 * again with no test-suite signal short of a real browser. See
 * `untrustedContentHeaders`'s own doc comment for the other side of this.
 *
 * REPEAT-ROW KEYS (Phase 4a): a click on a repeat-row TEXT slot (see
 * `parseSlotKey`'s `"idx:repeatId#row:slotId"` shape) opens the same
 * `SlotEditor` a plain slot does, and saves/reverts through the row-aware
 * `repeats: { [repeatId]: { [rowIndex]: { [slotId]: value } } }` body
 * `PATCH /content` and `POST /revert` now both understand (see those
 * routes' own doc comments). A repeat-row IMAGE click (Phase 4c) opens
 * `ImagePicker` the same way a page-level image click does — gallery and
 * card images almost always live inside a repeat, so this is what makes them
 * pickable at all — with the row's `repeat` key carried through unchanged
 * (see `resolveClickTarget`, and `ImagePicker`'s own `repeat` prop).
 */
export function RunPreview({ run, onRunUpdated }: RunPreviewProps) {
  const { toast } = useToast();
  const doc = run.content_doc as RunContentDoc;
  const runId = run.id;

  const [pageIndex, setPageIndex] = useState(0);
  const [width, setWidth] = useState<"mobile" | "desktop">("desktop");
  const [edit, setEdit] = useState<EditState | null>(null);
  const [busy, setBusy] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployedUrl, setDeployedUrl] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Cheap insurance against an out-of-range `?page=` if the doc were ever
  // to shrink out from under an open preview (not expected once `ready`).
  useEffect(() => {
    if (pageIndex >= doc.pages.length) setPageIndex(0);
  }, [doc.pages.length, pageIndex]);

  // `v=` busts the iframe's cache the instant the document changes — the
  // document (not the iframe) is the source of truth, so ANY successful
  // write anywhere (this component, ThemePanel, another tab) that lands and
  // bubbles a fresh `run` back up here changes `updated_at`, which changes
  // this src, which reloads the frame. No separate "refetch preview" call
  // is needed on top of `onRunUpdated`.
  const previewSrc = `/api/site-studio/runs/${runId}/preview?page=${pageIndex}&v=${encodeURIComponent(run.updated_at)}`;

  const handleStaleWrite = useCallback(async (body: { error?: string }) => {
    toast({
      kind: "error",
      title: body.error ?? "This run changed while you were editing — your view has been refreshed, please redo that change",
    });
    const res = await fetch(`/api/site-studio/runs/${runId}`);
    const fresh = await res.json().catch(() => ({}));
    if (res.ok && fresh.run) onRunUpdated(fresh.run as StudioRunRow);
  }, [runId, toast, onRunUpdated]);

  const saveSlot = useCallback(async (idx: number, slotId: string, value: string) => {
    const res = await fetch(`/api/site-studio/runs/${runId}/content`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_index: idx, slots: { [slotId]: value } }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) { await handleStaleWrite(body); return; }
    if (!res.ok) {
      toast({ kind: "error", title: body.error ?? "Edit rejected" });
      throw new Error(body.error ?? "Edit rejected");
    }
    onRunUpdated(body.run as StudioRunRow);
  }, [runId, toast, handleStaleWrite, onRunUpdated]);

  /** The repeat-row sibling of `saveSlot` — same route, the row-aware
   *  `repeats` shape instead of `slots` (see `PATCH /content`'s own doc
   *  comment). `rowIndex` is sent as an object key, so it round-trips
   *  through JSON as a string; the route/`applyOperatorEdit` are what parse
   *  it back into a number and validate it against the row count. */
  const saveRepeatSlot = useCallback(async (idx: number, repeatId: string, rowIndex: number, slotId: string, value: string) => {
    const res = await fetch(`/api/site-studio/runs/${runId}/content`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_index: idx, repeats: { [repeatId]: { [rowIndex]: { [slotId]: value } } } }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) { await handleStaleWrite(body); return; }
    if (!res.ok) {
      toast({ kind: "error", title: body.error ?? "Edit rejected" });
      throw new Error(body.error ?? "Edit rejected");
    }
    onRunUpdated(body.run as StudioRunRow);
  }, [runId, toast, handleStaleWrite, onRunUpdated]);

  const revertSlot = useCallback(async (idx: number, slotId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/site-studio/runs/${runId}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page_index: idx, slot_id: slotId }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) { await handleStaleWrite(body); return; }
      if (!res.ok) { toast({ kind: "error", title: body.error ?? "Revert failed" }); return; }
      toast({ kind: "success", title: "Reverted to the AI value" });
      onRunUpdated(body.run as StudioRunRow);
      setEdit(null);
    } finally {
      setBusy(false);
    }
  }, [runId, toast, handleStaleWrite, onRunUpdated]);

  /** The repeat-row sibling of `revertSlot` — same route, the `repeat`
   *  target shape `POST /revert` now understands alongside `slot_id`/
   *  `title` (see that route's own doc comment). */
  const revertRepeatSlot = useCallback(async (idx: number, repeatId: string, rowIndex: number, slotId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/site-studio/runs/${runId}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page_index: idx, repeat: { repeat_id: repeatId, row_index: rowIndex, slot_id: slotId } }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) { await handleStaleWrite(body); return; }
      if (!res.ok) { toast({ kind: "error", title: body.error ?? "Revert failed" }); return; }
      toast({ kind: "success", title: "Reverted to the AI value" });
      onRunUpdated(body.run as StudioRunRow);
      setEdit(null);
    } finally {
      setBusy(false);
    }
  }, [runId, toast, handleStaleWrite, onRunUpdated]);

  const openSlotFromKey = useCallback((key: string, isImage: boolean, altKey: string | null) => {
    const next = resolveClickTarget(doc, key, isImage, altKey);
    if (next) setEdit(next);
  }, [doc]);

  const attachClickHandler = useCallback((frameDoc: Document) => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // In-preview links were rewritten by `buildPreview` to
      // `#ss-page-<targetDocIndex>` — intercept them and switch pages
      // ourselves rather than letting the frame navigate (there is nothing
      // at that fragment for it to navigate TO).
      const link = target.closest('a[href^="#ss-page-"]');
      if (link) {
        e.preventDefault();
        const m = /^#ss-page-(\d+)$/.exec(link.getAttribute("href") ?? "");
        if (m) setPageIndex(Number(m[1]));
        return;
      }

      const slotEl = target.closest("[data-ss-image], [data-ss-slot]");
      if (!slotEl) return;
      e.preventDefault();
      const isImage = slotEl.hasAttribute("data-ss-image");
      const key = slotEl.getAttribute("data-ss-slot");
      if (!key) return;
      const altKey = slotEl.getAttribute("data-ss-alt");
      openSlotFromKey(key, isImage, altKey);
    };
    frameDoc.addEventListener("click", onClick);
    return () => frameDoc.removeEventListener("click", onClick);
  }, [openSlotFromKey]);

  function onIframeLoad() {
    const frame = iframeRef.current;
    try {
      const frameDoc = frame?.contentDocument;
      if (frameDoc) attachClickHandler(frameDoc);
    } catch {
      // Cross-origin (shouldn't happen — see this file's sandbox note — but
      // fail quiet rather than crash the preview over click wiring).
    }
  }

  async function saveEdit(value: string) {
    if (!edit || edit.kind !== "text") return;
    setBusy(true);
    try {
      if (edit.repeat) {
        await saveRepeatSlot(edit.pageIndex, edit.repeat.repeatId, edit.repeat.rowIndex, edit.slotId, value);
      } else {
        await saveSlot(edit.pageIndex, edit.slotId, value);
      }
      setEdit(null);
    } finally {
      setBusy(false);
    }
  }

  async function saveAlt(value: string) {
    if (!edit || edit.kind !== "image" || !edit.altSlotId) return;
    if (edit.repeat) {
      await saveRepeatSlot(edit.pageIndex, edit.repeat.repeatId, edit.repeat.rowIndex, edit.altSlotId, value);
    } else {
      await saveSlot(edit.pageIndex, edit.altSlotId, value);
    }
  }

  /**
   * Publishes the run's current build to its live subdomain (Task 9's
   * `POST /deploy`, wired up here — see this file's own history: the button
   * used to be a permanently-disabled stub left over from before that route
   * existed). Confirmed first — this is a REAL, irreversible-in-effect
   * publish to a live client-facing URL, not a preview action — and disabled
   * for the duration of the call so a double-click can't fire two overlapping
   * requests; the route itself also CAS-claims the run, but the button
   * should not invite the race in the first place.
   *
   * The route's response deliberately distinguishes 409 (e.g. the cross-lead
   * subdomain guard) from 502 (an upstream DirectAdmin failure) — both are
   * surfaced to the operator VERBATIM (never re-worded), because the two
   * failure classes call for different next actions and only the server
   * knows which one happened. `clearWarning`, when present, means the live
   * docroot may now hold a MIX of two site generations (an old-file cleanup
   * step failed but the new upload still went through) — surfaced as its own
   * toast rather than folded into the success message, since it needs the
   * operator's attention even though the deploy itself is reported "ok".
   */
  async function deploy() {
    if (!confirm("This publishes a real client site to a live subdomain. Continue?")) return;
    setDeploying(true);
    try {
      const res = await fetch(`/api/site-studio/runs/${runId}/deploy`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Deploy failed" });
        return;
      }
      setDeployedUrl(body.url as string);
      toast({ kind: "success", title: `Deployed to ${body.url}` });
      if (body.clearWarning) {
        toast({ kind: "info", title: body.clearWarning });
      }
    } finally {
      setDeploying(false);
    }
  }

  const pages = doc.pages;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2">
        {pages.map((p, i) => (
          <button
            key={i}
            type="button"
            data-testid="ss-page-tab"
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium",
              i === pageIndex ? "bg-accent text-white" : "bg-surface-2 text-text-muted hover:text-text",
            )}
            onClick={() => setPageIndex(i)}
          >
            {p.nav_title ?? p.page_id}
            {p.output ? <span className="ml-1 opacity-70">· {p.output}</span> : null}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            className={cn(btnGhostSm, width === "mobile" && "bg-surface-2 text-text")}
            title="Mobile width"
            aria-label="Mobile width"
            onClick={() => setWidth("mobile")}
          >
            <Smartphone className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={cn(btnGhostSm, width === "desktop" && "bg-surface-2 text-text")}
            title="Desktop width"
            aria-label="Desktop width"
            onClick={() => setWidth("desktop")}
          >
            <Monitor className="h-3.5 w-3.5" />
          </button>
          {run.status === "ready" ? (
            <button
              type="button"
              className={btnPrimary}
              onClick={() => void deploy()}
              disabled={deploying}
            >
              {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} Deploy
            </button>
          ) : null}
          {deployedUrl ? (
            <a
              href={deployedUrl}
              target="_blank"
              rel="noreferrer"
              className="max-w-[14rem] truncate text-xs text-accent underline"
            >
              {deployedUrl}
            </a>
          ) : null}
        </div>
      </div>

      <div
        data-testid="ss-preview-frame"
        className="mx-auto overflow-hidden rounded-lg border border-border bg-white"
        style={{ width: width === "mobile" ? 375 : "100%", height: "70vh" }}
      >
        <iframe
          ref={iframeRef}
          title="Site preview"
          src={previewSrc}
          sandbox="allow-same-origin"
          className="h-full w-full"
          onLoad={onIframeLoad}
        />
      </div>

      {edit?.kind === "text" ? (
        <SlotEditor
          title={edit.repeat ? `${edit.repeat.repeatId}[${edit.repeat.rowIndex}] · ${edit.slotId}` : edit.slotId}
          value={edit.value}
          operatorOwned={edit.operatorOwned}
          busy={busy}
          onSave={saveEdit}
          onRevert={
            edit.operatorOwned
              ? edit.repeat
                ? () => revertRepeatSlot(edit.pageIndex, edit.repeat!.repeatId, edit.repeat!.rowIndex, edit.slotId)
                : () => revertSlot(edit.pageIndex, edit.slotId)
              : undefined
          }
          onClose={() => setEdit(null)}
        />
      ) : null}

      {edit?.kind === "image" ? (
        <ImagePicker
          runId={runId}
          leadId={run.lead_id}
          pageIndex={edit.pageIndex}
          slotId={edit.slotId}
          repeat={edit.repeat}
          clientPhotos={run.client_photos}
          altValue={edit.altValue}
          onEditAlt={saveAlt}
          onPicked={onRunUpdated}
          onClose={() => setEdit(null)}
        />
      ) : null}
    </div>
  );
}
