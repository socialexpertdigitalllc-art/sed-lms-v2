import { z } from "zod";

const INTERACTIVE = 'a, button, [role="button"], [data-track]';

export interface ClickInfo {
  label: string;
  meta: Record<string, string>;
}

// Resolve a clicked element to a tracked label + meta, or null if not interactive.
export function resolveClickTarget(target: Element | null): ClickInfo | null {
  const el = target?.closest?.(INTERACTIVE) ?? null;
  if (!el) return null;
  const raw =
    el.getAttribute("data-track") ||
    el.textContent ||
    el.getAttribute("aria-label") ||
    "";
  const label = raw.replace(/\s+/g, " ").trim().slice(0, 80) || "(unlabeled)";
  const meta: Record<string, string> = {};
  const href = el.getAttribute("href");
  if (href) meta.href = href;
  const leadId = el.getAttribute("data-lead-id");
  if (leadId) meta.leadId = leadId;
  return { label, meta };
}

export const trackBatchSchema = z.object({
  events: z
    .array(
      z.object({
        type: z.enum(["page_view", "click", "focus"]),
        path: z.string().max(300).optional(),
        label: z.string().max(120).optional(),
        meta: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .min(1)
    .max(50),
});

export type TrackBatch = z.infer<typeof trackBatchSchema>;
