import { redirect } from "next/navigation";
import Link from "next/link";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/common/Panel";
import { btnSecondary } from "@/components/common/buttons";
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
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Contracts"
        description="Every contract created or sent across your leads. New contracts start from a lead."
        action={
          <Link href="/leads" className={btnSecondary}>
            <Users className="h-4 w-4" /> Go to leads
          </Link>
        }
      />
      <ContractsList contracts={contracts} />
    </div>
  );
}
