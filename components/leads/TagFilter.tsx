"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Tag, Plus, Trash2, Loader2 } from "lucide-react";
import type { LeadTag } from "@/lib/leads/types";
import { tagColor, TAG_COLOR_KEYS } from "@/lib/leads/tagColors";
import { toggleTag } from "@/lib/leads/tagFilter";

export function TagFilter({ tags, selected, canManage, onChange }: {
  tags: LeadTag[];
  selected: string[];
  canManage: boolean;
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState("slate");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const toggle = (id: string) => onChange(toggleTag(selected, id));

  async function create() {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n, color }),
    });
    setBusy(false);
    if (res.ok) {
      setName("");
      setColor("slate");
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "Could not create tag");
    }
  }

  async function remove(id: string) {
    if (deletingId) return;
    setDeletingId(id);
    const res = await fetch(`/api/tags/${id}`, { method: "DELETE" });
    setDeletingId(null);
    if (res.ok) {
      // Drop it from the active selection too so a stale id can't linger.
      if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
      router.refresh();
    }
  }

  const label = selected.length ? `Tags · ${selected.length}` : "Tags";
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={"inline-flex items-center gap-1 px-3 py-2 rounded-md border text-sm outline-none focus:ring-2 focus:ring-accent " +
          (selected.length ? "border-accent bg-accent-soft text-accent-ink" : "border-border bg-surface text-text-muted")}>
        <Tag className="w-3.5 h-3.5 shrink-0" />
        {label}
        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-72 max-h-96 overflow-auto bg-surface border border-border rounded-md shadow-lg p-1">
          {tags.length === 0 && <div className="px-3 py-2 text-xs text-text-faint">No tags yet</div>}
          {tags.map((t) => {
            const col = tagColor(t.color);
            return (
              <div key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-2 text-sm group/tag">
                <label className="flex flex-1 items-center gap-2 cursor-pointer min-w-0">
                  <input type="checkbox" className="accent-accent" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: col.hex }} />
                  <span className="flex-1 text-text truncate">{t.name}</span>
                </label>
                {canManage && (
                  <button type="button" onClick={() => remove(t.id)} disabled={deletingId === t.id}
                    title="Delete tag" aria-label={`Delete tag ${t.name}`}
                    className="text-text-faint hover:text-dropped-fg disabled:opacity-50 opacity-0 group-hover/tag:opacity-100 transition-opacity">
                    {deletingId === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            );
          })}

          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])}
              className="w-full text-left px-2 py-1.5 mt-1 text-xs text-dropped-fg hover:bg-surface-2 rounded">Clear</button>
          )}

          {canManage && (
            <div className="mt-1 border-t border-border-subtle pt-2 px-2 pb-1">
              <div className="flex items-center gap-1.5 mb-1.5">
                {TAG_COLOR_KEYS.map((k) => (
                  <button key={k} type="button" onClick={() => setColor(k)}
                    title={k} aria-label={`Color ${k}`}
                    className={"w-4 h-4 rounded-full transition-transform " + (color === k ? "ring-2 ring-offset-1 ring-offset-surface ring-accent scale-110" : "hover:scale-110")}
                    style={{ background: tagColor(k).hex }} />
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <input value={name} onChange={(e) => { setName(e.target.value); setErr(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); create(); } }}
                  placeholder="New tag name" maxLength={40}
                  className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-border bg-surface text-sm outline-none focus:ring-2 focus:ring-accent" />
                <button type="button" onClick={create} disabled={busy || !name.trim()}
                  className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-border bg-surface text-sm text-text-muted hover:bg-surface-2 disabled:opacity-50">
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
                </button>
              </div>
              {err && <p className="mt-1 text-[11px] text-dropped-fg">{err}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
