import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { createContractSchema } from "@/lib/contracts/schema";
import { buildContractSnapshot, validateMergeFields } from "@/lib/contracts/merge";
import { isContractTemplateKey } from "@/lib/contracts/templates";
import type { Lead } from "@/lib/leads/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("contracts.send")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createContractSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }
  const input = parsed.data;
  if (!isContractTemplateKey(input.template_key)) {
    return NextResponse.json({ error: "Unknown contract template" }, { status: 422 });
  }

  const admin = createAdminClient();

  // Load the lead (admin client — server-gated above).
  const { data: leadRaw } = await admin.from("leads").select("*").eq("id", input.lead_id).is("deleted_at", null).maybeSingle();
  if (!leadRaw) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  const lead = leadRaw as Lead;

  // Merge-field validation gate — block before any draft/preview exists.
  const check = validateMergeFields(lead);
  if (!check.ok) {
    return NextResponse.json({ error: "Missing required fields", missing: check.missing }, { status: 422 });
  }

  // The mailbox must exist and be verified.
  const { data: mailbox } = await admin
    .from("company_mailboxes")
    .select("id, status")
    .eq("id", input.mailbox_id)
    .maybeSingle();
  if (!mailbox) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
  if (mailbox.status !== "verified") return NextResponse.json({ error: "Selected mailbox is not verified" }, { status: 409 });

  const { data: profile } = await admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  const agentName = profile?.display_name ?? "";
  const contractDate = new Date().toISOString().slice(0, 10);
  const snapshot = buildContractSnapshot(lead, { agentName, contractDate });

  const { data: contract, error } = await admin
    .from("contracts")
    .insert({
      lead_id: input.lead_id,
      created_by: user.id,
      mailbox_id: input.mailbox_id,
      template_key: input.template_key,
      business_name: snapshot.business_name,
      business_phone: snapshot.business_phone,
      business_email: snapshot.business_email,
      one_time_price: snapshot.one_time_price,
      yearly_price: snapshot.yearly_price,
      agent_name: snapshot.agent_name,
      contract_date: snapshot.contract_date,
      message_body: input.message_body,
      recipient_email: snapshot.business_email,
      status: "draft",
    })
    .select("*")
    .single();
  if (error || !contract) return NextResponse.json({ error: error?.message ?? "Create failed" }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: user.id, action: "contract.created", entity_type: "contract", entity_id: contract.id,
    new_value: { lead_id: input.lead_id },
  });

  return NextResponse.json({ contract }, { status: 201 });
}
