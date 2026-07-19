import type { ContractSnapshot } from "@/lib/contracts/types";
import { formatUsd } from "@/lib/contracts/merge";
import { SERVICE_PROVIDER } from "@/lib/contracts/provider";

/** All tokens the merge engine knows how to fill (see design A4). */
export const SUPPORTED_PLACEHOLDERS = [
  "{{business_name}}",
  "{{business_phone}}",
  "{{business_email}}",
  "{{one_time_price}}",
  "{{yearly_price}}",
  "{{date}}",
  "{{agent_name}}",
  "{{provider_name}}",
  "{{provider_phone}}",
  "{{provider_email}}",
] as const;

/** Unique `{{token}}` strings in first-seen order (whitespace-tolerant). */
export function extractPlaceholders(text: string): string[] {
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = `{{${m[1]}}}`;
    if (!seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

/** Map supported tokens → formatted snapshot values (design A4). */
export function buildReplacements(s: ContractSnapshot): { token: string; value: string }[] {
  return [
    { token: "{{business_name}}", value: s.business_name || "" },
    { token: "{{business_phone}}", value: s.business_phone || "" },
    { token: "{{business_email}}", value: s.business_email || "" },
    { token: "{{one_time_price}}", value: formatUsd(s.one_time_price) },
    { token: "{{yearly_price}}", value: formatUsd(s.yearly_price) },
    { token: "{{date}}", value: s.contract_date },
    { token: "{{agent_name}}", value: s.agent_name || "" },
    { token: "{{provider_name}}", value: SERVICE_PROVIDER.name },
    { token: "{{provider_phone}}", value: SERVICE_PROVIDER.phone },
    { token: "{{provider_email}}", value: SERVICE_PROVIDER.email },
  ];
}

/** Tokens a template uses that we can't fill — surfaced in the UI as "unmapped". */
export function unmappedPlaceholders(found: string[]): string[] {
  const supported = new Set<string>(SUPPORTED_PLACEHOLDERS);
  return found.filter((t) => !supported.has(t));
}
