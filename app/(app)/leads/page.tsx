import { LiveLeadsTable } from "@/components/leads/LiveLeads";
import { loadLeadsTableData } from "@/lib/leads/tableData";

export default async function LeadsPage() {
  const { props } = await loadLeadsTableData();
  return <LiveLeadsTable {...props} />;
}
