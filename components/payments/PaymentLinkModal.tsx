"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { PAYMENT_CATEGORIES, type PaymentCategory, type PaymentLink } from "@/lib/payments/types";
import { RadioPillGroup } from "@/components/forms/RadioPillGroup";
import { inputCls } from "@/components/forms/Field";

type FieldErrors = { label?: string; amount?: string; url?: string };

export function PaymentLinkModal({
  initial,
  onClose,
}: {
  initial?: PaymentLink | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const isEdit = !!initial;

  const [label, setLabel] = useState(initial?.label ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [category, setCategory] = useState<PaymentCategory>(initial?.category ?? "Website");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const labelCls = "block text-[10px] uppercase tracking-wide text-text-faint mb-1";

  // Mirrors paymentLinkSchema's rules client-side so the modal can show inline
  // errors before ever hitting the API (the route re-validates regardless).
  function validate(): boolean {
    const errors: FieldErrors = {};
    if (!label.trim()) errors.label = "Label is required.";

    const amountNum = Number(amount);
    if (!amount.trim() || Number.isNaN(amountNum) || amountNum <= 0) {
      errors.amount = "Amount must be greater than 0.";
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl.startsWith("https://")) {
      errors.url = "URL must be https.";
    } else {
      try {
        new URL(trimmedUrl);
      } catch {
        errors.url = "Enter a valid URL.";
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setBusy(true);
    setApiError(null);

    const body = {
      label: label.trim(),
      amount: Number(amount),
      category,
      url: url.trim(),
      notes: notes.trim() || null,
    };

    const res = await fetch(
      isEdit ? `/api/payments/links/${initial!.id}` : "/api/payments/links",
      {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    setBusy(false);
    if (!res.ok) {
      setApiError((await res.json().catch(() => ({}))).error ?? "Failed to save payment link");
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/30 grid place-items-center z-50 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-border rounded-lg p-6 w-full max-w-[440px] max-h-[90vh] overflow-auto"
      >
        <h2 className="font-semibold text-text">{isEdit ? "Edit payment link" : "New payment link"}</h2>
        <p className="text-sm text-text-muted mt-1 mb-4">
          {isEdit ? "Update the details for this link." : "Add a Stripe payment link to the catalog."}
        </p>

        {apiError && (
          <div className="mb-3 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">
            {apiError}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className={labelCls}>Label</label>
            <input
              type="text"
              className={inputCls}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Website $250"
            />
            {fieldErrors.label && (
              <p className="text-[11px] text-dropped-fg mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {fieldErrors.label}
              </p>
            )}
          </div>

          <div>
            <label className={labelCls}>Amount</label>
            <input
              type="number"
              min={1}
              step="0.01"
              className={inputCls}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="250"
            />
            {fieldErrors.amount && (
              <p className="text-[11px] text-dropped-fg mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {fieldErrors.amount}
              </p>
            )}
          </div>

          <div>
            <label className={labelCls}>Category</label>
            <RadioPillGroup
              options={PAYMENT_CATEGORIES}
              value={category}
              onChange={(v) => setCategory(v as PaymentCategory)}
            />
          </div>

          <div>
            <label className={labelCls}>URL</label>
            <input
              type="text"
              className={inputCls}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://buy.stripe.com/…"
            />
            {fieldErrors.url && (
              <p className="text-[11px] text-dropped-fg mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {fieldErrors.url}
              </p>
            )}
          </div>

          <div>
            <label className={labelCls}>Notes (optional)</label>
            <textarea
              className={inputCls}
              rows={2}
              value={notes ?? ""}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes…"
            />
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
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create link"}
          </button>
        </div>
      </div>
    </div>
  );
}
