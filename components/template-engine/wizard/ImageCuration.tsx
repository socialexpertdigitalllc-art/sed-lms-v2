"use client";
import type { GenerationDetail } from "./GenerationWizard";

// Stub — replaced in Task 10.
export function ImageCuration({ gen, onChanged }: { gen: GenerationDetail; onChanged: () => void }) {
  void gen;
  void onChanged;
  return <div className="rounded-lg border border-border bg-surface p-5 text-sm text-text-muted">Image curation arrives in Task 10.</div>;
}
