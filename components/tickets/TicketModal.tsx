"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  TICKET_CATEGORIES,
  TICKET_SIGNATURES,
  TICKET_PRIORITIES,
  type TicketCategory,
  type TicketSignature,
  type TicketPriority,
} from "@/lib/tickets/types";
import { RadioPillGroup } from "@/components/forms/RadioPillGroup";
import { DynamicList } from "@/components/forms/DynamicList";
import { inputCls } from "@/components/forms/Field";

export function TicketModal({
  leadId,
  hasCloser,
  onClose,
}: {
  leadId: string;
  hasCloser: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<TicketCategory>("Changes");
  const [signature, setSignature] = useState<TicketSignature>("Agent");
  const [priority, setPriority] = useState<TicketPriority>("Normal");
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);

  // "Closer" only makes sense once the lead has a closer — hide the pill and fall
  // back to "Agent" otherwise (defensive: covers a stale "Closer" selection too).
  const signatureOptions = hasCloser ? TICKET_SIGNATURES : (["Agent"] as const);
  const signatureValue = hasCloser ? signature : "Agent";

  const labelCls = "block text-[10px] uppercase tracking-wide text-text-faint mb-1";

  async function save() {
    const nonEmptyItems = items.map((s) => s.trim()).filter(Boolean);
    if (nonEmptyItems.length === 0) {
      setItemsError("Add at least one change item.");
      return;
    }
    setItemsError(null);
    setBusy(true);
    setApiError(null);
    const res = await fetch(`/api/leads/${leadId}/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category,
        signature: signatureValue,
        priority,
        title: title.trim() || null,
        items: nonEmptyItems,
      }),
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
            <label className={labelCls}>Change items</label>
            <DynamicList
              values={items}
              onChange={(v) => {
                setItems(v);
                if (itemsError) setItemsError(null);
              }}
              placeholder="Describe one change…"
              addLabel="Add item"
            />
            {itemsError && <p className="text-[11px] text-dropped-fg mt-1">{itemsError}</p>}
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
