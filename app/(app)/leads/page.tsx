import { LeadsTable } from "@/components/leads/LeadsTable";
import { loadLeadsTableData } from "@/lib/leads/tableData";

export default async function LeadsPage() {
  const { props } = await loadLeadsTableData();
  return <LeadsTable {...props} />;
}
