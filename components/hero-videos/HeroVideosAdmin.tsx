"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, FolderSync, Loader2, RefreshCw, Save, XCircle } from "lucide-react";
import { PageHeader } from "@/components/common/Panel";
import { btnPrimary, btnSecondary } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/hero-videos/names";
import type { HeroVideoRow, SyncItem, SyncPlan } from "@/lib/hero-videos/library";
import { invalidateHeroVideos } from "./useHeroVideos";

interface Settings {
  folder_id: string | null;
  folder_url: string | null;
  google_account: string | null;
  media_host: string | null;
}

type ItemState = SyncItem & { state: "waiting" | "copying" | "done" | "failed"; error?: string };

const REASON: Record<SyncItem["reason"], string> = { new: "new", changed: "changed in Drive", retry: "retry" };

/**
 * Site Builder → Hero Videos: where the library comes from (a Drive folder
 * with a subfolder per category) and the Sync that copies new or changed
 * videos to the shared media host, one request per video so progress shows
 * as it goes and no single request runs long.
 */
export function HeroVideosAdmin() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [folderInput, setFolderInput] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [rows, setRows] = useState<HeroVideoRow[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [items, setItems] = useState<ItemState[]>([]);

  const loadRows = useCallback(async () => {
    const res = await fetch("/api/site-builder/hero-videos?all=1");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ kind: "error", title: body.error ?? "Could not load the library" });
      setRows([]);
      return;
    }
    setRows((body.videos ?? []) as HeroVideoRow[]);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/site-builder/hero-videos/settings")
      .then(async (res) => ({ ok: res.ok, body: (await res.json().catch(() => ({}))) as Settings }))
      .then(({ ok, body }) => {
        if (cancelled || !ok) return;
        setSettings(body);
        setFolderInput(body.folder_url ?? "");
      })
      .catch(() => {});
    fetch("/api/site-builder/hero-videos?all=1")
      .then(async (res) => ({ ok: res.ok, body: await res.json().catch(() => ({})) }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) toast({ kind: "error", title: body.error ?? "Could not load the library" });
        setRows(ok ? ((body.videos ?? []) as HeroVideoRow[]) : []);
      })
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [toast]);

  async function saveFolder() {
    setSavingFolder(true);
    try {
      const res = await fetch("/api/site-builder/hero-videos/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: folderInput }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save the folder");
      const id = body.folder_id as string | null;
      setSettings((s) => (s ? { ...s, folder_id: id, folder_url: id ? `https://drive.google.com/drive/folders/${id}` : null } : s));
      toast({ kind: "success", title: id ? "Library folder saved — press Sync to import it" : "Library folder cleared" });
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not save the folder" });
    } finally {
      setSavingFolder(false);
    }
  }

  async function sync() {
    setSyncing(true);
    setPlan(null);
    setItems([]);
    try {
      const res = await fetch("/api/site-builder/hero-videos/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Sync failed");
      const p = body.plan as SyncPlan;
      setPlan(p);
      const queue: ItemState[] = p.toImport.map((i) => ({ ...i, state: "waiting" }));
      setItems(queue);
      let failed = 0;
      // One video per request, in order: a long sync shows its progress and
      // never sits inside a single request the proxy might time out.
      for (let i = 0; i < queue.length; i++) {
        setItems((prev) => prev.map((it, j) => (j === i ? { ...it, state: "copying" } : it)));
        const r = await fetch("/api/site-builder/hero-videos/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ drive_file_id: queue[i].drive_file_id, category: queue[i].category }),
        });
        const b = await r.json().catch(() => ({}));
        if (!r.ok) failed++;
        setItems((prev) =>
          prev.map((it, j) => (j === i ? { ...it, state: r.ok ? "done" : "failed", error: r.ok ? undefined : b.error ?? "Import failed" } : it)),
        );
      }
      invalidateHeroVideos();
      await loadRows();
      toast({
        kind: failed ? "error" : "success",
        title: failed
          ? `Sync finished with ${failed} failure${failed === 1 ? "" : "s"}`
          : queue.length
            ? `Synced — ${queue.length} video${queue.length === 1 ? "" : "s"} copied`
            : "Everything is already up to date",
      });
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Sync failed" });
    } finally {
      setSyncing(false);
    }
  }

  const grouped = useMemo(() => {
    const m = new Map<string, HeroVideoRow[]>();
    for (const r of rows ?? []) m.set(r.category, [...(m.get(r.category) ?? []), r]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);
  const readyCount = (rows ?? []).filter((r) => r.status === "ready").length;

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Hero videos"
        description="The video library sales pick from for video-hero templates (SD Home). Videos live in Google Drive; Sync puts ONE copy of each on the media host, and every site embeds that copy."
        action={
          <button className={btnPrimary} onClick={() => void sync()} disabled={syncing || !settings?.folder_id}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderSync className="h-4 w-4" />} Sync from Drive
          </button>
        }
      />

      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-1 text-sm font-semibold text-text">Drive library folder</h3>
        <p className="mb-3 text-xs leading-relaxed text-text-muted">
          One folder, with a subfolder per category — <span className="font-medium text-text">Kitchen Remodel</span>,{" "}
          <span className="font-medium text-text">Siding</span>, … The subfolder&apos;s name is the category sales see. To add a
          video, drop it into its category&apos;s subfolder and press Sync. Removing one from Drive hides it from the gallery
          (sites already using it keep playing it).
          {settings?.google_account ? (
            <>
              {" "}The folder must be visible to <span className="font-medium text-text">{settings.google_account}</span>.
            </>
          ) : settings ? (
            <span className="text-notready-fg"> Google is not connected — connect it under Admin → Contract Templates first.</span>
          ) : null}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={inputCls}
            value={folderInput}
            onChange={(e) => setFolderInput(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/…"
            aria-label="Drive library folder link"
            disabled={savingFolder}
          />
          <button className={btnSecondary + " shrink-0"} onClick={() => void saveFolder()} disabled={savingFolder}>
            {savingFolder ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </button>
          {settings?.folder_url && (
            <a className={btnSecondary + " shrink-0"} href={settings.folder_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" /> Open in Drive
            </a>
          )}
        </div>
        <p className="mt-2 text-[11px] text-text-faint">
          Media host: {settings?.media_host ?? "not configured (DirectAdmin settings are missing on the server)"}
        </p>
      </section>

      {(plan || items.length > 0) && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-2 text-sm font-semibold text-text">Sync</h3>
          {plan && (
            <p className="mb-3 text-xs text-text-muted">
              {plan.toImport.length} to copy · {plan.upToDate} up to date
              {plan.restored ? ` · ${plan.restored} restored` : ""}
              {plan.archived.length ? ` · ${plan.archived.length} removed from the gallery (no longer in Drive)` : ""}
            </p>
          )}
          {items.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border">
              {items.map((it) => (
                <li key={it.drive_file_id} className="flex items-start gap-2 px-3 py-2 text-sm">
                  {it.state === "copying" ? (
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-accent" />
                  ) : it.state === "done" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  ) : it.state === "failed" ? (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-notready-fg" />
                  ) : (
                    <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-text-faint" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-text">
                      <span className="font-medium">{it.category}</span> · {it.name}{" "}
                      <span className="text-[11px] text-text-faint">({REASON[it.reason]})</span>
                    </p>
                    {it.error && <p className="text-xs text-notready-fg">{it.error}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {plan && plan.skipped.length > 0 && (
            <div className="mt-3 rounded-md border border-border bg-surface-2/60 px-3 py-2 text-xs text-text-muted">
              <p className="mb-1 flex items-center gap-1.5 font-medium text-text">
                <AlertTriangle className="h-3.5 w-3.5 text-notready-fg" /> Not imported
              </p>
              <ul className="list-disc space-y-0.5 pl-5">
                {plan.skipped.map((s) => (
                  <li key={s.name}>
                    {s.name} — {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-3 text-sm font-semibold text-text">
          Library <span className="font-normal text-text-muted">· {readyCount} in the gallery</span>
        </h3>
        {rows === null ? (
          <p className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-text-muted">No videos yet — set the Drive folder above and press Sync.</p>
        ) : (
          <div className="space-y-5">
            {grouped.map(([category, list]) => (
              <div key={category}>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">{category}</h4>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {list.map((r) => (
                    <div key={r.id} className={cn("overflow-hidden rounded-lg border border-border", r.status === "archived" && "opacity-60")}>
                      <div className="aspect-video bg-black">
                        {r.media_url ? (
                          <video src={`${r.media_url}#t=0.5`} preload="metadata" controls muted playsInline loop className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <div className="space-y-1 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium text-text">{r.name}</p>
                          <StatusBadge status={r.status} />
                        </div>
                        <p className="text-[11px] text-text-muted">
                          {[r.size_bytes ? `${(r.size_bytes / 1e6).toFixed(1)} MB` : null, formatDuration(r.duration_ms) || null, r.width && r.height ? `${r.width}×${r.height}` : null]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </p>
                        {r.error && <p className="text-[11px] text-notready-fg">{r.error}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: HeroVideoRow["status"] }) {
  const label = { ready: "In gallery", pending: "Copying", failed: "Failed", archived: "Removed" }[status];
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        status === "ready" && "bg-accent-soft text-accent-ink",
        status === "failed" && "bg-notready-bg text-notready-fg",
        (status === "pending" || status === "archived") && "bg-surface-2 text-text-muted",
      )}
    >
      {label}
    </span>
  );
}
