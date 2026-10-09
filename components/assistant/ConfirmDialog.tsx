"use client";

import { useEffect, useId, useRef } from "react";
import { btnSecondary } from "@/components/common/buttons";
import { cn } from "@/lib/utils";

/** A small in-app "are you sure?" for destructive actions. Escape cancels. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="animate-in w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-2xl">
        <h2 id={titleId} className="font-display text-base font-semibold text-text">
          {title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" className={btnSecondary} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex items-center justify-center rounded-md bg-danger px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90",
            )}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
