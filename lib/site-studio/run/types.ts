import type { ContentDoc } from "../schema";

export const RUN_STATUSES = ["queued","preparing","writing","rendering","ready","failed","cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** The step chain. Each step is short and idempotent; re-running one is safe. */
export const STEP_ORDER = ["prepare","write","render","finalize"] as const;
export type RunStep = (typeof STEP_ORDER)[number];

const TERMINAL: RunStatus[] = ["ready","failed","cancelled"];
export const isTerminal = (s: RunStatus): boolean => TERMINAL.includes(s);

/** Which step a run in this status should execute next, or null when done. */
export function nextStep(status: RunStatus): RunStep | null {
  switch (status) {
    case "queued": return "prepare";
    case "preparing": return "write";
    case "writing": return "render";
    case "rendering": return "finalize";
    default: return null; // ready / failed / cancelled
  }
}

/** The status a run moves to while `step` is running. */
export const RUNNING_STATUS: Record<RunStep, RunStatus> = {
  prepare: "preparing",
  write: "writing",
  render: "rendering",
  finalize: "rendering",
};

export const canCancel = (s: RunStatus): boolean => !isTerminal(s);

export interface PageWriteState {
  status: "pending" | "written" | "failed";
  attempts: number;
  error?: string;
  model?: string;
}

export interface RunSteps {
  prepare?: { at: string; pages: number };
  write?: { pages: Record<string, PageWriteState> };
  render?: { at: string; files: number };
  finalize?: { at: string; zip_bytes: number };
}

export interface StudioRunRow {
  id: string;
  lead_id: string | null;
  template_id: string;
  template_version: number;
  status: RunStatus;
  options: { page_ids?: string[]; fan_out_services?: boolean; fan_out_areas?: boolean; auto?: boolean };
  content_doc: ContentDoc | null;
  steps: RunSteps;
  client_photos: string[];
  site_slug: string | null;
  zip_path: string | null;
  deployed_url: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
