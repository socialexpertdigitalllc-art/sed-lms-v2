import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionCard, ActionRisk, ActionStatus, CardChange, CardField, CardItem, CardLink } from "./card";

/**
 * The shape of an ACTION — one change SED AI can make for someone — and of the
 * things the framework hands it. SERVER ONLY.
 *
 * An action is declared, not hand-coded end to end: its fields (with which
 * are required, and when), an optional cross-field check, an optional
 * preview, and how to execute it. The framework does the rest the same way
 * for every action — normalising what the model sent, asking for what is
 * missing, refusing what is invalid, drawing the confirmation card, running
 * the change as the person who confirmed it, and undoing it.
 *
 * EXECUTE THROUGH THE APP. An executor calls the app's own endpoint for the
 * change (see ./invoke.ts) rather than writing tables itself, so permission
 * checks, row-level security, notifications and the activity log apply
 * exactly as when the person uses the screen. Writing tables directly is only
 * for state the assistant itself owns (reminders, rules, handovers).
 */

export type Values = Record<string, unknown>;

export interface ActionContext {
  userId: string;
  displayName: string;
  perms: Set<string>;
  /** The person's own client (row-level security). */
  db: SupabaseClient;
  /** Service role: lookups the app already serves this way, and the assistant's own tables. */
  admin: SupabaseClient;
  /** Company timezone (app_settings.work_timezone). */
  timezone: string;
  now: Date;
  /** A member of the Admin department — several endpoints check this as well as a permission. */
  isAdmin: boolean;
  /**
   * Whose action this is, when someone else runs it (an approver): the
   * requester. Their own things — files they attached, their reminders —
   * are looked up under them, not under the approver. Unset = userId.
   */
  ownerId?: string;
}

export type ActionGroup =
  | "Leads"
  | "Pre-leads"
  | "Tickets"
  | "AI developer"
  | "Site Builder"
  | "Websites & domains"
  | "Money"
  | "Email"
  | "Agency website"
  | "Client forms"
  | "Team & admin"
  | "Personal";

/** Records a field can point at; resolved from an id or a name (see ./refs.ts). */
export type RefKind =
  | "lead"
  | "pre_lead"
  | "ticket"
  | "ticket_item"
  | "user"
  | "department"
  | "tag"
  | "builder_template"
  | "site_run"
  | "agent_run"
  | "deployment"
  | "domain"
  | "mailbox"
  | "receipt"
  | "contract"
  | "form_endpoint"
  | "form_submission"
  | "website_lead"
  | "coupon"
  | "notification"
  | "upload"
  | "reminder"
  | "rule"
  | "handoff";

export type FieldType =
  | "text"
  | "longtext"
  | "phone"
  | "email"
  | "url"
  | "integer"
  | "number"
  | "money"
  | "boolean"
  | "date"
  | "datetime"
  | "enum"
  | "multi"
  | "list"
  | "ref"
  | "refs"
  | "colors"
  | "rating"
  | "attachment"
  | "attachments"
  | "json";

export interface FieldSpec {
  name: string;
  label: string;
  type: FieldType;
  /** Required always, never, or depending on the other values. */
  required?: boolean | ((v: Values) => boolean);
  /** Only relevant when this holds: otherwise ignored, never asked for, never shown. */
  showIf?: (v: Values) => boolean;
  /** For the model: what goes here and how to get it from the person. */
  help?: string;
  /** enum / multi choices. A function reads them per person (statuses they may set). */
  options?: readonly string[] | ((ctx: ActionContext) => readonly string[] | Promise<readonly string[]>);
  /** ref / refs: what kind of record. */
  ref?: RefKind;
  /** ref / refs: extra narrowing, e.g. only Sales agents. */
  refFilter?: string;
  /** Numbers: bounds. Text: length bounds. Lists: item count bounds. */
  min?: number;
  max?: number;
  /** datetime / date: must be in the future. */
  future?: boolean;
  /** Used when the person gives nothing (and the field is then not "missing"). May be async. */
  default?: unknown | ((ctx: ActionContext, v: Values) => unknown);
  /** Never shown on the card (internal plumbing such as a resolved id twin). */
  hidden?: boolean;
  /** Can be changed on the card before confirming (default: true for simple types). */
  editable?: boolean;
}

export interface Problem {
  field: string;
  message: string;
  /** A short list of likely meanings, for an ambiguous name. */
  choices?: string[];
}

export interface CheckResult {
  problems?: Problem[];
  warnings?: string[];
  /** Values the check worked out (an id it looked up, a derived total) — merged in. */
  values?: Values;
}

