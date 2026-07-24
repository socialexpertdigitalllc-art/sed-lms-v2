import type { Diagnostic, TemplateManifest } from "../schema";

export const STUDIO_STATUSES = ["uploaded", "needs_review", "certified", "rejected", "disabled"] as const;
export type StudioTemplateStatus = (typeof STUDIO_STATUSES)[number];

/** What the generic /status route may do. Compile owns uploaded→needs_review;
 *  the certify route owns needs_review→certified (it checks blockers first). */
const ALLOWED: Record<string, StudioTemplateStatus[]> = {
  needs_review: ["rejected"],
  certified: ["disabled"],
  disabled: ["certified"],
  rejected: ["needs_review"],
};

export function canTransition(from: string, to: string): boolean {
  return (ALLOWED[from] ?? []).includes(to as StudioTemplateStatus);
}

/** The studio_templates row as routes read/write it. */
export interface StudioTemplateRow {
  id: string;
  name: string;
  status: StudioTemplateStatus;
  version: number;
  storage_prefix: string;
  niche_tags: string[];
  manifest: TemplateManifest | null;
  diagnostics: Diagnostic[];
  compiled_at: string | null;
  identity_enriched_at: string | null;
  semantics_enriched_at: string | null;
  certified_by: string | null;
  certified_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
