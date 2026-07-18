import { FileCheck } from "lucide-react";

/** Derived pill shown on a lead that has a sent contract. */
export function ContractSentBadge({ className = "" }: { className?: string }) {
  return (
    <span className={"inline-flex items-center gap-1 rounded-full bg-ready-bg px-2 py-0.5 text-[10px] font-medium text-ready-fg " + className}>
      <FileCheck className="w-3 h-3" /> Contract Sent
    </span>
  );
}
