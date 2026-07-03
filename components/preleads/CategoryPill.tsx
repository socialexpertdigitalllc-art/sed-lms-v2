import { CATEGORY_PILL, PRELEAD_STATUS_PILL } from "@/lib/preleads/types";

export function CategoryPill({ category }: { category: string }) {
  const cls = CATEGORY_PILL[category] ?? "bg-surface-2 text-text-muted";
  return (
    <span className={"inline-block text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap " + cls}>
      {category}
    </span>
  );
}

export function PreLeadStatusPill({ status }: { status: string }) {
  const cls = PRELEAD_STATUS_PILL[status] ?? "bg-surface-2 text-text-muted";
  return (
    <span className={"inline-block text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap " + cls}>
      {status}
    </span>
  );
}
