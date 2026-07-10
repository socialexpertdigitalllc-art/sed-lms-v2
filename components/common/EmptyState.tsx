import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div className="grid place-items-center w-11 h-11 rounded-full bg-surface-2 border border-border text-text-faint">
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-sm font-medium text-text-muted">{title}</p>
      {hint ? <p className="text-xs text-text-faint max-w-xs">{hint}</p> : null}
    </div>
  );
}
