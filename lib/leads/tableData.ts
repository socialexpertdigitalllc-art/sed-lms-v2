import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { sentContractLeadIds } from "@/lib/contracts/badge";
import type { Lead, LeadTag } from "@/lib/leads/types";
import { getUserDirectory } from "@/lib/users/directory";
import { getTeamAgentIds } from "@/lib/teams/closers";
import { loadHitlist, type HitlistMap } from "@/lib/hitlist/store";
import { fetchAllRows } from "@/lib/supabase/fetchAll";

/** A lead row with its embedded tag links, as the select below returns it. */
type LeadRow = Omit<Lead, "tag_ids"> & { lead_tag_links?: { tag_id: string }[] | null };
/** department_members joined to profiles, as the select below returns it. */
type MemberRow = { profiles: { id: string; display_name: string | null } | null };

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

  // The HitList tab reads only the starred leads, so it needs the ids first.
  const onlyIds = hitlistOnly ? Object.keys((await hitlistP) ?? {}) : null;
  // Every page of leads: PostgREST caps one response at 1,000 rows and the
  // table crossed that in Oct 2026 — the newest rows were silently missing.
  const leadsQuery = fetchAllRows<LeadRow>((from, to) => {
    let q = supabase
      .from("leads")
      .select("*, lead_tag_links(tag_id)")
      .is("deleted_at", null);
    if (onlyIds) q = q.in("id", onlyIds.length ? onlyIds : ["00000000-0000-0000-0000-000000000000"]);
    return q.order("created_at", { ascending: false }).order("id").range(from, to);
  });

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
  const leads: Lead[] = (leadsData ?? []).map((row) => {
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
