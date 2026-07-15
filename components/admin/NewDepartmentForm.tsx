"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
import { useToast } from "@/components/common/Toast";

const inputCls =
  "w-full px-3 py-2 rounded-md border border-border bg-surface text-sm text-text outline-none focus:ring-2 focus:ring-accent";
const labelCls = "block text-xs font-semibold uppercase tracking-wide text-text-faint mb-1";

export function NewDepartmentForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#0D9488");
  const [busy, setBusy] = useState(false);

  function close() {
    if (busy) return;
    setOpen(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          description: description.trim() || undefined,
          color,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: json.error ?? "Failed to create department" });
        return;
      }
      toast({ kind: "success", title: "Department created" });
      setName("");
      setDescription("");
      setColor("#0D9488");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-ink"
      >
        <Plus className="w-4 h-4" /> New department
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/30 grid place-items-center z-50 p-4">
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
            className="bg-surface border border-border rounded-lg p-6 w-full max-w-[440px] max-h-[90vh] overflow-auto"
          >
            <h2 className="font-semibold text-text mb-4">New department</h2>

            <div className="mb-3">
              <label className={labelCls}>Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Closing"
                maxLength={60}
                autoFocus
                className={inputCls}
              />
            </div>

            <div className="mb-3">
              <label className={labelCls}>Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this department does"
                rows={2}
                maxLength={200}
                className={inputCls}
              />
            </div>

            <div className="mb-4">
              <label className={labelCls}>Color</label>
              <div className="flex items-center gap-2.5">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  aria-label="Department color"
                  className="h-9 w-12 cursor-pointer rounded-md border border-border bg-surface p-1"
                />
                <span className="font-mono text-xs text-text-muted">{color}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="px-4 py-2 text-sm rounded-md border border-border text-text-muted hover:bg-surface-2 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                disabled={busy || !name.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {busy ? "Creating…" : "Create department"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
