/**
 * What an action looks like to the person confirming it — the card in the
 * chat. Pure types and helpers, safe to import from client components.
 *
 * A card shows exactly what will happen (every value, or before → after for a
 * change, or the list of records for a bulk change), how risky it is, and —
 * once it has run — what happened, with Undo while that is still possible.
 */

export type ActionRisk = "standard" | "sensitive" | "critical";

export type ActionStatus =
  | "proposed"
  | "executing"
  | "done"
  | "failed"
  | "cancelled"
  | "expired"
  | "undone"
  | "awaiting_approval"
  | "rejected";

/** How a value can be edited on the card before confirming. */
export interface EditSpec {
  type: "text" | "longtext" | "number" | "datetime" | "date" | "enum" | "boolean" | "email" | "phone" | "url";
  options?: { value: string; label: string }[];
  /** The current value in the editor's own format. */
  raw: string;
}

export interface CardField {
  name: string;
  label: string;
  /** Display text; "" when not set. */
  value: string;
  edit?: EditSpec | null;
}

export interface CardChange {
  label: string;
  from: string;
  to: string;
}

/** One record of a bulk change; the person can untick it before confirming. */
export interface CardItem {
  id: string;
  label: string;
  detail?: string;
  href?: string;
  selected: boolean;
}

export interface CardLink {
  href: string;
  label: string;
}

export interface ActionCard {
  id: string;
  key: string;
  title: string;
  group: string;
  risk: ActionRisk;
  status: ActionStatus;
  /** The Confirm button's words: "Create lead". */
  confirmLabel: string;
  fields: CardField[];
  changes?: CardChange[];
  items?: CardItem[];
  warnings?: string[];
  /** What happens around it: "Accounts is alerted to send a receipt." */
  notes?: string[];
  link?: CardLink | null;
  /** Critical actions are confirmed by typing this. */
  confirmPhrase?: string | null;
  result?: { message: string; link?: CardLink | null } | null;
  error?: string | null;
  undoUntil?: string | null;
  plan?: { id: string; index: number; total: number; title: string } | null;
  approval?: { reason: string; approver?: string | null; note?: string | null } | null;
  /** The tool call that proposed it — places the card in its turn. */
  callId?: string | null;
  /** The question it was prepared for. */
  turnId?: string | null;
  createdAt: string;
  expiresAt?: string | null;
}

export const RISK_LABEL: Record<ActionRisk, string> = {
  standard: "Safe",
  sensitive: "Check before confirming",
  critical: "High impact",
};

export const STATUS_LABEL: Record<ActionStatus, string> = {
  proposed: "Waiting for you",
  executing: "Working…",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
  expired: "Expired",
  undone: "Undone",
  awaiting_approval: "Waiting for approval",
  rejected: "Not approved",
};

/** Can the person still act on this card? */
export function isOpen(card: Pick<ActionCard, "status">): boolean {
  return card.status === "proposed";
}

/** Undo still possible at `now`? */
export function canUndo(card: Pick<ActionCard, "status" | "undoUntil">, now = Date.now()): boolean {
  return card.status === "done" && !!card.undoUntil && Date.parse(card.undoUntil) > now;
}
