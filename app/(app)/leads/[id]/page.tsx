import { createClient } from "@/lib/supabase/server";
import { LeadDetail } from "@/components/leads/LeadDetail";
import type { Lead } from "@/lib/leads/types";
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

  return <LeadDetail lead={lead as Lead} agents={agents ?? []} />;
}
