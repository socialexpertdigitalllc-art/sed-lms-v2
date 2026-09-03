"use client";

import { useEffect, useState } from "react";
import { Info, LayoutTemplate, Loader2 } from "lucide-react";
import { TemplateCard, type TemplateCardRow } from "@/components/site-builder/TemplateCard";

/**
 * The template the agent picks WITH the client, on the call.
 *
 * Only in-service templates are offered — the switch on the templates board
 * is the whole gate, and an out-of-service template is absent here rather
 * than shown disabled, so nobody asks why they cannot pick it.
 */
export function TemplateRecommendation({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [templates, setTemplates] = useState<TemplateCardRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/site-builder/templates?in_service=1");
        if (!res.ok) throw new Error("load failed");
        const body = await res.json();
        if (!cancelled) {
          setTemplates((body.templates ?? []) as TemplateCardRow[]);
          setState("ready");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      {/* Not every agent can judge which template suits a business, and a bad
          pick is discovered late — at build time, by someone else. Saying so
          plainly is cheaper than the rework. */}
      <div className="mb-3 flex items-start gap-2 rounded-md border border-accent/40 bg-accent-soft/40 px-3 py-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="text-xs leading-relaxed text-text">
          <span className="font-medium">Not sure which one fits?</span> Check with your closer before
          you choose. They have seen how these templates land for different trades, and picking with
          them now saves rebuilding the site later.
        </p>
      </div>

      {state === "loading" && (
        <p className="flex items-center gap-2 py-6 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading templates…
        </p>
      )}

      {state === "error" && (
        <p className="rounded-md border border-border bg-surface-2 px-3 py-4 text-sm text-text-muted">
          Could not load the templates. Refresh the page to try again.
        </p>
      )}

      {state === "ready" && templates.length === 0 && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-4 text-sm text-text-muted">
          <LayoutTemplate className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
          No templates are in service yet. Ask an admin to put one in service on the Site Builder
          templates board.
        </div>
      )}

      {state === "ready" && templates.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              selected={value === t.id}
              onSelect={() => onChange(value === t.id ? "" : t.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
