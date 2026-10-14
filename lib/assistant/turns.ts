import type { ActionCard } from "./actions/card";
import type { AnswerFeedback, AssistantMode, AssistantStreamEvent, MessageAttachment } from "./types";
import type { UiMessage } from "./view";

/**
 * The chat thread as the UI draws it: one TURN per question — the question,
 * then the answer as an ordered list of segments (reasoning, lookups, text).
 *
 * The same model is built two ways — from saved rows when a conversation is
 * opened, and event by event while an answer streams — so a reply looks the
 * same live as it does after a reload. PURE; unit-tested.
 */

export type Segment =
  | { kind: "reasoning"; text: string }
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      callId: string;
      name: string;
      label: string;
      status: "running" | "ok" | "error";
      summary: string | null;
      args: Record<string, unknown> | null;
    };

export interface TurnModel {
  /** The question's message id, or a temporary id while it is being sent. */
  id: string;
  question: string;
  segments: Segment[];
  status: "running" | "done" | "error" | "stopped";
  error: string | null;
  /** The finished answer's message id — what a thumbs up/down is saved on. */
  answerId: string | null;
  feedback: AnswerFeedback | null;
  /** When the question was asked and the answer finished (epoch ms), for
   *  "Worked for 12s". Null when unknown. */
  startedAt: number | null;
  endedAt: number | null;
  /** Changes prepared in this turn, as confirmation cards. */
  actions: ActionCard[];
  /** Files attached to the question. */
  attachments: MessageAttachment[];
  /** The mode the question was asked in (people with Act mode). */
  mode: AssistantMode | null;
  /** The assistant switched itself to Act mode for this: the task, in its words. */
  switchedToAct: string | null;
}

/** A turn still waiting for the server to accept it has this id prefix. */
export const PENDING_PREFIX = "pending-";

const stamp = (iso: string): number | null => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Saved rows (and the chat's action cards) → turns. Rows arrive in insertion order. */
export function turnsFromMessages(rows: UiMessage[], actions: ActionCard[] = []): TurnModel[] {
  const turns: TurnModel[] = [];
  const byTurn = new Map<string, TurnModel>();
  const byCall = new Map<string, TurnModel>();
  for (const row of rows) {
    if (row.role === "user") {
      const turn: TurnModel = {
        id: row.id,
        question: row.content,
        segments: [],
        status: "done",
        error: null,
        answerId: null,
        feedback: null,
        startedAt: stamp(row.created_at),
        endedAt: null,
        actions: [],
        attachments: row.meta?.attachments ?? [],
        mode: row.meta?.mode ?? null,
        switchedToAct: null,
      };
      turns.push(turn);
      byTurn.set(row.turn_id ?? row.id, turn);
      continue;
    }
    const turn = turns[turns.length - 1];
    if (!turn) continue;
    turn.endedAt = stamp(row.created_at) ?? turn.endedAt;
    if (row.role === "assistant") {
      if (row.reasoning) turn.segments.push({ kind: "reasoning", text: row.reasoning });
      if (row.content) turn.segments.push({ kind: "text", text: row.content });
      if (row.status === "error") {
        turn.status = "error";
        turn.error = row.error;
      } else if (row.status === "stopped") turn.status = "stopped";
      else if (!row.tool_calls?.length && row.content) {
        // The round that answered in words — the answer a rating is about.
        turn.answerId = row.id;
        turn.feedback = row.meta?.feedback ?? null;
      }
      continue;
    }
    turn.segments.push({
      kind: "tool",
      callId: row.tool_call_id ?? row.id,
      name: row.tool_name ?? "lookup",
      label: row.meta?.label ?? row.tool_name ?? "Lookup",
      status: row.meta?.ok === false ? "error" : "ok",
      summary: row.meta?.summary ?? null,
      args: row.meta?.args ?? null,
    });
    if (row.tool_call_id) byCall.set(row.tool_call_id, turn);
    if (row.tool_name === "switch_to_action_mode" && row.meta?.ok !== false) {
      turn.switchedToAct = typeof row.meta?.args?.task === "string" ? row.meta.args.task : "this task";
    }
  }
  // Cards go with the turn that prepared them (by turn, else by tool call).
  for (const card of actions) {
    const turn = (card.callId ? byCall.get(card.callId) : undefined) ?? (card.turnId ? byTurn.get(card.turnId) : undefined);
    if (turn && !turn.actions.some((a) => a.id === card.id)) turn.actions.push(card);
  }
  return turns;
}

export function liveTurn(
  id: string,
  question: string,
  now = Date.now(),
  extras: { attachments?: MessageAttachment[]; mode?: AssistantMode | null } = {},
): TurnModel {
  return {
    id,
    question,
    segments: [],
    status: "running",
    error: null,
    answerId: null,
    feedback: null,
    startedAt: now,
    endedAt: null,
    actions: [],
    attachments: extras.attachments ?? [],
    mode: extras.mode ?? null,
    switchedToAct: null,
  };
}

/** Put a card's latest state wherever it is shown. */
export function withCard(turn: TurnModel, card: ActionCard): TurnModel {
  if (!turn.actions.some((a) => a.id === card.id)) return turn;
  return { ...turn, actions: turn.actions.map((a) => (a.id === card.id ? card : a)) };
}

/** Fold one stream event into the live turn. */
export function applyEvent(turn: TurnModel, e: AssistantStreamEvent): TurnModel {
  const segments = [...turn.segments];
  const last = segments[segments.length - 1];
  switch (e.type) {
    case "start":
      return { ...turn, id: e.userMessageId };
    case "text":
    case "reasoning": {
      const kind = e.type;
      if (last && last.kind === kind) segments[segments.length - 1] = { kind, text: last.text + e.delta };
      else segments.push({ kind, text: e.delta });
      return { ...turn, segments };
    }
    case "reset": {
      // The current model round is being retried: drop what it streamed —
      // everything after the last completed lookup.
      let cut = segments.length;
      while (cut > 0 && segments[cut - 1].kind !== "tool") cut--;
      return { ...turn, segments: segments.slice(0, cut) };
    }
    case "tool_start":
      segments.push({ kind: "tool", callId: e.callId, name: e.name, label: e.label, status: "running", summary: null, args: e.args });
      return { ...turn, segments };
    case "tool_end":
      return {
        ...turn,
        segments: segments.map((s) =>
          s.kind === "tool" && s.callId === e.callId ? { ...s, status: e.ok ? "ok" : "error", summary: e.summary } : s,
        ),
      };
    case "action":
      return turn.actions.some((a) => a.id === e.card.id)
        ? withCard(turn, e.card)
        : { ...turn, actions: [...turn.actions, e.card] };
    case "mode":
      return { ...turn, mode: e.mode, switchedToAct: e.mode === "act" ? e.reason || "this task" : turn.switchedToAct };
    case "done":
      return { ...turn, status: e.stopped ? "stopped" : "done", answerId: e.stopped ? null : e.messageId, endedAt: Date.now() };
    case "error":
      return { ...turn, status: "error", error: e.message, endedAt: Date.now() };
    default:
      return turn;
  }
}

/** "12s", "1m 05s" — how long an answer took. */
export function formatDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** The answer's words, for copying. */
export function answerText(turn: TurnModel): string {
  return turn.segments
    .filter((s): s is Extract<Segment, { kind: "text" }> => s.kind === "text")
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join("\n\n");
}
