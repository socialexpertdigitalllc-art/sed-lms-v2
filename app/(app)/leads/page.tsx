import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { sentContractLeadIds } from "@/lib/contracts/badge";
import { LeadsTable } from "@/components/leads/LeadsTable";
import type { Lead, LeadTag } from "@/lib/leads/types";

/** A lead row with its embedded tag links, as the select below returns it. */
type LeadRow = Lead & { lead_tag_links: { tag_id: string }[] | null };
/** department_members joined to profiles, as the select below returns it. */
type MemberRow = { profiles: { id: string; display_name: string | null } | null };
import { getUserDirectory } from "@/lib/users/directory";
import { getTeamAgentIds } from "@/lib/teams/closers";
import { fetchAllRows } from "@/lib/supabase/fetchAll";

export default async function LeadsPage() {
  const supabase = await createClient();

  // Independent reads fire together. `department_members` still follows because
  // it depends on the resolved `salesDept.id`.
  const [{ data: leadsData }, agents, { data: salesDept }, { data: tagsData }] =
    await Promise.all([
      // Every page of leads: PostgREST caps one response at 1,000 rows and the
      // table crossed that in Oct 2026 — the newest rows were silently missing.
      fetchAllRows<LeadRow>((from, to) =>
        supabase
          .from("leads")
          .select("*, lead_tag_links(tag_id)")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      getUserDirectory(),
      supabase.from("departments").select("id").eq("slug", "sales").single(),
      supabase.from("lead_tags").select("id, name, color, owner_id").order("name"),
    ]);

  // Flatten the embedded links into `tag_ids` and drop the nested field.
  // For users without a tag permission, RLS returns no link rows → `tag_ids: []`.
  const leads: Lead[] = (leadsData ?? []).map((row) => {
    const { lead_tag_links, ...rest } = row;
    return { ...rest, tag_ids: (lead_tag_links ?? []).map((l) => l.tag_id) };
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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const perms = user ? await getUserPermissions(user.id) : new Set<string>();
  const canManageTags = perms.has("leads.tags.manage");
  const canViewTags = canManageTags || perms.has("leads.tags.view");
  const canShareTags = perms.has("leads.tags.share");

  const admin = createAdminClient();
  // Sales agents reporting to this viewer — empty unless they are a closer.
  // Drives the "My team" scope on the table (migration 0069).
  const teamAgentIds = user ? await getTeamAgentIds(admin, user.id) : [];
  const { data: sentRows } = await admin.from("contracts").select("lead_id, status").eq("status", "sent");
  const contractSentLeadIds = Array.from(sentContractLeadIds(sentRows ?? []));

  return (
    <LeadsTable
      leads={leads}
      agentNameById={agentNameById}
      salesAgents={salesAgents}
      tags={tags}
      canViewTags={canViewTags}
      canManageTags={canManageTags}
      canShareTags={canShareTags}
      currentUserId={user?.id ?? ""}
      contractSentLeadIds={contractSentLeadIds}
      teamAgentIds={teamAgentIds}
    />
  );
}
