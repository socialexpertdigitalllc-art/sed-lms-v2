import { STATUS_PILL } from "@/lib/leads/types";

export function StatusPill({ status }: { status: string }) {
  const cls = STATUS_PILL[status] ?? "bg-surface-2 text-text-muted";
  return (
    <span className={"inline-block text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap " + cls}>
      {status}
    </span>
  );
}
