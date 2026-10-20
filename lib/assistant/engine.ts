import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AiCallAborted, isAbortedError } from "@/lib/ai-tools/abort";
import { defaultSpecForTask, type ResolvedTaskModel } from "@/lib/ai-tools/providers/config";
import { resolveTaskModelCached } from "@/lib/ai-tools/providers/run";
import { getModel, getProvider, type AiTaskKey } from "@/lib/ai-tools/providers/registry";
import { isRetryableError, ProviderHttpError, CALL_TIMEOUT_MARKER } from "@/lib/ai-tools/providers/errors";
import { isAdminMember } from "@/lib/permissions/isAdminMember";
import { getAppSettings } from "@/lib/settings/appSettings";
import { AUTO_RUNS_PER_TURN, clampMode, DEFAULT_ACT_PERMISSIONS, type PermissionMode } from "./actions/permissions";
import { getActPermissions, getPermissionCap } from "./actions/permissionStore";
import { resolveRef } from "./actions/refs";
import { actionCatalogue } from "./actions/registry";
import type { AutoRunContext } from "./actions/run";
import { getActionSettings, listConversationActions } from "./actions/store";
import type { ActionContext, RefKind, StoredAction } from "./actions/types";
import { buildHistory, DEFAULT_HISTORY } from "./history";
import { streamChat, type ChatResult, type UserContentPart, type WireMessage } from "./llm";
import { buildSystemPrompt, describeScope, type ActPromptFacts } from "./prompt";
import { insertMessage, listMemories, listMessages, updateConversation } from "./store";
import { parseToolArgs, runTool, toolDefinitions, toolsFor, ALL_TOOLS, type ToolRunOutcome } from "./tools";
import { TurnData } from "./tools/data";
import type { ToolContext } from "./tools/types";
import type { AssistantConversation, AssistantMode, AssistantStreamEvent, MessageAttachment, MessageMeta, PageContext } from "./types";
import { getUpload, signedUploadUrl } from "./uploads";
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
/** Act mode looks up, describes, prepares and re-prepares: a little more room. */
export const MAX_ACT_ROUNDS = 12;
/**
 * Act with a permission mode that lets changes run on their own: a big job
 * ("categorise the whole pipeline") is worked through batch after batch in
 * ONE answer, so it gets far more room. Older lookups are trimmed as it goes
 * (see compactToolResults), so the context stays small however long it runs.
 */
export const MAX_AUTONOMOUS_ROUNDS = 60;
/** Lookup results from this many most recent rounds stay whole; older ones are trimmed. */
export const KEEP_RECENT_ROUNDS = 3;
const TOOL_CONCURRENCY = 4;

/** A tool result in the running conversation, for trimming later. */
interface ToolSlot {
  index: number;
  round: number;
  summary: string;
  trimmed: boolean;
}

/**
 * Replace tool results older than the last KEEP_RECENT_ROUNDS rounds with
 * their one-line summary. The calls stay paired with their results (only the
 * content shrinks), so every vendor accepts the chain. PURE apart from the
 * arrays it is given. Returns how many were trimmed.
 */
export function compactToolResults(messages: WireMessage[], slots: ToolSlot[], round: number): number {
  let n = 0;
  for (const slot of slots) {
    if (slot.trimmed || slot.round >= round - KEEP_RECENT_ROUNDS) continue;
    const m = messages[slot.index];
    if (!m || m.role !== "tool") continue;
    messages[slot.index] = {
      ...m,
      content: JSON.stringify({ trimmed: "An earlier result, shortened to save room. Call the tool again if you need its details.", summary: slot.summary }),
    };
    slot.trimmed = true;
    n++;
  }
  return n;
}
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
  /** Ask (default) or Act. Act needs assistant.act; without it this is Ask. */
  mode?: AssistantMode;
  /** Where they are in the app (the floating chat sends it). */
  page?: PageContext | null;
  /** Files attached to this question (already saved, owned by the user). */
  attachments?: MessageAttachment[];
  /** Where the question came from — recorded on any action it prepares. */
  source?: StoredAction["source"];
  /** The address people reach the app at — links in what an action did. */
  origin?: string;
  /** The permission mode picked in the chat for this question; otherwise the
   *  person's saved one. Always clamped to the company limit. */
  permissionMode?: PermissionMode;
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

