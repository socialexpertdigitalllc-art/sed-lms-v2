"use client";

export function ConditionalBlock({
  open,
  label,
  children,
}: {
  open: boolean;
  label?: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="mt-3 border-l-2 border-accent bg-surface-2 rounded-r-md p-3">
      {label && (
        <div className="text-[11px] font-semibold uppercase tracking-wide text-accent-ink mb-2">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}
