import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { NewLeadForm } from "@/components/leads/NewLeadForm";

export default async function NewLeadPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.create")) redirect("/leads");

  const { data: agents } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("is_active", true)
    .order("display_name");

  return <NewLeadForm agents={agents ?? []} />;
}
