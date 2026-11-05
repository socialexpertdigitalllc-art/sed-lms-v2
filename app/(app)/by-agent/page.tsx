import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getUserDirectory } from "@/lib/users/directory";
import { ByAgentBoard } from "@/components/leads/ByAgentBoard";

export default async function ByAgentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("analytics.by_agent")) redirect("/dashboard");

  // The leads come from the live leads store in the browser
  // (hooks/useLiveLeads.ts) — read once, then only what changes.
  const agents = await getUserDirectory();
  const nameById: Record<string, string> = {};
  for (const a of agents ?? []) nameById[a.id] = a.display_name ?? "—";

  return <ByAgentBoard nameById={nameById} />;
}
