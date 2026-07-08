import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findCollisions, type DupRow } from "@/lib/leads/duplicate";
import { z } from "zod";

const schema = z.object({
  business_name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ collisions: [] });

  const admin = createAdminClient();
  const { data: preLeads } = await admin
    .from("pre_leads")
    .select("id, business_name, phone_number, email, agent_id")
    .is("deleted_at", null);

  const ownerIds = [...new Set((preLeads ?? []).map((l) => l.agent_id).filter(Boolean))];
  const { data: profs } = await admin
    .from("profiles")
    .select("id, display_name")
    .in("id", ownerIds.length ? ownerIds : ["00000000-0000-0000-0000-000000000000"]);
  const nameById = new Map((profs ?? []).map((p) => [p.id, p.display_name]));

  const rows: DupRow[] = (preLeads ?? []).map((l) => ({
    id: l.id,
    business_name: l.business_name,
    phone: l.phone_number,
    email: l.email,
    owner: l.agent_id,
    ownerName: l.agent_id ? nameById.get(l.agent_id) ?? null : null,
  }));

  return NextResponse.json({ collisions: findCollisions(parsed.data, rows, user.id) });
}
