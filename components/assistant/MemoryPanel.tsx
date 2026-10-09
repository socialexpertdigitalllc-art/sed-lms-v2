"use client";

import { useEffect, useState } from "react";
import { Brain, Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { MEMORY_KINDS, type AssistantMemory, type MemoryKind } from "@/lib/assistant/types";
import { btnPrimary, btnSecondarySm, iconBtn, iconBtnDanger } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";

/**
 * What the assistant remembers about THIS user. It reads these in every chat
 * and writes to them when it learns something durable; here the user can see,
 * correct, add and remove them. Nobody else can see them.
 */

const KIND_LABEL: Record<MemoryKind, string> = {
  goal: "Goals",
  preference: "Preferences",
  strategy: "Strategy",
  fact: "About you",
  note: "Notes",
};
const ORDER: MemoryKind[] = ["goal", "strategy", "preference", "fact", "note"];

const inputCls =
  "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none";

async function api<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

function MemoryRow({ memory, onChange, onRemove }: { memory: AssistantMemory; onChange: (m: AssistantMemory) => void; onRemove: (id: string) => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!draft.trim() || draft.trim() === memory.content) return setEditing(false);
    setBusy(true);
    try {
      const { memory: next } = await api<{ memory: AssistantMemory }>(`/api/assistant/memories/${memory.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: draft }),
      });
      onChange(next);
      setEditing(false);
    } catch (e) {
      toast({ kind: "error", title: "Could not update the memory", body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/api/assistant/memories/${memory.id}`, { method: "DELETE" });
      onRemove(memory.id);
    } catch (e) {
      toast({ kind: "error", title: "Could not delete the memory", body: (e as Error).message });
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <li className="space-y-1.5 rounded-md border border-accent/40 bg-surface p-2">
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={500} className={inputCls} aria-label="Memory" autoFocus />
        <div className="flex justify-end gap-1">
          <button type="button" className={iconBtn} onClick={() => setEditing(false)} aria-label="Cancel" title="Cancel">
            <X className="h-4 w-4" />
          </button>
          <button type="button" className={iconBtn} onClick={() => void save()} disabled={busy} aria-label="Save" title="Save">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </button>
        </div>
      </li>
    );
  }
  return (
    <li className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
      <p className="min-w-0 flex-1 text-sm leading-relaxed text-text">
        {memory.content}
        {memory.source === "user" ? <span className="ml-1.5 text-[11px] text-text-faint">(added by you)</span> : null}
      </p>
      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <button type="button" className={cn(iconBtn, "h-7 w-7")} onClick={() => setEditing(true)} aria-label="Edit memory" title="Edit">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={cn(iconBtnDanger, "h-7 w-7")} onClick={() => void remove()} disabled={busy} aria-label="Forget memory" title="Forget">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

export function MemoryPanel({
  memories,
  onChange,
  onClose,
}: {
  memories: AssistantMemory[];
  onChange: (next: AssistantMemory[]) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<MemoryKind>("goal");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function add() {
    if (!content.trim()) return;
    setSaving(true);
    try {
      const { memory, duplicate } = await api<{ memory: AssistantMemory; duplicate: boolean }>("/api/assistant/memories", {
        method: "POST",
        body: JSON.stringify({ content, kind }),
      });
      if (!duplicate) onChange([memory, ...memories]);
      else toast({ kind: "info", title: "Already remembered" });
      setContent("");
    } catch (e) {
      toast({ kind: "error", title: "Could not save the memory", body: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const grouped = ORDER.map((k) => ({ kind: k, items: memories.filter((m) => m.kind === k) })).filter((g) => g.items.length);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Assistant memory">
      <button type="button" className="absolute inset-0 bg-black/30" onClick={onClose} aria-label="Close memory" />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-display text-base font-semibold text-text">
              <Brain className="h-4 w-4 text-accent" aria-hidden /> Memory
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              What the assistant remembers about you and uses in every chat. It adds to this when you tell it something worth
              keeping. Only you can see these.
            </p>
          </div>
          <button type="button" className={iconBtn} onClick={onClose} aria-label="Close" title="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-2 border-b border-border px-5 py-4">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="e.g. My target is 10 closed websites a month"
            className={inputCls}
            aria-label="New memory"
          />
          <div className="flex items-center gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)} className={cn(inputCls, "w-auto")} aria-label="Kind">
              {MEMORY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <button type="button" className={cn(btnPrimary, "ml-auto")} onClick={() => void add()} disabled={saving || !content.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} Remember
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          {grouped.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-text-faint">Nothing yet. Tell the assistant your goals and how you like to work.</p>
          ) : (
            grouped.map((g) => (
              <section key={g.kind} className="mb-4">
                <h3 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-faint">{KIND_LABEL[g.kind]}</h3>
                <ul className="space-y-0.5">
                  {g.items.map((m) => (
                    <MemoryRow
                      key={m.id}
                      memory={m}
                      onChange={(next) => onChange(memories.map((x) => (x.id === next.id ? next : x)))}
                      onRemove={(id) => onChange(memories.filter((x) => x.id !== id))}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
        <footer className="border-t border-border px-5 py-3">
          <button type="button" className={cn(btnSecondarySm, "w-full")} onClick={onClose}>
            Done
          </button>
        </footer>
      </aside>
    </div>
  );
}
