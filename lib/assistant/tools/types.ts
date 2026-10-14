import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionCard } from "../actions/card";
import type { StoredAction } from "../actions/types";
import type { TurnData } from "./data";
import type { AssistantMemory, AssistantMode } from "../types";

/**
 * Everything a tool needs, built once per user message.
 *
 * THE SCOPING RULE. A tool reads through `db` — the user's own database
 * client — wherever the app itself does, so Postgres row-level security
 * decides what is visible: Sam's assistant cannot see Ali's leads because Sam
 * cannot. `admin` (service role) is used ONLY where the app's own pages
 * already serve this user through the service role (the ticket queue, the
 * activity log, the user directory), and only after the same permission check
 * those pages make. A tool never widens what its user could open by hand.
 */
export interface ToolContext {
  userId: string;
  displayName: string;
  perms: Set<string>;
  db: SupabaseClient;
  admin: SupabaseClient;
  /** Company timezone (app_settings.work_timezone). */
  timezone: string;
  now: Date;
  conversationId: string;
  data: TurnData;
  /** Side effects the UI should hear about immediately (a memory saved). */
  emit?: (event: ToolSideEvent) => void;
  /** Act mode: present when this person may use it (assistant.act). */
  act?: ActState;
}

/** What the action tools need to know about this turn. */
export interface ActState {
  mode: AssistantMode;
  /** The question's turn id — proposals are filed under it. */
  turnId: string;
  source: StoredAction["source"];
  /** Admin-department member (several endpoints check it). */
  isAdmin: boolean;
  /** Set by switch_to_action_mode: the engine switches after this round. */
  switchRequested?: string | null;
  /** The tool call being run (set by the engine per call). */
  callId?: string | null;
}

export type ToolSideEvent =
  | { type: "memory"; action: "saved" | "forgotten"; memory: AssistantMemory }
  | { type: "action"; card: ActionCard }
  | { type: "mode"; mode: AssistantMode; reason: string };

export interface ToolResult {
  /** JSON-serialisable; what the model reads. */
  data: unknown;
  /** One line for the activity chip in the chat ("212 leads · 31 closed"). */
  summary: string;
}

/** A JSON-Schema subset every provider's function-calling accepts: type,
 *  properties, required, description, enum, items, minimum, maximum. No
 *  `additionalProperties`/`$schema`/`anyOf` — Gemini's compat layer rejects
 *  some of them outright. */
export interface ToolParameters {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface AssistantTool {
  name: string;
  /** Present-tense label for the chat UI while it runs: "Reading the pipeline". */
  label: string;
  description: string;
  parameters: ToolParameters;
  /** Checked when offering tools to the model AND again before every run. */
  available: (perms: Set<string>) => boolean;
  /** Which modes offer it (default: both). */
  modes?: AssistantMode[];
  /** Runs alone, in call order — never alongside other calls (changes, proposals). */
  sequential?: boolean;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

/** A failure worth telling the model about in words (bad argument, nothing
 *  visible, permission) — as opposed to a bug, which is logged. */
export class ToolError extends Error {}
