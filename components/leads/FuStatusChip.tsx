export function FuStatusChip({ status }: { status: string }) {
  const cls = status === "Pickup" ? "bg-ready-bg text-ready-fg" : "bg-notready-bg text-notready-fg";
  return <span className={"rounded-md px-2 py-0.5 text-xs font-medium " + cls}>{status}</span>;
}
