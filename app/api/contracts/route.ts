import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { createContractSchema } from "@/lib/contracts/schema";
import { buildContractSnapshot, validateMergeFields } from "@/lib/contracts/merge";
import { isContractTemplateKey } from "@/lib/contracts/templates";
import { buildReplacements } from "@/lib/contracts/placeholders";
import { copyDoc, exportPdf, docUrl } from "@/lib/google/drive";
import { replaceAllText } from "@/lib/google/docs";
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

  const { data: leadRaw } = await admin.from("leads").select("*").eq("id", input.lead_id).is("deleted_at", null).maybeSingle();
  if (!leadRaw) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  const lead = leadRaw as Lead;

  const check = validateMergeFields(lead);
  if (!check.ok) {
    return NextResponse.json({ error: "Missing required fields", missing: check.missing }, { status: 422 });
  }

  const { data: mailbox } = await admin.from("company_mailboxes").select("id, status").eq("id", input.mailbox_id).maybeSingle();
  if (!mailbox) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
  if (mailbox.status !== "verified") return NextResponse.json({ error: "Selected mailbox is not verified" }, { status: 409 });

  const { data: profile } = await admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  const agentName = profile?.display_name ?? "";
  const contractDate = new Date().toISOString().slice(0, 10);
  const snapshot = buildContractSnapshot(lead, { agentName, contractDate });

  // Resolve the Google template (if chosen).
  let googleDocId: string | null = null;
  if (input.google_template_id) {
    const { data: tpl } = await admin
      .from("contract_templates")
      .select("id, google_doc_id")
      .eq("id", input.google_template_id)
      .maybeSingle();
    if (!tpl) return NextResponse.json({ error: "Selected template not found" }, { status: 404 });
    googleDocId = tpl.google_doc_id;
  }

  // Insert the draft first so we own an id for the stored PDF path.
  const { data: contract, error } = await admin
    .from("contracts")
    .insert({
      lead_id: input.lead_id,
      created_by: user.id,
      mailbox_id: input.mailbox_id,
      template_key: input.template_key,
      google_template_id: input.google_template_id ?? null,
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

  // Google path: copy → replaceAllText → export PDF → store. On any failure,
  // delete the just-created draft so we don't leave a broken record.
  if (googleDocId) {
    try {
      const name = `Contract — ${snapshot.business_name || "Client"} — ${contractDate}`;
      const newDocId = await copyDoc(googleDocId, name);
      await replaceAllText(newDocId, buildReplacements(snapshot));
      const pdf = await exportPdf(newDocId);
      const pdfPath = `${contract.id}.pdf`;
      await admin.storage.from("contracts").upload(pdfPath, pdf, { contentType: "application/pdf", upsert: true });
      await admin
        .from("contracts")
        .update({ pdf_path: pdfPath, generated_doc_id: newDocId, generated_doc_url: docUrl(newDocId) })
        .eq("id", contract.id);
      contract.pdf_path = pdfPath;
      contract.generated_doc_id = newDocId;
      contract.generated_doc_url = docUrl(newDocId);
    } catch (e) {
      await admin.from("contracts").delete().eq("id", contract.id);
      return NextResponse.json({ error: `Google template generation failed: ${(e as Error).message}` }, { status: 502 });
    }
  }

  await admin.from("activity_log").insert({
    user_id: user.id, action: "contract.created", entity_type: "contract", entity_id: contract.id,
    new_value: { lead_id: input.lead_id, google: !!googleDocId },
  });

  return NextResponse.json({ contract }, { status: 201 });
}
