import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mapLeadToInput } from "@/lib/ai-tools/leadPrefill";
import { getWgeConfig } from "@/lib/ai-tools/wge";

export const runtime = "nodejs";

// Returns generator form fields prefilled from a lead. RLS scopes which leads
// the caller can read, so no extra permission check is needed here.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const leadId = searchParams.get("lead");
  if (!leadId) return NextResponse.json({ error: "Missing lead id" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .is("deleted_at", null)
    .single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Use the saved WGE variable mappings so prefill matches actual generation.
  const config = await getWgeConfig();
  return NextResponse.json({ businessName: lead.business_name, fields: mapLeadToInput(lead, config.variables) });
}
