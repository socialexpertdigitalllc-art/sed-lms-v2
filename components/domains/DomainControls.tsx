"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";

/** On/off switch (same look as the provider switches elsewhere). */
export function Switch({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-55",
        on ? "bg-accent" : "bg-border",
      )}
    >
      <span className={cn("inline-block h-4 w-4 rounded-full bg-surface transition-transform duration-150", on ? "translate-x-6" : "translate-x-1")} />
    </button>
  );
}

/** A modal that states exactly what will happen before it happens. */
export function ConfirmAction({
  title,
  children,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
        <div className="border-b border-border-subtle p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
            {danger ? <AlertTriangle className="h-4 w-4 text-dropped-fg" /> : null}
            {title}
          </h3>
        </div>
        <div className="space-y-2 p-5 text-sm text-text-muted">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle p-4">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60",
              danger ? "bg-dropped-fg hover:opacity-90" : "bg-accent hover:bg-accent-ink",
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export type CallResult<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; error: string; link?: string };

/**
 * fetch + JSON + toasts for the domain page's actions. A refusal that carries
 * a registrar link (e.g. "Cloudflare can't renew over its API") shows it.
 */
export function useDomainCall() {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const call = useCallback(
    async <T = Record<string, unknown>,>(
      key: string,
      url: string,
      init: { method: string; body?: unknown },
      ok?: { title: string; body?: string } | null,
    ): Promise<CallResult<T>> => {
      setBusy(key);
      try {
        const res = await fetch(url, {
          method: init.method,
          headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          const error = (j.error as string) ?? `Failed (HTTP ${res.status})`;
          toast({ kind: "error", title: error, body: j.link ? `Do it on the registrar's site: ${j.link}` : undefined });
          return { ok: false, error, link: j.link };
        }
        if (ok) toast({ kind: "success", title: ok.title, body: ok.body });
        return { ok: true, data: j as T };
      } catch {
        toast({ kind: "error", title: "Network error — check your connection" });
        return { ok: false, error: "network" };
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { call, busy };
}
