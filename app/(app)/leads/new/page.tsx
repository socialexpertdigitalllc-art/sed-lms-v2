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

  const canAssign = perms.has("leads.assign");
  const canSetStatus = perms.has("leads.set_status");

  // Only load the agent list when the user may actually assign to others.
  const { data: agents } = canAssign
    ? await supabase
        .from("profiles")
        .select("id, display_name")
        .eq("is_active", true)
        .order("display_name")
    : { data: [] };

  // Sales-department members for the "Closed by" picker (two FKs to profiles → must pin the FK).
  const { data: salesDept } = await supabase
    .from("departments")
    .select("id")
    .eq("slug", "sales")
    .single();
  let salesUsers: { id: string; display_name: string }[] = [];
  if (salesDept) {
    const { data: members } = await supabase
      .from("department_members")
      .select("user_id, profiles!department_members_user_id_fkey(id, display_name)")
      .eq("department_id", salesDept.id);
    salesUsers = (members ?? [])
      .map((m: any) => ({ id: m.profiles?.id, display_name: m.profiles?.display_name }))
      .filter((u: any) => u.id);
  }

  // Active website add-ons for the offer picker.
  const { data: addons } = await supabase
    .from("website_addons")
    .select("id,label,price")
    .eq("is_active", true)
    .order("sort");

  return (
    <NewLeadForm
      agents={agents ?? []}
      canAssign={canAssign}
      canSetStatus={canSetStatus}
      salesUsers={salesUsers}
      addons={addons ?? []}
      currentUserId={user.id}
    />
  );
}
