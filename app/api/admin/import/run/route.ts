import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { readSheet } from "@/lib/import/sheets";
import { mapRow } from "@/lib/import/map";
import { isReadyGuardError, READY_GUARD_MESSAGE } from "@/lib/leads/errors";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    return NextResponse.json({ error: "Could not load existing leads/agents for dedupe — import aborted." }, { status: 500 });
  }
  const seen = new Set((existing ?? []).map((l) => dedupeKey(l.business_name, l.business_phone)));
  const agentByName = new Map((profiles ?? []).map((p) => [String(p.display_name ?? "").trim().toLowerCase(), p.id]));

  const inserts: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const m = mapRow(row, parsed.data.mapping);
    if (!m) { skipped++; continue; }
    const key = dedupeKey(m.lead.business_name, m.lead.business_phone);
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const agent_id = m.agentName ? agentByName.get(m.agentName.trim().toLowerCase()) ?? null : null;
    inserts.push({ ...m.lead, agent_id, created_by: user.id });
  }

  let imported = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (let i = 0; i < inserts.length; i += 200) {
    const chunk = inserts.slice(i, i + 200);
    const { error } = await admin.from("leads").insert(chunk);
    if (error) {
      // Don't abort the batch on a Ready-guard violation (or any other row
      // error) — count the chunk as failed and keep importing the rest.
      failed += chunk.length;
      const message = isReadyGuardError(error) ? READY_GUARD_MESSAGE : error.message;
      if (!firstError) firstError = message;
    } else {
      imported += chunk.length;
    }
  }

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "leads.imported",
    entity_type: "lead",
    new_value: { imported, skipped, failed, source: parsed.data.tab },
  });

  return NextResponse.json({ imported, skipped, failed, error: firstError ?? undefined });
}
