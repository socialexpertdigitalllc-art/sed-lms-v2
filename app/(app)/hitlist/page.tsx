import { redirect } from "next/navigation";
import { LiveLeadsTable } from "@/components/leads/LiveLeads";
import { loadLeadsTableData } from "@/lib/leads/tableData";

/** The HitList tab: the leads table, narrowed to the hit list (hitlist.view). */
export default async function HitlistPage() {
  const { user, canViewHitlist, props } = await loadLeadsTableData();
  if (!user) redirect("/login");
  if (!canViewHitlist) redirect("/dashboard");
  return <LiveLeadsTable {...props} mode="hitlist" />;
}