const taskFor = (mode: AssistantMode): AiTaskKey => (mode === "act" ? "assistant_act" : "assistant_chat");

/** How many of a chat's latest actions the model is told about. */
const HISTORY_ACTIONS = 20;

/** How each of this chat's actions stands, for the model (newest last). */
export function actionHistoryLines(actions: StoredAction[], now = Date.now()): string[] {
  return actions.slice(-HISTORY_ACTIONS).map((a) => {
    const open = a.status === "proposed" || a.status === "awaiting_approval";
    const status = open && Date.parse(a.expires_at) < now ? "expired" : a.status;
    const link = a.result?.link?.href ? ` (${a.result.link.href})` : "";
    const outcome =
      status === "proposed"
        ? "waiting for them to confirm on its card"
        : status === "awaiting_approval"
          ? "sent to an admin for approval"
          : status === "executing"
            ? "running now"
            : status === "done"
              ? `DONE — ${a.result?.message ?? "done"}${link}`
              : status === "failed"
                ? `FAILED — ${a.error ?? "it could not be done"}`
                : status === "cancelled"
                  ? a.error ? `withdrawn (${a.error})` : "cancelled by them"
                  : status === "undone"
                    ? `done, then UNDONE by them`
                    : status === "rejected"
                      ? `turned down by the approver${a.approval_note ? `: “${a.approval_note}”` : ""}`
                      : "expired before anyone confirmed it";
    return `- [${a.id}] ${a.title} — ${outcome}`;
  });
}

const PAGE_REFS: { re: RegExp; kind: RefKind; noun: string }[] = [
  { re: /^\/leads\/([0-9a-f-]{36})(?:\/|$)/i, kind: "lead", noun: "the lead" },
  { re: /^\/pre-leads\/([0-9a-f-]{36})(?:\/|$)/i, kind: "pre_lead", noun: "the pre-lead" },
  { re: /^\/tickets\/([0-9a-f-]{36})(?:\/|$)/i, kind: "ticket", noun: "the ticket" },
  { re: /^\/ai-tools\/site-builder\/runs\/([0-9a-f-]{36})(?:\/|$)/i, kind: "site_run", noun: "the Site Builder run" },
  { re: /^\/domains\/([0-9a-f-]{36})(?:\/|$)/i, kind: "domain", noun: "the domain" },
  { re: /^\/forms\/endpoints\/([0-9a-f-]{36})(?:\/|$)/i, kind: "form_endpoint", noun: "the contact form" },
];

