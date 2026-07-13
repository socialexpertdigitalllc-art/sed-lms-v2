import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { LeadsTable } from "@/components/leads/LeadsTable";
import type { Lead, LeadTag } from "@/lib/leads/types";

export default async function LeadsPage() {
  const supabase = await createClient();
  const { data: leadsData } = await supabase
    .from("leads")
    .select("*, lead_tag_links(tag_id)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  // Flatten the embedded links into `tag_ids` and drop the nested field.
  // For users without a tag permission, RLS returns no link rows → `tag_ids: []`.
  const leads: Lead[] = (leadsData ?? []).map((row: any) => {
    const { lead_tag_links, ...rest } = row;
    return { ...rest, tag_ids: (lead_tag_links ?? []).map((l: any) => l.tag_id) } as Lead;
  });

  const { data: agents } = await supabase.from("profiles").select("id, display_name");
  const agentNameById: Record<string, string> = {};
  for (const a of agents ?? []) agentNameById[a.id] = a.display_name ?? "—";

  // Sales-department members — the only valid targets for bulk assignment.
  const { data: salesDept } = await supabase
    .from("departments")
    .select("id")
    .eq("slug", "sales")
    .single();
  let salesAgents: { id: string; name: string }[] = [];
  if (salesDept) {
    const { data: members } = await supabase
      .from("department_members")
      .select("user_id, profiles!department_members_user_id_fkey(id, display_name)")
      .eq("department_id", salesDept.id);
    salesAgents = (members ?? [])
      .map((m: any) => ({ id: m.profiles?.id, name: m.profiles?.display_name ?? "—" }))
      .filter((u: any) => u.id);
  }

  // Tag catalog — RLS returns [] without leads.tags.view/manage.
  const { data: tagsData } = await supabase
    .from("lead_tags")
    .select("id, name, color")
    .order("name");
  const tags = (tagsData ?? []) as LeadTag[];

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const perms = user ? await getUserPermissions(user.id) : new Set<string>();
  const canManageTags = perms.has("leads.tags.manage");
  const canViewTags = canManageTags || perms.has("leads.tags.view");

  return (
    <LeadsTable
      leads={leads}
      agentNameById={agentNameById}
      salesAgents={salesAgents}
      tags={tags}
      canViewTags={canViewTags}
      canManageTags={canManageTags}
    />
  );
}
