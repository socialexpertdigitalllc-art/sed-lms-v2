"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TICKET_CATEGORIES,
  TICKET_SIGNATURES,
  TICKET_PRIORITIES,
  type TicketCategory,
  type TicketSignature,
  type TicketPriority,
} from "@/lib/tickets/types";
import { slaDueDate } from "@/lib/tickets/logic";
import { RadioPillGroup } from "@/components/forms/RadioPillGroup";
import { inputCls } from "@/components/forms/Field";

type ItemDraft = { body: string; files: File[] };

const MAX_FILES_PER_ITEM = 5;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** ISO datetime string -> `datetime-local` input value, in local time. */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function TicketModal({
  leadId,
  sla,
  onClose,
}: {
  leadId: string;
  sla: Record<TicketPriority, number>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<TicketCategory>("Changes");
  const [signature, setSignature] = useState<TicketSignature>("Agent");
  const [priority, setPriority] = useState<TicketPriority>("Normal");
  const [title, setTitle] = useState("");
  // Pre-filled from the SLA on mount (using the initial `priority`); re-derived
  // below whenever priority changes, unless the user has edited it by hand.
  const [dueDate, setDueDate] = useState(() => toLocalInput(slaDueDate(priority, sla, new Date().toISOString())));
  const [dueTouched, setDueTouched] = useState(false);
  const [items, setItems] = useState<ItemDraft[]>([{ body: "", files: [] }]);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Keep the due date in sync with the SLA for the selected priority — but only
  // until the user manually edits the field, at which point their edit sticks.
  useEffect(() => {
    if (dueTouched) return;
    setDueDate(toLocalInput(slaDueDate(priority, sla, new Date().toISOString())));
  }, [priority, sla, dueTouched]);

  const signatureOptions = TICKET_SIGNATURES;
  const signatureValue = signature;

  const labelCls = "block text-[10px] uppercase tracking-wide text-text-faint mb-1";

  function updateItemBody(i: number, body: string) {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, body } : it)));
    if (itemsError) setItemsError(null);
  }

  function addItem() {
    setItems((prev) => [...prev, { body: "", files: [] }]);
  }

  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, j) => j !== i));
  }

  function addFiles(i: number, fileList: FileList | null) {
    const incoming = Array.from(fileList ?? []);
    if (!incoming.length) return;
    const room = MAX_FILES_PER_ITEM - items[i].files.length;
    const accepted: File[] = [];
    let message: string | null = null;
    for (const f of incoming) {
      if (accepted.length >= room) {
        message = `Up to ${MAX_FILES_PER_ITEM} images per item.`;
        break;
      }
      if (f.size > MAX_FILE_BYTES) {
        message = `"${f.name}" is over 5 MB and was skipped.`;
        continue;
      }
      accepted.push(f);
    }
    setFileError(message);
    if (accepted.length) {
      setItems((prev) => prev.map((it, j) => (j === i ? { ...it, files: [...it.files, ...accepted] } : it)));
    }
  }

  function removeFile(i: number, fileIdx: number) {
    setItems((prev) =>
      prev.map((it, j) => (j === i ? { ...it, files: it.files.filter((_, k) => k !== fileIdx) } : it))
    );
  }

  async function save() {
    const nonEmpty = items.filter((it) => it.body.trim());
    if (!nonEmpty.length) {
      setItemsError("Add at least one change item.");
      return;
    }
    setItemsError(null);
    setBusy(true);
    setApiError(null);
    const fd = new FormData();
    fd.append(
      "payload",
      JSON.stringify({
        category,
        signature: signatureValue,
        priority,
        title: title.trim() || null,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        items: nonEmpty.map((it) => it.body.trim()),
      })
    );
    // The FormData key index MUST be the post-filter index (sortIdx) — it has
    // to match the item `sort` the server assigns to the parallel items array.
    nonEmpty.forEach((it, sortIdx) => it.files.forEach((f) => fd.append(`item_${sortIdx}`, f)));
    const res = await fetch(`/api/leads/${leadId}/tickets`, {
      method: "POST",
      body: fd, // no Content-Type header — the browser sets the multipart boundary
    });
    setBusy(false);
    if (!res.ok) {
      setApiError((await res.json().catch(() => ({}))).error ?? "Failed to create ticket");
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/30 grid place-items-center z-50 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-border rounded-lg p-6 w-[440px] max-h-[90vh] overflow-auto"
      >
        <h2 className="font-semibold text-text">New ticket</h2>
        <p className="text-sm text-text-muted mt-1 mb-4">Log a change or improvement request for this lead</p>

        {apiError && (
          <div className="mb-3 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">
            {apiError}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className={labelCls}>Category</label>
            <RadioPillGroup
              options={TICKET_CATEGORIES}
              value={category}
              onChange={(v) => setCategory(v as TicketCategory)}
            />
          </div>

          <div>
            <label className={labelCls}>Signature</label>
            <RadioPillGroup
              options={signatureOptions}
              value={signatureValue}
              onChange={(v) => setSignature(v as TicketSignature)}
            />
          </div>

          <div>
            <label className={labelCls}>Priority</label>
            <RadioPillGroup
              options={TICKET_PRIORITIES}
              value={priority}
              onChange={(v) => setPriority(v as TicketPriority)}
            />
          </div>

          <div>
            <label className={labelCls}>Title (optional)</label>
            <input
              type="text"
              className={inputCls}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short summary…"
            />
          </div>

          <div>
            <label className={labelCls}>Due date (optional)</label>
            <input
              type="datetime-local"
              className={inputCls}
              value={dueDate}
              onChange={(e) => {
                setDueTouched(true);
                setDueDate(e.target.value);
              }}
            />
          </div>

          <div>
            <label className={labelCls}>Change items</label>
            <div className="space-y-2.5">
              {items.map((it, i) => (
                <div key={i} className="rounded-md border border-border p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={it.body}
                      onChange={(e) => updateItemBody(i, e.target.value)}
                      placeholder="Describe one change…"
                      className={"flex-1 " + inputCls}
                    />
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(i)}
                        className="text-xs text-text-muted border border-border rounded-md px-2.5 py-2 hover:bg-dropped-bg hover:text-dropped-fg whitespace-nowrap"
                      >
                        ✕ Remove
                      </button>
                    )}
                  </div>

                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      addFiles(i, e.target.files);
                      e.target.value = ""; // allow re-selecting the same file later
                    }}
                    className="block w-full text-xs text-text-muted file:mr-2 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-2 file:py-1 file:text-xs file:text-text file:cursor-pointer"
                  />

                  {it.files.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {it.files.map((f, fi) => (
                        <span
                          key={fi}
                          className="inline-flex items-center gap-1 text-[11px] bg-surface-2 border border-border rounded-full pl-2 pr-1 py-0.5 text-text-muted"
                        >
                          {f.name}
                          <button
                            type="button"
                            onClick={() => removeFile(i, fi)}
                            aria-label={`Remove ${f.name}`}
                            className="text-text-faint hover:text-dropped-fg leading-none px-0.5"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addItem}
              className="mt-2 text-sm text-accent-ink font-medium border border-dashed border-accent rounded-md px-3 py-1.5 hover:bg-accent-soft"
            >
              + Add item
            </button>
            {itemsError && <p className="text-[11px] text-dropped-fg mt-1">{itemsError}</p>}
            {fileError && <p className="text-[11px] text-dropped-fg mt-1">{fileError}</p>}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md border border-border text-text-muted hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60"
          >
            {busy ? "Saving…" : "Create ticket"}
          </button>
        </div>
      </div>
    </div>
  );
}
