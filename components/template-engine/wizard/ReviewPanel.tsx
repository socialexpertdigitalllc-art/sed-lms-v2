"use client";
import type { GenerationDetail } from "./GenerationWizard";

// Stub — replaced in Task 11.
export function ReviewPanel({ gen, canDeploy, onChanged }: { gen: GenerationDetail; canDeploy: boolean; onChanged: () => void }) {
  void gen;
  void canDeploy;
  void onChanged;
  return <div className="rounded-lg border border-border bg-surface p-5 text-sm text-text-muted">Review panel arrives in Task 11.</div>;
}
