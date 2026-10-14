import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { ActionsCenter } from "@/components/assistant/ActionsCenter";

export const metadata = { title: "SED AI actions" };

/**
 * Everything SED AI did (or was asked to do) for the person — with Undo while
 * it is still possible — and, for people who manage SED AI: requests waiting
 * for approval, the action report, the per-action switches, and their own
 * automations (reminders, standing rules, handovers, phone link).
 */
export default async function AssistantActionsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  const canAct = perms.has("assistant.act");
  const canManage = perms.has("assistant.actions.manage");
  if (!canAct && !canManage) redirect("/assistant");
  const { tab } = await searchParams;
  return <ActionsCenter canAct={canAct} canManage={canManage} initialTab={tab ?? (canAct ? "mine" : "approvals")} />;
}
