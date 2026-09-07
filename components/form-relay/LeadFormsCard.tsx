import Link from "next/link";
import { Inbox, Plus, KeyRound } from "lucide-react";
import { Panel, EmptyPanel } from "@/components/common/Panel";
import { btnSecondarySm } from "@/components/common/buttons";
import { formatRelative } from "@/lib/leads/format";
import { previewLine } from "@/lib/forms/email";
import { DeliveryPill } from "@/components/form-relay/DeliveryPill";
import type { FormEndpointRow, FormSubmissionRow } from "@/lib/forms/types";

export function LeadFormsCard({ leadId, endpoints, submissions, canManage }: {
  leadId: string;
  endpoints: FormEndpointRow[];
  submissions: FormSubmissionRow[];
  canManage: boolean;
}) {
  return (
    <Panel
      icon={Inbox}
      title="Website forms"
      count={submissions.length}
      action={canManage ? <Link href={`/forms/endpoints/new?lead=${leadId}`} className={btnSecondarySm}><Plus className="h-3.5 w-3.5" /> Endpoint</Link> : null}
      flush
    >
      {endpoints.length === 0 ? (
        <EmptyPanel icon={KeyRound} title="No form endpoint" hint={canManage ? "Create one to receive this site's form submissions." : "Ask an admin to create one."} />
      ) : (
        <>
          <ul className="divide-y divide-border-subtle">
            {endpoints.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <Link href={`/forms/endpoints/${e.id}`} className="truncate font-medium text-text hover:underline">{e.name}</Link>
                <span className="shrink-0 text-xs text-text-muted">{e.status === "paused" ? "paused" : e.to_emails.join(", ")}</span>
              </li>
            ))}
          </ul>
          {submissions.length > 0 ? (
            <ul className="divide-y divide-border-subtle border-t border-border">
              {submissions.map((s) => (
                <li key={s.id} className="px-4 py-2 text-sm">
                  <Link href={`/forms?submission=${s.id}`} className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-text">{s.submitter_name ?? s.subject ?? "Submission"}</span>
                      <span className="block truncate text-xs text-text-muted">{previewLine(s.payload, 80)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
                      {formatRelative(s.created_at)} <DeliveryPill status={s.delivery_status} spam={s.is_spam} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t border-border px-4 py-3 text-xs text-text-muted">No submissions yet.</p>
          )}
        </>
      )}
    </Panel>
  );
}
