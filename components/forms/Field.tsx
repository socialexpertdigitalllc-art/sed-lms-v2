import { AlertTriangle } from "lucide-react";

export function Field({
  label,
  required,
  hint,
  error,
  children,
  className = "",
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-text-muted mb-1">
        {label}
        {required && <span className="text-dropped-fg"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="text-[11px] text-text-faint mt-1">{hint}</p>}
      {error && (
        <p className="text-[11px] text-dropped-fg mt-1 flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}

export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-5 first:pt-0">
      <div className="text-sm font-semibold text-text border-b border-border pb-2 mb-4">{title}</div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

/** Standard input class, matching existing forms. */
export const inputCls =
  "w-full px-3 py-2 rounded-md border border-border bg-surface text-sm text-text outline-none focus:ring-2 focus:ring-accent";
