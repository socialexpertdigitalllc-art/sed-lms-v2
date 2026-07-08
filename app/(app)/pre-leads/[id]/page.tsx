import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { PreLeadDetail } from "@/components/preleads/PreLeadDetail";
import type { PreLead } from "@/lib/preleads/types";

export default async function PreLeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("pre_leads")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!data) notFound();

  return <PreLeadDetail preLead={data as PreLead} />;
}
