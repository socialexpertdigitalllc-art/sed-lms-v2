"use client";

import { X } from "lucide-react";
import { useToast } from "@/components/common/Toast";

// Shared plumbing for the Website CMS boards: the collection API calls,
// the "saved + live site pinged" toast convention, and the dialog shell.

export type PublishResult = { ok: true; tags: string[] } | { ok: false; error: string } | null;

export type SaveOutcome =
  | { ok: true; publish: PublishResult }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

async function parseOutcome(res: Response): Promise<SaveOutcome> {
  const json = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, publish: json.publish ?? null };
  return {
    ok: false,
    error: json.error ?? "Something went wrong.",
    fieldErrors: json.issues?.fieldErrors,
  };
}

export async function createRow(collection: string, body: unknown): Promise<SaveOutcome> {
  const res = await fetch(`/api/website/${collection}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseOutcome(res);
}

export async function updateRow(collection: string, id: string, body: unknown): Promise<SaveOutcome> {
  const res = await fetch(`/api/website/${collection}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseOutcome(res);
}

export async function deleteRow(collection: string, id: string): Promise<SaveOutcome> {
  const res = await fetch(`/api/website/${collection}/${id}`, { method: "DELETE" });
  return parseOutcome(res);
}

/** One toast convention for every save: success, plus a heads-up when the live site wasn't pinged. */
export function usePublishToast() {
  const { toast } = useToast();
  return (outcome: SaveOutcome, savedTitle: string) => {
    if (!outcome.ok) {
      toast({ kind: "error", title: outcome.error });
      return;
    }
    if (outcome.publish && !outcome.publish.ok) {
      toast({ kind: "info", title: savedTitle, body: `Live site not updated: ${outcome.publish.error}` });
    } else if (outcome.publish) {
      toast({ kind: "success", title: savedTitle, body: "Live site is updating now." });
    } else {
      toast({ kind: "success", title: savedTitle });
    }
  };
}

export function Dialog({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-lg border border-border bg-surface shadow-xl`}>
        <header className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export const linesToArray = (v: string) =>
  v
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

export const arrayToLines = (v: string[] | null | undefined) => (v ?? []).join("\n");
