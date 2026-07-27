"use client";

import { useEffect, useState } from "react";
import { Loader2, MapPinned } from "lucide-react";
import { btnSecondarySm } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import type { StudioRunRow } from "@/lib/site-studio/run/types";
import type { TemplateManifest } from "@/lib/site-studio/schema";

export interface SiteFactsPanelProps {
  runId: string;
  /** `steps.prepare.pending_identity` — identity keys the compiled template
   *  references that this run's dossier could not supply. Never includes the
   *  template's own demo value for any of these keys: that's the vendor's
   *  business detail, not the operator's, and showing it would invite
   *  accepting it wholesale and shipping a leak onto the client's site. */
  pendingIdentity: string[];
  /** `steps.prepare.pending_identity_usage` — how many places each pending
   *  key shows up and on which page ids, purely so the operator understands
   *  what filling (or skipping) a fact actually affects. */
  pendingUsage?: Record<string, { count: number; pages: string[] }>;
  /** The run's CURRENT `content_doc.identity` — what's already been filled
   *  in (possibly by an earlier save from this same panel), never the
   *  template's demo value. */
  identity: Record<string, string>;
  manifest: TemplateManifest | null;
  onRunUpdated: (run: StudioRunRow) => void;
}

/** "owner_name" -> "Owner name"; "city_2" -> "City 2". Purely cosmetic — the
 *  underlying key is whatever the deterministic extractor or the AI identity
 *  pass minted at compile time (compiler/ai/identityAi.ts), and this is the
 *  only form of it ever shown to the operator. */
function humanizeKey(key: string): string {
  const words = key.split("_").filter(Boolean);
  if (words.length === 0) return key;
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

/**
 * Gate 1 "Site facts" panel (Phase 4b): one labelled input per identity key
 * the template needs that the lead's dossier couldn't supply. Mounted from
 * `RunCockpit` whenever `run.steps.prepare.pending_identity` is non-empty.
 *
 * Leaving a field blank is a legitimate choice ("skip") — the site simply
 * renders with that spot blank; approval at Gate 1 is allowed either way
 * (see the cockpit's footer note). Saving PATCHes
 * `/api/site-studio/runs/[id]/identity`, which only accepts keys already
 * present in `content_doc.identity` and holds every non-URL-shaped key to
 * the same markup/token/URL bar as any other operator-typed text.
 */
export function SiteFactsPanel({ runId, pendingIdentity, pendingUsage, identity, manifest, onRunUpdated }: SiteFactsPanelProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(pendingIdentity.map((k) => [k, identity[k] ?? ""])),
  );
  const [saving, setSaving] = useState(false);

  // Re-seed whenever the pending set or the run's own identity changes
  // underneath us (another tab's save, or this panel's own save bubbling
  // back through `onRunUpdated`) — compares serialized values rather than
  // object identity so this doesn't re-fire on every unrelated parent render.
  const identityKey = JSON.stringify([pendingIdentity, identity]);
  useEffect(() => {
    setDraft(Object.fromEntries(pendingIdentity.map((k) => [k, identity[k] ?? ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey]);

  if (pendingIdentity.length === 0) return null;

  const pageLabel = (pageId: string) => manifest?.pages.find((p) => p.id === pageId)?.title_sample ?? pageId;

  const dirty = pendingIdentity.filter((k) => draft[k] !== (identity[k] ?? ""));

  async function save() {
    if (dirty.length === 0) return;
    setSaving(true);
    try {
      const payload = Object.fromEntries(dirty.map((k) => [k, draft[k]]));
      const res = await fetch(`/api/site-studio/runs/${runId}/identity`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        toast({
          kind: "error",
          title: body.error ?? "This run changed while you were editing — your view has been refreshed, please redo that change",
        });
        const freshRes = await fetch(`/api/site-studio/runs/${runId}`);
        const fresh = await freshRes.json().catch(() => ({}));
        if (freshRes.ok && fresh.run) onRunUpdated(fresh.run as StudioRunRow);
        return;
      }
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Could not save these facts" });
        return;
      }
      toast({ kind: "success", title: "Site facts saved" });
      onRunUpdated(body.run as StudioRunRow);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-medium text-text">
        <MapPinned className="h-4 w-4" /> Site facts
      </h3>
      <p className="mb-3 text-xs text-text-muted">
        This template asks for a few facts the lead record doesn&apos;t have. Fill in what you know — leaving one blank
        is a legitimate choice, and the site simply renders with that spot blank.
      </p>
      <div className="space-y-3">
        {pendingIdentity.map((key) => {
          const usage = pendingUsage?.[key];
          return (
            <label key={key} className="block text-xs">
              <span className="mb-1 flex flex-wrap items-center justify-between gap-x-2 text-text">
                <span className="font-medium">{humanizeKey(key)}</span>
                {usage ? (
                  <span className="text-text-faint">
                    {usage.count} place{usage.count === 1 ? "" : "s"}
                    {usage.pages.length ? ` · ${usage.pages.map(pageLabel).join(", ")}` : ""}
                  </span>
                ) : null}
              </span>
              <input
                type="text"
                aria-label={humanizeKey(key)}
                className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text"
                value={draft[key] ?? ""}
                placeholder="Leave blank to skip"
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                disabled={saving}
              />
            </label>
          );
        })}
      </div>
      <button
        type="button"
        className={`${btnSecondarySm} mt-3`}
        onClick={() => void save()}
        disabled={saving || dirty.length === 0}
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save site facts
      </button>
    </div>
  );
}
