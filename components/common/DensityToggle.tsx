"use client";

import { Rows3, Rows4 } from "lucide-react";
import { useUiPrefs } from "@/providers/UiPrefsProvider";

export function DensityToggle() {
  const { density, setDensity } = useUiPrefs();
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden" role="group" aria-label="Row density">
      <button
        type="button"
        onClick={() => setDensity("comfortable")}
        aria-pressed={density === "comfortable"}
        title="Comfortable rows"
        className={"px-2 py-1.5 " + (density === "comfortable" ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2")}
      >
        <Rows3 className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => setDensity("compact")}
        aria-pressed={density === "compact"}
        title="Compact rows"
        className={"px-2 py-1.5 border-l border-border " + (density === "compact" ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2")}
      >
        <Rows4 className="w-4 h-4" />
      </button>
    </div>
  );
}
