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

  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!lead) notFound();

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

  // Resolve logger names via the admin client so display_name is not RLS-nulled
  // for follow-ups logged by users other than the viewer.
  const userIds = Array.from(
    new Set((followUpsRaw ?? []).map((r) => r.user_id).filter(Boolean))
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

  return <LeadDetail lead={lead as Lead} agents={agents ?? []} followUps={followUps} />;
}