export interface Preview {
  /** Overrides the card title: "Create lead — Jumbo's Pizza". */
  title?: string;
  /** Defaults to every visible field. */
  fields?: CardField[];
  changes?: CardChange[];
  items?: CardItem[];
  warnings?: string[];
  notes?: string[];
  link?: CardLink | null;
  /** Stored with the proposal: the stale check and the undo source. */
  before?: unknown;
  /** Critical actions: the words to type. Defaults to the record's name. */
  confirmPhrase?: string;
}

export interface ExecResult {
  message: string;
  link?: CardLink | null;
  /** Kept on the action (ids created, previous values) — for undo, plans and the model. */
  data?: Record<string, unknown>;
  /** False when this particular run cannot be undone (nothing was changed). */
  undoable?: boolean;
}

/** An action row as stored. */
export interface StoredAction {
  id: string;
  user_id: string;
  conversation_id: string | null;
  turn_id: string | null;
  tool_call_id: string | null;
  plan_id: string | null;
  plan_index: number | null;
  plan_title: string | null;
  action_key: string;
  title: string;
  risk: ActionRisk;
  input: Values;
  card: Partial<ActionCard>;
  before_state: unknown;
  confirm_phrase: string | null;
  status: ActionStatus;
  result: (ExecResult & { data?: Record<string, unknown> }) | null;
  error: string | null;
  source: "chat" | "telegram" | "whatsapp" | "rule" | "suggestion" | "recipe" | "scheduler";
  approver_id: string | null;
  approval_note: string | null;
  decided_at: string | null;
  reported_at: string | null;
  undo_until: string | null;
  created_at: string;
  updated_at: string;
  executed_at: string | null;
  expires_at: string;
}

export interface ActionDef {
  /** "lead.create" */
  key: string;
  group: ActionGroup;
  /** "Create a lead" — the catalogue name. */
  title: string;
  /** For the model: what it does and when to use it. */
  description: string;
  /** The Confirm button: "Create lead". */
  confirmLabel: string;
  risk: ActionRisk | ((v: Values) => ActionRisk);
  /**
   * May THIS person make the change? null = yes; otherwise the reason in
   * words ("You don't have “Assign / Reassign Lead”."). A person who may not
   * can still ask an approver (see approvals in ./run.ts).
   */
  allowed: (ctx: ActionContext) => string | null;
  fields: FieldSpec[];
  /** The record's name for titles: v => v.business_name. */
  label?: (v: Values) => string;
  /** Cross-field rules, lookups, duplicate checks — beyond what field specs say. */
  check?: (v: Values, ctx: ActionContext) => Promise<CheckResult | void>;
  /** What the card shows (and the before-state kept for the stale check / undo). */
  preview?: (v: Values, ctx: ActionContext) => Promise<Preview>;
  /**
   * Has the record moved on since it was proposed? Returns the reason, or
   * null. Confirming a stale proposal is refused rather than overwriting
   * someone else's newer change.
   */
  stale?: (before: unknown, v: Values, ctx: ActionContext) => Promise<string | null>;
  execute: (v: Values, ctx: ActionContext, info: ExecInfo) => Promise<ExecResult>;
  undo?: {
    /** How long Undo stays available (default 10 minutes). */
    minutes?: number;
    run: (stored: StoredAction, ctx: ActionContext) => Promise<string>;
  };
  /** Bulk actions: the refs field whose records the person can untick on the card. */
  bulkField?: string;
  /** The kind of record this creates — later plan steps can point at it as "@N". */
  produces?: RefKind;
  /** Rough minutes a person spends doing this by hand — for the action report. */
  minutesSaved?: number;
  /**
   * A check that crashes BLOCKS the proposal instead of becoming a warning.
   * Always on for critical actions (money, deletion, access).
   */
  strictCheck?: boolean;
  /**
   * Only ever done by the person for themselves (their notifications, tags,
   * reminders, mail): never sent to an approver, who would run it as — and
   * on — themselves.
   */
  selfOnly?: boolean;
}

export interface ExecInfo {
  actionId: string;
  /** The origin links should be built on (https://dashboard…). */
  origin: string;
  /** Who asked for it — not the same as ctx.userId when an approver runs it. */
  requesterId?: string;
}

/** What the model is told when it tries to prepare an action. */
export type PrepareOutcome =
  | { kind: "unknown"; message: string }
  | { kind: "disabled"; message: string }
  | {
      kind: "needs_input";
      /** What is still needed, in the order to ask for it. */
      missing: { field: string; label: string; help?: string; options?: readonly string[] }[];
      problems: Problem[];
      warnings: string[];
      /** What was understood so far, for the model to read back. */
      understood: Record<string, string>;
    }
  | { kind: "proposed"; card: ActionCard; needsApproval: boolean };
