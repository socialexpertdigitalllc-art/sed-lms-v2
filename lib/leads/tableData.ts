import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { sentContractLeadIds } from "@/lib/contracts/badge";
import type { Lead, LeadTag } from "@/lib/leads/types";
import { getUserDirectory } from "@/lib/users/directory";
import { getTeamAgentIds } from "@/lib/teams/closers";
import { loadHitlist, type HitlistMap } from "@/lib/hitlist/store";

/**
 * Everything the leads table needs, shared by /leads and /hitlist. Leads are
 * read through RLS (the viewer's own scope). The hit list (lead id → stars)
 * is only loaded for hitlist.view; `hitlistOnly` narrows the leads to it.
 */
export async function loadLeadsTableData({ hitlistOnly = false }: { hitlistOnly?: boolean } = {}) {
  const supabase = await createClient();
  const admin = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const perms = user ? await getUserPermissions(user.id) : new Set<string>();
  const canViewHitlist = perms.has("hitlist.view") || perms.has("hitlist.manage");
  const canManageHitlist = perms.has("hitlist.manage");
  const hitlistP: Promise<HitlistMap | undefined> = canViewHitlist ? loadHitlist(admin) : Promise.resolve(undefined);

  let leadsQuery = supabase
    .from("leads")
    .select("*, lead_tag_links(tag_id)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (hitlistOnly) {
    // The HitList tab reads only the starred leads, so it needs the ids first.
    const ids = Object.keys((await hitlistP) ?? {});
    leadsQuery = leadsQuery.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }

  // Independent reads fire together. `department_members` still follows because
  // it depends on the resolved `salesDept.id`.
  const [{ data: leadsData }, hitlist, agents, { data: salesDept }, { data: tagsData }, teamAgentIds, { data: sentRows }] =
    await Promise.all([
      leadsQuery,
      hitlistP,
      getUserDirectory(),
      supabase.from("departments").select("id").eq("slug", "sales").single(),
      supabase.from("lead_tags").select("id, name, color, owner_id").order("name"),
      // Sales agents reporting to this viewer — empty unless they are a closer.
      // Drives the "My team" scope on the table (migration 0069).
      user ? getTeamAgentIds(admin, user.id) : Promise.resolve([] as string[]),
      admin.from("contracts").select("lead_id, status").eq("status", "sent"),
    ]);

  // Flatten the embedded links into `tag_ids` and drop the nested field.
  // For users without a tag permission, RLS returns no link rows → `tag_ids: []`.
  type LeadRow = Omit<Lead, "tag_ids"> & { lead_tag_links?: { tag_id: string }[] | null };
  const leads: Lead[] = ((leadsData ?? []) as LeadRow[]).map((row) => {
    const { lead_tag_links, ...rest } = row;
    return { ...rest, tag_ids: (lead_tag_links ?? []).map((l) => l.tag_id) } as Lead;
  });

  const agentNameById: Record<string, string> = {};
  for (const a of agents ?? []) agentNameById[a.id] = a.display_name ?? "—";

  // Sales-department members — the only valid targets for bulk assignment.
  let salesAgents: { id: string; name: string }[] = [];
  if (salesDept) {
    const { data: members } = await supabase
      .from("department_members")
      .select("user_id, profiles!department_members_user_id_fkey(id, display_name)")
      .eq("department_id", salesDept.id);
    type MemberRow = { profiles: { id: string; display_name: string | null } | null };
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
      leads,
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
