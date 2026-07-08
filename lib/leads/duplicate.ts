export const normPhone = (s?: string | null) => (s ?? "").replace(/\D/g, "");
export const normEmail = (s?: string | null) => (s ?? "").trim().toLowerCase();
export const normName = (s?: string | null) => (s ?? "").trim().toLowerCase();

export type DupRow = {
  id: string;
  business_name?: string | null;
  phone?: string | null;
  email?: string | null;
  owner?: string | null;
  ownerName?: string | null;
};
export type DupInput = { business_name?: string; phone?: string; email?: string };
export type Collision = {
  field: "business_name" | "phone" | "email";
  ownerDisplayName: string | null;
  isOwn: boolean;
};

export function findCollisions(input: DupInput, rows: DupRow[], currentUserId: string): Collision[] {
  const inName = normName(input.business_name);
  const inPhone = normPhone(input.phone);
  const inEmail = normEmail(input.email);
  const out: Collision[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const checks: [Collision["field"], boolean][] = [
      ["business_name", !!inName && normName(r.business_name) === inName],
      ["phone", !!inPhone && normPhone(r.phone) === inPhone],
      ["email", !!inEmail && normEmail(r.email) === inEmail],
    ];
    for (const [field, hit] of checks) {
      if (hit && !seen.has(field)) {
        seen.add(field);
        out.push({ field, ownerDisplayName: r.ownerName ?? null, isOwn: r.owner === currentUserId });
      }
    }
  }
  return out;
}
