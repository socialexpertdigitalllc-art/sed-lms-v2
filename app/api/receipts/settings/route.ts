import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/receipts/guard";
import { receiptSettingsSchema } from "@/lib/receipts/schema";
import { getReceiptSettings, receiptSenderAddress } from "@/lib/receipts/settings";

export const runtime = "nodejs";

/** Signer name + sending mailbox for receipts. Managed by whoever manages payments. */
export async function GET() {
  const auth = await requirePermission("payments.manage");
  if ("response" in auth) return auth.response;
  const [settings, sender] = await Promise.all([getReceiptSettings(), receiptSenderAddress()]);
  return NextResponse.json({ settings, sender });
}

export async function PUT(req: Request) {
  const auth = await requirePermission("payments.manage");
  if ("response" in auth) return auth.response;

  const parsed = receiptSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 422 });
  }

  const admin = createAdminClient();
  if (parsed.data.mailbox_id) {
    const { data: mb } = await admin
      .from("company_mailboxes")
      .select("id, status")
      .eq("id", parsed.data.mailbox_id)
      .maybeSingle();
    if (!mb) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
    if (mb.status !== "verified") return NextResponse.json({ error: "That mailbox is not verified yet" }, { status: 409 });
  }

  const { error } = await admin
    .from("app_settings")
    .update({ receipt_signer_name: parsed.data.signer_name, receipt_mailbox_id: parsed.data.mailbox_id })
    .eq("singleton", true);
  if (error) {
    // 42703 = the 0085 columns don't exist yet.
    const pending = /receipt_signer_name|receipt_mailbox_id|42703/.test(`${error.code} ${error.message}`);
    return NextResponse.json(
      { error: pending ? "Receipts aren't set up in the database yet (migration 0085)." : error.message },
      { status: pending ? 409 : 400 }
    );
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "receipt.settings_updated",
    entity_type: "app_settings",
    new_value: parsed.data,
  });

  const [settings, sender] = await Promise.all([getReceiptSettings(), receiptSenderAddress()]);
  return NextResponse.json({ settings, sender });
}
