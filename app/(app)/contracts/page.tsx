import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { ContractsList } from "@/components/contracts/ContractsList";
import type { ContractListItem, ContractRow } from "@/lib/contracts/types";

export default async function ContractsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("contracts.view") && !perms.has("contracts.send")) redirect("/dashboard");

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("contracts")
    .select("*, leads(business_name)")
    .order("created_at", { ascending: false });

  const contracts: ContractListItem[] = (rows ?? []).map((r: ContractRow & { leads?: { business_name: string } | null }) => ({
    ...r,
    lead_business_name: r.leads?.business_name ?? r.business_name,
  }));

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text">Contracts</h1>
        <p className="text-sm text-text-muted mt-0.5">Every contract created or sent across your leads.</p>
      </div>
      <ContractsList contracts={contracts} />
    </div>
  );
}
