import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AiCallAborted, isAbortedError } from "@/lib/ai-tools/abort";
import { defaultSpecForTask, type ResolvedTaskModel } from "@/lib/ai-tools/providers/config";
import { resolveTaskModelCached } from "@/lib/ai-tools/providers/run";
import { getProvider } from "@/lib/ai-tools/providers/registry";
import { isRetryableError, ProviderHttpError, CALL_TIMEOUT_MARKER } from "@/lib/ai-tools/providers/errors";
import { getAppSettings } from "@/lib/settings/appSettings";
import { buildHistory, DEFAULT_HISTORY } from "./history";
import { streamChat, type ChatResult, type WireMessage } from "./llm";
import { buildSystemPrompt, describeScope } from "./prompt";
import { insertMessage, listMemories, listMessages, updateConversation } from "./store";
import { parseToolArgs, runTool, toolDefinitions, toolsFor, ALL_TOOLS, type ToolRunOutcome } from "./tools";
import { TurnData } from "./tools/data";
import type { ToolContext } from "./tools/types";
import type { AssistantConversation, AssistantStreamEvent } from "./types";
import { toClientConversation } from "./view";

/**
 * One answer, end to end: save the question, assemble what the model needs
 * (who is asking, what they may see, what is remembered about them, the
 * conversation so far), then alternate model rounds and tool calls until the
 * model answers in words — streaming every piece to the browser and saving
 * every piece to the database as it goes.
 *
 * Saved as it goes ON PURPOSE: the browser may close mid-answer, and the
 * answer must still be there when the conversation is reopened. `emit` never
 * throws and the work never depends on anyone listening.
 */

/** Tool rounds before the model is told to answer with what it has. */
export const MAX_TOOL_ROUNDS = 8;
const TOOL_CONCURRENCY = 4;
/** MiniMax and Gemini 3 both recommend 1.0; lower makes them loop. */
const TEMPERATURE = 1;

