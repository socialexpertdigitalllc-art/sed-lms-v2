/** Lead ids that have at least one contract in status 'sent'. Derived — no
 *  lead-column mutation, no pipeline status change. */
export function sentContractLeadIds(rows: { lead_id: string; status: string }[]): Set<string> {
  const s = new Set<string>();
  for (const r of rows) if (r.status === "sent") s.add(r.lead_id);
  return s;
}
