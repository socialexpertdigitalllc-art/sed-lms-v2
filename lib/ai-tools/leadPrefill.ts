import type { GenInput } from "./prompt";
import type { WgeVariable } from "./wge-types";
import { DEFAULT_VARIABLES } from "./wge-defaults";

type LeadRow = Record<string, unknown>;

// Map a leads row to generator form values using the configured variable mappings.
export function mapLeadToInput(lead: LeadRow, variables: WgeVariable[] = DEFAULT_VARIABLES): Partial<GenInput> {
  const out: Record<string, string> = {};
  for (const v of variables) {
    if (!v.lead_column) continue;
    const raw = lead[v.lead_column];
    if (raw == null) continue;
    out[v.key] = Array.isArray(raw) ? (raw as unknown[]).filter(Boolean).join(v.join) : String(raw);
  }
  return out as Partial<GenInput>;
}