/** "the lead “Jumbo's Pizza” (Ready · Sam; /leads/…, id …)" — or the page's name. */
export async function describePage(page: PageContext | null | undefined, ctx: ActionContext): Promise<string | null> {
  if (!page?.path || !page.path.startsWith("/")) return null;
  const path = page.path.split(/[?#]/)[0];
  for (const p of PAGE_REFS) {
    const m = p.re.exec(path);
    if (!m) continue;
    const r = await resolveRef(p.kind, m[1], ctx).catch(() => null);
    if (r?.ok) return `${p.noun} “${r.hit.label}” (${[r.hit.detail, `${path}`, `id ${r.hit.id}`].filter(Boolean).join("; ")})`;
    return null;
  }
  const title = (page.title ?? "").replace(/\s*[|·–-]\s*SED.*$/i, "").trim();
  return `the ${title || path} page (${path})`;
}

export async function runTurn(input: TurnInput): Promise<void> {
  const { userId, admin, conversation, emit, signal } = input;
  const now = input.now ?? new Date();
  const turnId = randomUUID();

  const canAct = input.perms.has("assistant.act");
  let mode: AssistantMode = canAct && input.mode === "act" ? "act" : "ask";
  const attachments = input.attachments ?? [];
  const questionMeta: MessageMeta = {
    ...(attachments.length ? { attachments } : {}),
    ...(canAct ? { mode } : {}),
    ...(input.page?.path ? { page: input.page } : {}),
  };

  // The question is saved before anything can fail, so it is never lost.
  await insertMessage(admin, userId, conversation.id, {
    id: turnId,
    turn_id: turnId,
    role: "user",
    content: input.text,
    ...(Object.keys(questionMeta).length ? { meta: questionMeta } : {}),
  });

  let resolved: ResolvedTaskModel;
  try {
    resolved = await resolveTaskModelCached(taskFor(mode));
  } catch (e) {
    const message = friendlyError(e);
    await insertMessage(admin, userId, conversation.id, { role: "assistant", turn_id: turnId, content: "", status: "error", error: message }).catch(() => {});
    emit({ type: "error", message });
    return;
  }

  emit({ type: "start", conversation: toClientConversation(conversation), userMessageId: turnId });

  const data = new TurnData({ db: input.db, admin, userId });
  const [settings, memories, departments, teamIds, rows, isAdmin, chatActions, actionSettings, savedPermissions, permissionCap] = await Promise.all([
    getAppSettings(),
    listMemories(admin, userId).catch(() => []),
    departmentsOf(admin, userId).catch(() => []),
    data.teamAgentIds(),
    listMessages(admin, userId, conversation.id),
    canAct ? isAdminMember(admin, userId).catch(() => false) : Promise.resolve(false),
    // Missing tables (migration 0087 not applied) simply mean no actions yet.
    canAct ? listConversationActions(admin, userId, conversation.id, HISTORY_ACTIONS).catch(() => [] as StoredAction[]) : Promise.resolve([] as StoredAction[]),
    canAct ? getActionSettings(admin) : Promise.resolve(new Map()),
    canAct ? getActPermissions(admin, userId) : Promise.resolve(DEFAULT_ACT_PERMISSIONS),
    canAct ? getPermissionCap(admin) : Promise.resolve("ask" as PermissionMode),
  ]);
  // What may run without a click this turn (see ./actions/permissions.ts).
  const auto: AutoRunContext | null = canAct
    ? {
        mode: clampMode(input.permissionMode ?? savedPermissions.mode, permissionCap),
        cap: permissionCap,
        allow: savedPermissions.allow,
        origin: input.origin ?? process.env.WGE_SELF_ORIGIN ?? "http://localhost:3000",
        budget: { left: AUTO_RUNS_PER_TURN },
      }
    : null;
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
    ...(canAct ? { act: { mode, turnId, source: input.source ?? "chat", isAdmin, auto } } : {}),
  };
  const actionCtx: ActionContext = { userId, displayName: input.displayName, perms: input.perms, db: input.db, admin, timezone, now, isAdmin };
  const page = await describePage(input.page, actionCtx).catch(() => null);
  const disabled = new Set([...actionSettings.entries()].filter(([, v]) => !v.enabled).map(([k]) => k));

  /** Tools and prompt for a mode (rebuilt when the model switches itself to Act). */
  const setup = (m: AssistantMode) => {
    const tools = toolsFor(input.perms, m);
    const act: ActPromptFacts | null = canAct
      ? {
          mode: m,
          catalogue: m === "act" ? actionCatalogue(actionCtx, disabled) : undefined,
          history: actionHistoryLines(chatActions, now.getTime()),
          permission: auto ? { mode: auto.mode, allow: auto.allow } : null,
        }
      : null;
    const system = buildSystemPrompt({
      companyName: settings.company_name || "the company",
      assistantName: input.assistantName,
      displayName: input.displayName,
      departments,
      timezone,
      now,
      scope: describeScope({ perms: input.perms, teamSize: teamIds.length }),
      memories,
      act,
      page,
      channel: input.source === "telegram" || input.source === "whatsapp" ? input.source : null,
    });
    return { tools, definitions: toolDefinitions(tools), system };
  };

  // Images attached to THIS question go to a model that can see them.
  const imageUrls = async (m: ResolvedTaskModel): Promise<string[]> => {
    if (!attachments.length || !getModel(m.providerKey, m.model)?.vision) return [];
    const urls: string[] = [];
    for (const a of attachments.filter((f) => f.mime.startsWith("image/") && f.mime !== "image/svg+xml").slice(0, 4)) {
      const row = await getUpload(admin, userId, a.id).catch(() => null);
      const url = row ? await signedUploadUrl(admin, row, 3600).catch(() => null) : null;
      if (url) urls.push(url);
    }
    return urls;
  };
  const withImages = (list: WireMessage[], urls: string[]): WireMessage[] => {
    if (!urls.length) return list;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.role !== "user" || typeof m.content !== "string") continue;
      const parts: UserContentPart[] = [{ type: "text", text: m.content }, ...urls.map((url) => ({ type: "image_url" as const, image_url: { url } }))];
      list[i] = { role: "user", content: parts };
      break;
    }
    return list;
  };

  let { definitions, system } = setup(mode);
  const messages: WireMessage[] = withImages(
    [{ role: "system", content: system }, ...buildHistory(rows, { ...DEFAULT_HISTORY, provider: resolved.providerKey })],
    await imageUrls(resolved),
  );

  let model = resolved;
  const toolSlots: ToolSlot[] = [];
  // request_permission_mode was answered "asked": wrap up and wait for the click.
  let askedPermission = false;
  // A big job runs to the end in one answer when changes may run on their own.
  const autonomous = Boolean(auto && (auto.mode !== "ask" || auto.allow.length > 0));
  let roundText = "";
  let emptyRetried = false;
  let anyOutput = false;

  try {
    for (let round = 0; ; round++) {
      if (signal.aborted) throw new AiCallAborted("assistant", signal.reason);
      const maxRounds = mode === "act" ? (autonomous ? MAX_AUTONOMOUS_ROUNDS : MAX_ACT_ROUNDS) : MAX_TOOL_ROUNDS;
      const lastRound = round >= maxRounds || askedPermission;
      if (lastRound) {
        messages.push({
          role: "user",
          content: askedPermission
            ? "[System note: you asked them to switch the permission mode. Do not call any more tools now. In one or two sentences say what the switch is for and that the task carries on by itself once they switch.]"
            : mode === "act" && autonomous
              ? "[System note: this answer's budget is used up. Do not call any more tools. Say exactly how far the job got (what was done, what is left), and that they can say \"continue\" to carry on from there.]"
              : "[System note: the lookup budget for this answer is used up. Answer now from the results above, and do not call any more tools.]",
        });
      }
      // A long job: keep the context small by shortening old lookups.
      if (mode === "act" && round >= KEEP_RECENT_ROUNDS + 2) compactToolResults(messages, toolSlots, round);

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
        const fallback = await defaultSpecForTask(taskFor(mode)).catch(() => null);
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
      // Proposals (and the mode switch) run one at a time, in the order the
      // model asked for them; lookups run side by side.
      const sequential = calls.some((c) => ALL_TOOLS.find((t) => t.name === c.function.name)?.sequential);
      const outcomes = await mapLimit(calls, sequential ? 1 : TOOL_CONCURRENCY, async (c): Promise<ToolRunOutcome> => {
        emit({
          type: "tool_start",
          callId: c.id,
          name: c.function.name,
          label: ALL_TOOLS.find((t) => t.name === c.function.name)?.label ?? c.function.name,
          args: parseToolArgs(c.function.arguments) ?? {},
        });
        const callCtx: ToolContext = toolCtx.act ? { ...toolCtx, act: { ...toolCtx.act, callId: c.id, switchRequested: null } } : toolCtx;
        const outcome = await runTool(c.function.name, c.function.arguments, callCtx);
        if (callCtx.act?.askedPermission) askedPermission = true;
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
        toolSlots.push({ index: messages.length - 1, round, summary: outcome.summary, trimmed: false });
      }

      // The model recognised a task and switched itself to Act mode: from the
      // next round it has the action tools, the Act prompt — and the Act
      // model, when an admin chose a different one.
      const switchIndex = calls.findIndex((c, i) => c.function.name === "switch_to_action_mode" && outcomes[i].ok);
      if (mode === "ask" && canAct && switchIndex >= 0 && toolCtx.act) {
        mode = "act";
        toolCtx.act.mode = "act";
        const reason = String(parseToolArgs(calls[switchIndex].function.arguments)?.task ?? "").slice(0, 200);
        emit({ type: "mode", mode: "act", reason });
        ({ definitions, system } = setup("act"));
        const actModel = await resolveTaskModelCached("assistant_act").catch(() => null);
        if (actModel && (actModel.providerKey !== model.providerKey || actModel.model !== model.model)) {
          // A different model cannot continue another vendor's raw chain:
          // rebuild it from what is saved, in its own dialect.
          model = actModel;
          const saved = await listMessages(admin, userId, conversation.id);
          messages.length = 0;
          toolSlots.length = 0; // positions refer to the old chain
          messages.push(
            ...withImages(
              [{ role: "system", content: system }, ...buildHistory(saved, { ...DEFAULT_HISTORY, provider: model.providerKey })],
              await imageUrls(model),
            ),
          );
        } else {
          messages[0] = { role: "system", content: system };
        }
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
