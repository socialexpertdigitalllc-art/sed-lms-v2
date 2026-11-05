import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { sentContractLeadIds } from "@/lib/contracts/badge";
import type { LeadTag } from "@/lib/leads/types";
import { getUserDirectory } from "@/lib/users/directory";
import { getTeamAgentIds } from "@/lib/teams/closers";
import { loadHitlist, type HitlistMap } from "@/lib/hitlist/store";

/** department_members joined to profiles, as the select below returns it. */
type MemberRow = { profiles: { id: string; display_name: string | null } | null };

/**
 * Everything the leads table needs EXCEPT the leads, shared by /leads and
 * /hitlist. The leads themselves come from the live leads store in the browser
 * (hooks/useLiveLeads.ts): read once, then only what changes — so this page
 * render stays small however many leads there are and however often they
 * change. The hit list (lead id → stars) is only loaded for hitlist.view.
 */
export async function loadLeadsTableData() {
  const supabase = await createClient();
  const admin = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const perms = user ? await getUserPermissions(user.id) : new Set<string>();
  const canViewHitlist = perms.has("hitlist.view") || perms.has("hitlist.manage");
  const canManageHitlist = perms.has("hitlist.manage");

  // Independent reads fire together. `department_members` still follows because
  // it depends on the resolved `salesDept.id`.
  const [hitlist, agents, { data: salesDept }, { data: tagsData }, teamAgentIds, { data: sentRows }] =
    await Promise.all([
      canViewHitlist ? loadHitlist(admin) : Promise.resolve(undefined as HitlistMap | undefined),
      getUserDirectory(),
      supabase.from("departments").select("id").eq("slug", "sales").single(),
      supabase.from("lead_tags").select("id, name, color, owner_id").order("name"),
      // Sales agents reporting to this viewer — empty unless they are a closer.
      // Drives the "My team" scope on the table (migration 0069).
      user ? getTeamAgentIds(admin, user.id) : Promise.resolve([] as string[]),
      admin.from("contracts").select("lead_id, status").eq("status", "sent"),
    ]);

  const agentNameById: Record<string, string> = {};
  for (const a of agents ?? []) agentNameById[a.id] = a.display_name ?? "—";

  // Sales-department members — the only valid targets for bulk assignment.
  let salesAgents: { id: string; name: string }[] = [];
  if (salesDept) {
    const { data: members } = await supabase
      .from("department_members")
      .select("user_id, profiles!department_members_user_id_fkey(id, display_name)")
      .eq("department_id", salesDept.id);
    salesAgents = ((members ?? []) as unknown as MemberRow[])
      .map((m) => ({ id: m.profiles?.id ?? "", name: m.profiles?.display_name ?? "—" }))
      .filter((u) => u.id);
  }

  // Tag catalog — RLS returns [] without leads.tags.view/manage.
  const tags = (tagsData ?? []) as LeadTag[];
  const canManageTags = perms.has("leads.tags.manage");

  return {
    user,
    canViewHitlist,
    props: {
      agentNameById,
      salesAgents,
      tags,
      canViewTags: canManageTags || perms.has("leads.tags.view"),
      canManageTags,
      canShareTags: perms.has("leads.tags.share"),
      currentUserId: user?.id ?? "",
      contractSentLeadIds: Array.from(sentContractLeadIds(sentRows ?? [])),
      teamAgentIds,
      hitlist,
      canManageHitlist,
    },
  };
}
