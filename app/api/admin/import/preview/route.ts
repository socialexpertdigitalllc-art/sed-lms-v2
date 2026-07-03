import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { readSheet } from "@/lib/import/sheets";
import { mapRow } from "@/lib/import/map";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  sheetId: z.string().trim().min(1),
  tab: z.string().trim().min(1),
  mapping: z.record(z.string(), z.string()),
});

function dedupeKey(name: unknown, phone: unknown) {
  return `${String(name ?? "").trim().toLowerCase()}|${String(phone ?? "").trim()}`;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.import")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 422 });

  let rows: string[][];
  try {
    rows = await readSheet(parsed.data.sheetId, parsed.data.tab);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const admin = createAdminClient();
  const [{ data: existing, error: existErr }, { data: profiles, error: profErr }] = await Promise.all([
    admin.from("leads").select("business_name, business_phone").is("deleted_at", null),
    admin.from("profiles").select("id, display_name"),
  ]);
  if (existErr || profErr) {
    return NextResponse.json({ error: "Could not load existing leads/agents for dedupe." }, { status: 500 });
  }
  const seen = new Set((existing ?? []).map((l) => dedupeKey(l.business_name, l.business_phone)));
  const agentByName = new Set((profiles ?? []).map((p) => String(p.display_name ?? "").trim().toLowerCase()));

  const dataRows = rows.slice(1);
  let valid = 0, invalid = 0, dup = 0;
  const sample: { business_name: string; status: string; agent: string | null; agentMatched: boolean; dup: boolean }[] = [];
  for (const row of dataRows) {
    const m = mapRow(row, parsed.data.mapping);
    if (!m) { invalid++; continue; }
    valid++;
    const key = dedupeKey(m.lead.business_name, m.lead.business_phone);
    const isDup = seen.has(key);
    if (isDup) dup++;
    else seen.add(key); // mirror run(): so intra-sheet repeats count as dups
    const agentMatched = m.agentName ? agentByName.has(m.agentName.trim().toLowerCase()) : true;
    if (sample.length < 20) sample.push({ business_name: String(m.lead.business_name), status: String(m.lead.status), agent: m.agentName, agentMatched, dup: isDup });
  }
  return NextResponse.json({ total: dataRows.length, valid, invalid, dup, newCount: valid - dup, sample });
}
