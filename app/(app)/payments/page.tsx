import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { PaymentLinksBoard } from "@/components/payments/PaymentLinksBoard";
import type { PaymentLink } from "@/lib/payments/types";
import { ReceiptSettingsCard } from "@/components/receipts/ReceiptSettingsCard";
import { getReceiptSettings, receiptSenderAddress } from "@/lib/receipts/settings";

export default async function PaymentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("payments.view")) redirect("/dashboard");
  const canManage = perms.has("payments.manage");

  const admin = createAdminClient();

  // Cross-catalog board: bypass RLS via the admin client. Safe because this
  // page is itself gated on `payments.view` above, and non-managers are
  // filtered to active links here — mirrors the GET route's server-side rule.
  const query = admin
    .from("payment_links")
    .select("*")
    .order("category")
    .order("sort")
    .order("created_at");
  const { data } = await (canManage ? query : query.eq("is_active", true));
  const links = (data ?? []) as PaymentLink[];

  // Receipt settings live with payments: same people (Accounts/Admin) manage both.
  let receiptSettings: React.ReactNode = null;
  if (canManage) {
    const [settings, sender, { data: mailboxes }] = await Promise.all([
      getReceiptSettings(),
      receiptSenderAddress(),
      admin.from("company_mailboxes").select("id, email_address").eq("status", "verified").order("email_address"),
    ]);
    receiptSettings = <ReceiptSettingsCard initial={settings} sender={sender} mailboxes={mailboxes ?? []} />;
  }

  return (
    <>
      {receiptSettings}
      <PaymentLinksBoard links={links} canManage={canManage} />
    </>
  );
}
