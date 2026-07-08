import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { LeadDetail } from "@/components/leads/LeadDetail";
import type { Lead } from "@/lib/leads/types";
import type { LeadFollowUp } from "@/lib/leads/followups";
import { notFound } from "next/navigation";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: leadRaw } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!leadRaw) notFound();
  const lead = leadRaw as Lead;

  const { data: agents } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("is_active", true)
    .order("display_name");

  const { data: followUpsRaw } = await supabase
    .from("lead_follow_ups")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });

  // Resolve logger + closer names via the admin client so display_name is not RLS-nulled
  // for actors other than the viewer (covers no-longer-active profiles too).
  const userIds = Array.from(
    new Set([...(followUpsRaw ?? []).map((r) => r.user_id), lead.closed_by].filter(Boolean))
  ) as string[];
  const names = new Map<string, string | null>();
  if (userIds.length) {
    const admin = createAdminClient();
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    for (const p of profiles ?? []) names.set(p.id, p.display_name ?? null);
  }
  const followUps: LeadFollowUp[] = (followUpsRaw ?? []).map((r) => ({
    ...r,
    logger_name: r.user_id ? names.get(r.user_id) ?? null : null,
  }));
  const closedByName = lead.closed_by ? names.get(lead.closed_by) ?? null : null;

  return <LeadDetail lead={lead} agents={agents ?? []} followUps={followUps} closedByName={closedByName} />;
}
