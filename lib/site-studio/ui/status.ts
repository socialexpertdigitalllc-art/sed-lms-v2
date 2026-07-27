import type { Diagnostic } from "../schema";
import type { StudioTemplateStatus } from "../service/types";
import type { RunStatus } from "../run/types";

export type PillTone = "ready" | "notready" | "dropped" | "accent" | "neutral";

/** Status → pill presentation. One place, so board and drawer never diverge. */
export function statusPill(status: StudioTemplateStatus): { tone: PillTone; label: string } {
  switch (status) {
    case "uploaded": return { tone: "neutral", label: "Uploaded" };
    case "needs_review": return { tone: "notready", label: "Needs review" };
    case "certified": return { tone: "ready", label: "Certified" };
    case "rejected": return { tone: "dropped", label: "Rejected" };
    case "disabled": return { tone: "neutral", label: "Disabled" };
  }
}

/** Run status → pill presentation for the cockpit (Phase 3b). Mirrors
 *  `statusPill`'s pattern exactly so the two families never diverge in style,
 *  even though they cover disjoint status sets. */
export function runStatusPill(status: RunStatus): { tone: PillTone; label: string } {
  switch (status) {
    case "queued": return { tone: "neutral", label: "Queued" };
    case "preparing": return { tone: "accent", label: "Preparing" };
    case "reviewing": return { tone: "notready", label: "Awaiting review" };
    case "approved": return { tone: "accent", label: "Approved" };
    case "rendering": return { tone: "accent", label: "Rendering" };
    case "ready": return { tone: "ready", label: "Ready" };
    case "failed": return { tone: "dropped", label: "Failed" };
    case "cancelled": return { tone: "neutral", label: "Cancelled" };
  }
}

export interface GroupedDiagnostics {
  blockers: Diagnostic[];
  warnings: Diagnostic[];
  infos: Diagnostic[];
}

export function groupDiagnostics(diagnostics: Diagnostic[] | null | undefined): GroupedDiagnostics {
  const list = diagnostics ?? [];
  return {
    blockers: list.filter((d) => d.level === "blocker"),
    warnings: list.filter((d) => d.level === "warn"),
    infos: list.filter((d) => d.level === "info"),
  };
}

export function blockerCount(diagnostics: Diagnostic[] | null | undefined): number {
  return (diagnostics ?? []).filter((d) => d.level === "blocker").length;
}

/** Mirrors the certify route's preconditions exactly — the button must not
 *  offer an action the server will refuse. */
export function canCertify(
  status: StudioTemplateStatus,
  hasManifest: boolean,
  diagnostics: Diagnostic[] | null | undefined,
): boolean {
  return status === "needs_review" && hasManifest && blockerCount(diagnostics) === 0;
}

/** One sentence telling the operator what to do next. */
export function nextStepHint(t: {
  status: StudioTemplateStatus;
  hasManifest: boolean;
  diagnostics: Diagnostic[] | null | undefined;
}): string {
  const blockers = blockerCount(t.diagnostics);
  if (blockers > 0) {
    return `${blockers} blocking problem${blockers === 1 ? "" : "s"} — fix the template and compile again.`;
  }
  switch (t.status) {
    case "uploaded": return "Compile this template to turn it into a package.";
    case "needs_review": return "Review the compiled pages, then certify.";
    case "certified": return "Ready to generate sites from.";
    case "rejected": return "Rejected. Re-open it to review again.";
    case "disabled": return "Disabled — certified but withheld from new runs.";
  }
}
