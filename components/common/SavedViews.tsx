"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, Trash2, Plus } from "lucide-react";
import { useToast } from "@/components/common/Toast";

type SavedView = { id: string; name: string; path: string; query: string; created_at: string };

export function SavedViews({
  path,
  getQuery,
  onApply,
}: {
  path: string;
  /** Serialize the CURRENT view state (the URL no longer carries it). */
  getQuery: () => string;
  onApply: (params: Record<string, string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/me/views?path=${encodeURIComponent(path)}`);
      if (!res.ok) return;
      const data = await res.json();
      setViews(Array.isArray(data?.views) ? data.views : []);
    } catch {
      // ignore fetch errors — panel just shows empty
    }
  }, [path]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const query = getQuery(); // live view state at click time
      const res = await fetch("/api/me/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, path, query }),
      });
      if (res.ok) {
        setName("");
        await load();
        toast({ kind: "success", title: "View saved" });
      } else {
        toast({ kind: "error", title: "Could not save view" });
      }
    } catch {
      toast({ kind: "error", title: "Could not save view" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/me/views?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        await load();
        toast({ kind: "success", title: "View deleted" });
      } else {
        toast({ kind: "error", title: "Could not delete view" });
      }
    } catch {
      toast({ kind: "error", title: "Could not delete view" });
    }
  }

  function apply(view: SavedView) {
    onApply(Object.fromEntries(new URLSearchParams(view.query)));
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-sm text-text-muted hover:bg-surface-2"
      >
        <Bookmark className="w-4 h-4" /> Views
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-md border border-border bg-surface shadow-lg p-1">
          {views.length === 0 ? (
            <div className="px-2 py-2 text-sm text-text-muted">No saved views yet.</div>
          ) : (
            views.map((v) => (
              <div key={v.id} className="flex items-center gap-1 rounded hover:bg-surface-2">
                <button
                  type="button"
                  onClick={() => apply(v)}
                  className="flex-1 min-w-0 truncate px-2 py-1.5 text-sm text-text text-left"
                  title={v.name}
                >
                  {v.name}
                </button>
                <button
                  type="button"
                  onClick={() => remove(v.id)}
                  aria-label={`Delete view ${v.name}`}
                  title="Delete view"
                  className="p-1 rounded text-text-faint hover:text-dropped-fg shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
          <div className="my-1 border-t border-border" />
          <div className="flex items-center gap-1 px-1 py-1">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
              placeholder="Name this view"
              className="flex-1 min-w-0 px-2 py-1.5 rounded border border-border bg-surface text-sm outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              onClick={save}
              disabled={!name.trim() || busy}
              aria-label="Save current view"
              title="Save current view"
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-border text-sm text-text-muted hover:bg-surface-2 disabled:opacity-40 shrink-0"
            >
              <Plus className="w-4 h-4" /> Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