export interface TurnInput {
  userId: string;
  displayName: string;
  /** What this user named their assistant — it introduces itself by it. */
  assistantName: string;
  perms: Set<string>;
  /** The user's own client (RLS) — every data tool reads through it. */
  db: SupabaseClient;
  /** Service role — persistence and the reads the app already serves this way. */
  admin: SupabaseClient;
  conversation: AssistantConversation;
  text: string;
  emit: (event: AssistantStreamEvent) => void;
  /** The user's Stop. */
  signal: AbortSignal;
  now?: Date;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * What went wrong, in words a user (or the admin they forward it to) can act
 * on. NEVER names a vendor or model — to users the assistant runs on SED AI —
 * and never echoes a vendor's own error text, which often names itself. The
 * raw failure is logged server-side for whoever debugs it.
 */
export function friendlyError(e: unknown): string {
  const status = e instanceof ProviderHttpError ? e.status : null;
  const msg = e instanceof Error ? e.message : String(e);
  if (/is not configured/i.test(msg)) {
    return "SED AI isn't set up yet. An admin can finish the setup under Admin → AI Models.";
  }
  if (status === 401 || status === 403) return "SED AI couldn't sign in to its AI service. An admin should check Admin → AI Models.";
  if (status === 402) return "SED AI's AI service has run out of credit. An admin needs to top it up.";
  if (status === 429) return "SED AI is busy right now. Try again in a minute.";
  if (msg.includes(CALL_TIMEOUT_MARKER)) return "SED AI took too long to respond. Try again — a narrower question helps.";
  if (status !== null && status >= 500) return "SED AI is having trouble right now. Try again in a moment.";
  if (status === 400) return "SED AI couldn't process that request. Try rephrasing it, or start a new chat.";
  return "Something went wrong while answering. Try again.";
}

async function departmentsOf(admin: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await admin.from("department_members").select("departments(name)").eq("user_id", userId);
  return (data ?? [])
    .map((r) => {
      const d = (r as { departments?: { name?: string } | { name?: string }[] | null }).departments;
      return Array.isArray(d) ? d[0]?.name : d?.name;
    })
    .filter((n): n is string => typeof n === "string" && n.length > 0);
}

/** "MiniMax · MiniMax-M3" — for server logs only; users only ever see SED AI. */
export function modelLabel(r: Pick<ResolvedTaskModel, "providerKey" | "model">): string {
  return `${getProvider(r.providerKey)?.label ?? r.providerKey} · ${r.model}`;
}

export async function runTurn(input: TurnInput): Promise<void> {
  const { userId, admin, conversation, emit, signal } = input;
  const now = input.now ?? new Date();
  const turnId = randomUUID();

  // The question is saved before anything can fail, so it is never lost.
  await insertMessage(admin, userId, conversation.id, { id: turnId, turn_id: turnId, role: "user", content: input.text });

  let resolved: ResolvedTaskModel;
  try {
    resolved = await resolveTaskModelCached("assistant_chat");
  } catch (e) {
    const message = friendlyError(e);
    await insertMessage(admin, userId, conversation.id, { role: "assistant", turn_id: turnId, content: "", status: "error", error: message }).catch(() => {});
    emit({ type: "error", message });
    return;
  }

  emit({ type: "start", conversation: toClientConversation(conversation), userMessageId: turnId });

  const data = new TurnData({ db: input.db, admin, userId });
  const [settings, memories, departments, teamIds, rows] = await Promise.all([
    getAppSettings(),
    listMemories(admin, userId).catch(() => []),
    departmentsOf(admin, userId).catch(() => []),
    data.teamAgentIds(),
    listMessages(admin, userId, conversation.id),
  ]);
  const timezone = settings.work_timezone || "Asia/Karachi";

  const toolCtx: ToolContext = {
    userId,
    displayName: input.displayName,
    perms: input.perms,
    db: input.db,
    admin,
    timezone,
    now,
    conversationId: conversation.id,
    data,
    emit: (event) => emit(event),
  };
  const tools = toolsFor(input.perms);
  const definitions = toolDefinitions(tools);
  const system = buildSystemPrompt({
    companyName: settings.company_name || "the company",
    assistantName: input.assistantName,
    displayName: input.displayName,
    departments,
    timezone,
    now,
    scope: describeScope({ perms: input.perms, teamSize: teamIds.length }),
    memories,
  });
  const messages: WireMessage[] = [
    { role: "system", content: system },
    ...buildHistory(rows, { ...DEFAULT_HISTORY, provider: resolved.providerKey }),
  ];

  let model = resolved;
  let roundText = "";
  let emptyRetried = false;
  let anyOutput = false;

  try {
    for (let round = 0; ; round++) {
      if (signal.aborted) throw new AiCallAborted("assistant", signal.reason);
      const lastRound = round >= MAX_TOOL_ROUNDS;
      if (lastRound) {
        messages.push({
          role: "user",
          content: "[System note: the lookup budget for this answer is used up. Answer now from the results above, and do not call any more tools.]",
        });
      }

      roundText = "";
      const call = (m: ResolvedTaskModel) =>
        streamChat(m.spec, m.model, messages, {
          tools: definitions.length ? definitions : undefined,
          toolChoice: lastRound ? "none" : undefined,
          maxTokens: m.outputTokens,
          temperature: TEMPERATURE,
          signal,
          onText: (d) => {
            roundText += d;
            anyOutput = true;
            emit({ type: "text", delta: d });
          },
          onReasoning: (d) => emit({ type: "reasoning", delta: d }),
          onRetry: () => {
            roundText = "";
            emit({ type: "reset" });
          },
        });

      let result: ChatResult;
      try {
        result = await call(model);
      } catch (e) {
        // A CONFIGURATION failure on the very first round (a bad key, a
        // retired model) gets one try on the task's default model — the same
        // safety net every other AI task has. Busy or throttled is not that:
        // it has already had its retries.
        if (round > 0 || anyOutput || isAbortedError(e) || isRetryableError(e)) throw e;
        const fallback = await defaultSpecForTask("assistant_chat").catch(() => null);
        if (!fallback || (fallback.providerKey === model.providerKey && fallback.model === model.model)) throw e;
        console.warn(`[assistant] ${modelLabel(model)} failed (${e instanceof Error ? e.message : String(e)}) — retrying on ${modelLabel(fallback)}`);
        model = fallback;
        emit({ type: "reset" });
        result = await call(model);
      }

      const calls = lastRound ? [] : result.toolCalls;
      if (!calls.length && !result.text.trim()) {
        if (!emptyRetried && !lastRound) {
          // Models occasionally return nothing at all; one more try usually
          // answers. Whatever reasoning streamed for the empty round is void.
          emptyRetried = true;
          emit({ type: "reset" });
          continue;
        }
        const message =
          result.finishReason === "length"
            ? "SED AI used its whole answer budget thinking and never got to the answer. Try a narrower question — or an admin can raise the SED Assistant's max output tokens under Admin → AI Models."
            : "SED AI returned an empty answer. Try rephrasing the question.";
        await insertMessage(admin, userId, conversation.id, {
          role: "assistant",
          turn_id: turnId,
          content: "",
          reasoning: result.reasoning || null,
          provider: model.providerKey,
          model: model.model,
          usage: result.usage,
          status: "error",
          error: message,
        });
        emit({ type: "error", message });
        return;
      }

      const row = await insertMessage(admin, userId, conversation.id, {
        role: "assistant",
        turn_id: turnId,
        content: result.text,
        reasoning: result.reasoning || null,
        tool_calls: calls.length ? calls : null,
        provider: model.providerKey,
        model: model.model,
        usage: result.usage,
      });

      if (!calls.length) {
        await updateConversation(admin, userId, conversation.id, {
          last_message_at: new Date().toISOString(),
          last_provider: model.providerKey,
          last_model: model.model,
        }).catch(() => null);
        emit({ type: "done", messageId: row.id, stopped: false });
        return;
      }

      // Continue the chain with the assistant turn EXACTLY as the vendor sent
      // it — MiniMax's think block and Gemini's signatures included.
      messages.push(result.message);
      const outcomes = await mapLimit(calls, TOOL_CONCURRENCY, async (c): Promise<ToolRunOutcome> => {
        emit({
          type: "tool_start",
          callId: c.id,
          name: c.function.name,
          label: ALL_TOOLS.find((t) => t.name === c.function.name)?.label ?? c.function.name,
          args: parseToolArgs(c.function.arguments) ?? {},
        });
        const outcome = await runTool(c.function.name, c.function.arguments, toolCtx);
        emit({ type: "tool_end", callId: c.id, name: c.function.name, ok: outcome.ok, summary: outcome.summary, durationMs: outcome.durationMs });
        return outcome;
      });
      for (let i = 0; i < calls.length; i++) {
        const c = calls[i];
        const outcome = outcomes[i];
        await insertMessage(admin, userId, conversation.id, {
          role: "tool",
          turn_id: turnId,
          tool_call_id: c.id,
          tool_name: c.function.name,
          content: outcome.content,
          meta: { label: outcome.label, ok: outcome.ok, summary: outcome.summary, duration_ms: outcome.durationMs, args: outcome.args },
        });
        messages.push({ role: "tool", tool_call_id: c.id, name: c.function.name, content: outcome.content });
      }
    }
  } catch (e) {
    const stopped = isAbortedError(e) || signal.aborted;
    if (!stopped) console.error("[assistant] answer failed:", e);
    const message = stopped ? null : friendlyError(e);
    const saved = await insertMessage(admin, userId, conversation.id, {
      role: "assistant",
      turn_id: turnId,
      content: roundText,
      provider: model.providerKey,
      model: model.model,
      status: stopped ? "stopped" : "error",
      error: message,
    }).catch(() => null);
    await updateConversation(admin, userId, conversation.id, { last_message_at: new Date().toISOString() }).catch(() => null);
    if (stopped) emit({ type: "done", messageId: saved?.id ?? null, stopped: true });
    else emit({ type: "error", message: message! });
  }
}
