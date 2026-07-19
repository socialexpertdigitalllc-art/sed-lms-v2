import { FileCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/** Derived pill shown on a lead that has a sent contract. */
export function ContractSentBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title="A contract has been emailed to this lead"
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-ready-bg px-2 py-0.5 text-[10px] font-medium text-ready-fg ring-1 ring-inset ring-ready-fg/15",
        className,
      )}
    >
      <FileCheck className="h-3 w-3 shrink-0" /> Contract Sent
    </span>
  );
}
