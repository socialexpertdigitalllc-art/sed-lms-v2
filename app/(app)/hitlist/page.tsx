import { redirect } from "next/navigation";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { loadLeadsTableData } from "@/lib/leads/tableData";

/** The HitList tab: the leads table, narrowed to the hit list (hitlist.view). */
export default async function HitlistPage() {
  const { user, canViewHitlist, props } = await loadLeadsTableData({ hitlistOnly: true });
  if (!user) redirect("/login");
  if (!canViewHitlist) redirect("/dashboard");
  return <LeadsTable {...props} mode="hitlist" />;
}
