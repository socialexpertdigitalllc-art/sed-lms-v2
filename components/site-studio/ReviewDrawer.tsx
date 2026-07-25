"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Info, Loader2, ShieldCheck, Sparkles, X } from "lucide-react";
import { Pill } from "@/components/common/Panel";
import { btnPrimary, btnSecondary, btnSecondarySm, iconBtn } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import type { Diagnostic, TemplateManifest } from "@/lib/site-studio/schema";
import type { StudioTemplateStatus } from "@/lib/site-studio/service/types";
import { canCertify, groupDiagnostics, statusPill } from "@/lib/site-studio/ui/status";

interface DetailRow {
  id: string;
  name: string;
  status: StudioTemplateStatus;
  version: number;
  manifest: TemplateManifest | null;
  diagnostics: Diagnostic[] | null;
  identity_enriched_at: string | null;
  semantics_enriched_at: string | null;
}

const LEVEL_ICON = { blocker: AlertTriangle, warn: AlertTriangle, info: Info } as const;

const inputSelectCls =
  "rounded-md border border-border bg-surface px-2 py-1 text-xs text-text outline-none focus:ring-2 focus:ring-accent";

export function ReviewDrawer({
  templateId,
  onClose,
  onChanged,
}: {
  templateId: string;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [row, setRow] = useState<DetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "identity" | "semantics" | "certify" | "reject">(null);
  const [pageFile, setPageFile] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/site-studio/templates/${templateId}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not load template");
      const t = (await res.json()).template as DetailRow;
      setRow(t);
      setPageFile((prev) => prev ?? t.manifest?.pages?.[0]?.file ?? null);
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load template" });
    } finally {
      setLoading(false);
    }
  }, [templateId, toast]);

  useEffect(() => { void load(); }, [load]);

  // Escape closes the drawer (matches the app's dialog behaviour). Closing
  // while a request is in flight is fine — the in-flight request still
  // settles (it updates state via setRow/setBusy on an unmounted component,
  // which React tolerates; the board's own onChanged/load re-fetches
  // separately) — it just won't be visible here anymore.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const grouped = useMemo(() => groupDiagnostics(row?.diagnostics), [row]);
  const certifiable = row ? canCertify(row.status, Boolean(row.manifest), row.diagnostics) : false;

  async function post(path: string, kind: NonNullable<typeof busy>, okTitle: string) {
    setBusy(kind);
    try {
      const res = await fetch(`/api/site-studio/templates/${templateId}/${path}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Request failed");
      if (body.reverted) {
        toast({ kind: "info", title: "Reverted", body: "The AI change broke the round-trip check, so it was discarded." });
      } else {
        toast({ kind: "success", title: okTitle });
      }
      await load();
      await onChanged();
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(status: StudioTemplateStatus, okTitle: string) {
    setBusy("reject");
    try {
      const res = await fetch(`/api/site-studio/templates/${templateId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Request failed");
      toast({ kind: "success", title: okTitle });
      await load();
      await onChanged();
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setBusy(null);
    }
  }

  const pages = row?.manifest?.pages ?? [];
  const pill = row ? statusPill(row.status) : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[1100px] flex-col border-l border-border bg-surface"
        role="dialog"
        aria-label="Template review"
      >
        <header className="flex items-center gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-lg font-semibold text-text">{row?.name ?? "Loading…"}</h2>
            {row ? (
              <p className="text-xs text-text-muted">
                v{row.version} · {pages.length} page{pages.length === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
          {pill ? <Pill tone={pill.tone}>{pill.label}</Pill> : null}
          <button className={iconBtn} onClick={onClose} title="Close review" aria-label="Close review">
            <X className="h-4 w-4" />
          </button>
        </header>

        {loading || !row ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* left: checklist + actions */}
            <div className="w-[340px] shrink-0 space-y-4 overflow-auto border-r border-border p-4">
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">Review checklist</h3>
                {grouped.blockers.length + grouped.warnings.length + grouped.infos.length === 0 ? (
                  <p className="flex items-center gap-1.5 text-sm text-text-muted">
                    <Check className="h-4 w-4 text-ready-fg" /> Nothing flagged.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {[...grouped.blockers, ...grouped.warnings, ...grouped.infos].map((d, i) => {
                      const Icon = LEVEL_ICON[d.level];
                      return (
                        <li key={`${d.code}-${i}`} className="rounded-md border border-border bg-surface-2 p-2">
                          <div className="flex items-center gap-1.5">
                            <Icon
                              className={cn(
                                "h-3.5 w-3.5",
                                d.level === "blocker" ? "text-dropped-fg" : d.level === "warn" ? "text-notready-fg" : "text-text-faint",
                              )}
                            />
                            <span className="text-xs font-medium text-text">{d.code}</span>
                            {d.page ? <span className="ml-auto text-[11px] text-text-faint">{d.page}</span> : null}
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-text-muted">{d.message}</p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint">AI enrichment</h3>
                <p className="text-xs leading-relaxed text-text-muted">
                  Optional. Each pass is verified against the original — anything that breaks the round-trip is discarded automatically.
                </p>
                <button
                  className={btnSecondarySm}
                  disabled={busy !== null || row.status !== "needs_review"}
                  onClick={() => void post("enrich-identity", "identity", "Identity pass complete")}
                >
                  {busy === "identity" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Find residual identity
                  {row.identity_enriched_at ? <Check className="h-3.5 w-3.5 text-ready-fg" /> : null}
                </button>
                <button
                  className={btnSecondarySm}
                  disabled={busy !== null || row.status !== "needs_review"}
                  onClick={() => void post("enrich-semantics", "semantics", "Semantics pass complete")}
                >
                  {busy === "semantics" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Label pages &amp; slots
                  {row.semantics_enriched_at ? <Check className="h-3.5 w-3.5 text-ready-fg" /> : null}
                </button>
              </section>

              <section className="space-y-2 border-t border-border pt-4">
                <button
                  className={btnPrimary}
                  disabled={!certifiable || busy !== null}
                  onClick={() => void post("certify", "certify", "Certified")}
                >
                  {busy === "certify" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Certify template
                </button>
                {!certifiable && row.status === "needs_review" ? (
                  <p className="text-xs text-dropped-fg">
                    {grouped.blockers.length} blocking problem{grouped.blockers.length === 1 ? "" : "s"} must be cleared first.
                  </p>
                ) : null}
                {row.status === "needs_review" ? (
                  <button className={btnSecondary} disabled={busy !== null} onClick={() => void setStatus("rejected", "Rejected")}>
                    Reject
                  </button>
                ) : null}
                {row.status === "certified" ? (
                  <button className={btnSecondary} disabled={busy !== null} onClick={() => void setStatus("disabled", "Disabled")}>
                    Disable
                  </button>
                ) : null}
                {row.status === "disabled" ? (
                  <button className={btnSecondary} disabled={busy !== null} onClick={() => void setStatus("certified", "Re-enabled")}>
                    Re-enable
                  </button>
                ) : null}
                {row.status === "rejected" ? (
                  <button className={btnSecondary} disabled={busy !== null} onClick={() => void setStatus("needs_review", "Re-opened")}>
                    Re-open
                  </button>
                ) : null}
              </section>
            </div>

            {/* right: previews */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
                <select
                  className={cn(inputSelectCls)}
                  value={pageFile ?? ""}
                  onChange={(e) => setPageFile(e.target.value)}
                  aria-label="Preview page"
                >
                  {pages.map((p) => (
                    <option key={p.file} value={p.file}>{p.file} · {p.kind}{p.stampable ? " (stampable)" : ""}</option>
                  ))}
                </select>
                <label className="ml-auto flex items-center gap-1.5 text-xs text-text-muted">
                  <input type="checkbox" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} />
                  Show original side-by-side
                </label>
              </div>
              {!row.manifest || !pageFile ? (
                <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-text-muted">
                  Not compiled yet — compile this template to preview it.
                </div>
              ) : (
                <div className={cn("grid min-h-0 flex-1", showOriginal ? "grid-cols-2" : "grid-cols-1")}>
                  {showOriginal ? (
                    <figure className="flex min-h-0 flex-col border-r border-border">
                      <figcaption className="border-b border-border bg-surface-2 px-3 py-1 text-[11px] font-medium text-text-muted">
                        Original upload
                      </figcaption>
                      <iframe
                        title="Original template page"
                        src={`/api/site-studio/templates/${row.id}/original/${pageFile}`}
                        className="min-h-0 flex-1 bg-white"
                        sandbox=""
                      />
                    </figure>
                  ) : null}
                  <figure className="flex min-h-0 flex-col">
                    <figcaption className="border-b border-border bg-surface-2 px-3 py-1 text-[11px] font-medium text-text-muted">
                      Compiled package, rendered from its own samples
                    </figcaption>
                    <iframe
                      title="Compiled template page"
                      src={`/api/site-studio/templates/${row.id}/preview/${pageFile}`}
                      className="min-h-0 flex-1 bg-white"
                      sandbox=""
                    />
                  </figure>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
