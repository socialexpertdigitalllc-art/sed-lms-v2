import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { AddPreLeadForm } from "@/components/preleads/AddPreLeadForm";

export default async function NewPreLeadPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("pre_leads.create")) redirect("/pre-leads/all");

  return <AddPreLeadForm canOverrideDuplicate={perms.has("leads.duplicate.override")} />;
}
