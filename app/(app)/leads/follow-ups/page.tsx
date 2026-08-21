import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { FollowUpQueue } from "@/components/leads/FollowUpQueue";
import type { Lead } from "@/lib/leads/types";
import { getUserDirectory } from "@/lib/users/directory";

export default async function FollowUpsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.view")) redirect("/leads");

  const { data: leadsData } = await supabase
    .from("leads")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const leads = (leadsData ?? []) as Lead[];

  const agents = await getUserDirectory();
  const agentNameById: Record<string, string> = {};
  for (const a of agents ?? []) agentNameById[a.id] = a.display_name ?? "—";

  return <FollowUpQueue leads={leads} agentNameById={agentNameById} />;
}
