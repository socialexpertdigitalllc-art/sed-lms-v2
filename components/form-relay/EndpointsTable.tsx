import Link from "next/link";
import { Plus, Inbox } from "lucide-react";
import { Panel, EmptyPanel, Pill } from "@/components/common/Panel";
import { btnSecondarySm } from "@/components/common/buttons";
import type { EndpointListItem } from "@/lib/forms/types";

export function EndpointsTable({ endpoints, leadNames, canManage }: { endpoints: EndpointListItem[]; leadNames: Record<string, string>; canManage: boolean }) {
  return (
    <Panel
      flush
      title="Endpoints"
      count={endpoints.length}
      action={canManage ? <Link href="/forms/endpoints/new" className={btnSecondarySm}><Plus className="h-3.5 w-3.5" /> New endpoint</Link> : null}
    >
      {endpoints.length === 0 ? (
        <EmptyPanel icon={Inbox} title="No endpoints yet" hint="Create one per client website; each gets its own access key." />
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs text-text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Lead</th>
              <th className="px-4 py-2 font-medium">Send to</th>
              <th className="px-4 py-2 font-medium">Today</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((e) => (
              <tr key={e.id} className="border-t border-border-subtle hover:bg-surface-2">
                <td className="px-4 py-2"><Link href={`/forms/endpoints/${e.id}`} className="font-medium text-text hover:underline">{e.name}</Link></td>
                <td className="px-4 py-2 text-text-muted">{e.lead_id ? leadNames[e.lead_id] ?? "—" : "—"}</td>
                <td className="px-4 py-2 text-text-muted">{e.to_emails.join(", ") || <span className="text-dropped-fg">no recipients</span>}</td>
                <td className="px-4 py-2 tabular text-text-muted">{e.today_count} / {e.daily_limit}</td>
                <td className="px-4 py-2">{e.status === "paused" ? <Pill tone="notready">Paused</Pill> : <Pill tone="ready">Active</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
