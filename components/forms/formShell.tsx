import { Check, AlertTriangle } from "lucide-react";
import { Field } from "./Field";

/** Field wrapper that flags itself for scroll-to-first-error (stable identity). */
export function FieldBlock({
  error,
  ...props
}: { error?: string } & React.ComponentProps<typeof Field>) {
  return (
    <div data-error={error ? "true" : undefined}>
      <Field {...props} error={error} />
    </div>
  );
}

/** Inline error line for controls that live outside a direct Field child. */
export function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p className="text-[11px] text-dropped-fg mt-1 flex items-center gap-1">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
    </p>
  );
}

/** A numbered, iconed section card with a completion state and staggered reveal. */
export function SectionCard({
  n,
  icon: Icon,
  title,
  subtitle,
  done,
  delay,
  children,
}: {
  n: number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  subtitle: string;
  done: boolean;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <section
      className="reveal group rounded-2xl border border-border bg-surface shadow-sm transition-shadow hover:shadow-md"
      style={{ animationDelay: `${delay}ms` }}
    >
      <header className="flex items-center gap-3.5 px-6 pt-5 pb-4">
        <div
          className={
            "grid h-10 w-10 shrink-0 place-items-center rounded-xl border text-sm font-semibold transition-colors " +
            (done
              ? "border-accent bg-accent text-white"
              : "border-border bg-accent-soft text-accent-ink")
          }
        >
          {done ? <Check size={18} /> : <Icon size={18} />}
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-[15px] font-semibold leading-tight text-text">
            <span className="mr-2 font-mono text-xs text-text-faint">
              {String(n).padStart(2, "0")}
            </span>
            {title}
          </h2>
          <p className="text-xs text-text-muted">{subtitle}</p>
        </div>
      </header>
      <div className="space-y-5 border-t border-border-subtle px-6 py-5">{children}</div>
    </section>
  );
}

/** A label/value row inside a sticky summary panel. */
export function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[11px] uppercase tracking-wide text-text-faint">{label}</span>
      <span className="min-w-0 truncate text-right text-sm text-text">{children}</span>
    </div>
  );
}
