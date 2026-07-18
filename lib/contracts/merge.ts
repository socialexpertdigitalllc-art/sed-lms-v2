import type { Lead } from "@/lib/leads/types";
import type { ContractSnapshot } from "@/lib/contracts/types";

/** Coerce a price (number or string like "$1,200.50") to a positive number, else null. */
export function parsePrice(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Snapshot the lead's mergeable fields at contract-creation time. */
export function buildContractSnapshot(
  lead: Lead,
  opts: { agentName: string; contractDate: string }
): ContractSnapshot {
  return {
    business_name: lead.business_name ?? "",
    business_phone: lead.business_phone ?? null,
    business_email: lead.business_email ?? null,
    one_time_price: parsePrice(lead.price_quoted),
    yearly_price: parsePrice(lead.yearly_price),
    agent_name: opts.agentName,
    contract_date: opts.contractDate,
  };
}

/** Gate before preview: every required merge field must be present. */
export function validateMergeFields(lead: Lead): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!lead.business_name?.trim()) missing.push("Business name");
  if (!lead.business_email?.trim()) missing.push("Business email");
  if (parsePrice(lead.price_quoted) === null) missing.push("One-time price");
  return { ok: missing.length === 0, missing };
}

export function formatUsd(n: number | null): string {
  return n === null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Labelled display lines the PDF body renders (pure — asserted in tests). */
export function contractLines(s: ContractSnapshot): { label: string; value: string }[] {
  return [
    { label: "Business", value: s.business_name || "—" },
    { label: "Phone", value: s.business_phone || "—" },
    { label: "Email", value: s.business_email || "—" },
    { label: "One-time price", value: formatUsd(s.one_time_price) },
    { label: "Yearly price", value: formatUsd(s.yearly_price) },
    { label: "Prepared by", value: s.agent_name || "—" },
    { label: "Date", value: s.contract_date },
  ];
}
