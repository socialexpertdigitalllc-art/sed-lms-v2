"use client";
import type { GenerationDetail } from "./GenerationWizard";

// Stub — replaced in Task 9.
export function ContentEditor({ gen, onSaved }: { gen: GenerationDetail; onSaved: () => void }) {
  void gen;
  void onSaved;
  return <div className="rounded-lg border border-border bg-surface p-5 text-sm text-text-muted">Content editor arrives in Task 9.</div>;
}
