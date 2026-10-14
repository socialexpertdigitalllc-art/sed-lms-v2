import type { SupabaseClient } from "@supabase/supabase-js";
import { actAs, ActAsError } from "@/lib/auth/actAs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getAppSettings } from "@/lib/settings/appSettings";
import { type ActionCard } from "../actions/card";
import { bell, isAdminMember, permissionsOf } from "../actions/people";
import { ActionFailure, cancelAction, confirmAction, failureMessage, requestApproval } from "../actions/run";
import { ACTIONS_MIGRATION_MESSAGE, isMissingActionTables, toCard } from "../actions/store";
import type { ActionContext, StoredAction } from "../actions/types";
import { runTurn } from "../engine";
import { assistantNameFrom, DEFAULT_ASSISTANT_NAME } from "../name";
import { endRun, startRun } from "../runs";
import { createConversation, getConversation, latestQuestion } from "../store";
import { answerText, applyEvent, liveTurn, type TurnModel } from "../turns";
import type { AssistantConversation } from "../types";
import { publicOrigin } from "./config";
import { decide, isOpenAction, listingFor, stillOpenLine, type Decision } from "./decide";
import { answerToChat, cardToText, outcomeText } from "./format";
import { alreadySeen, consumeLinkCode, findLink, linkAttemptsBlocked, noteFailedLinkAttempt, saveLink, updateLink, type ChannelLink } from "./links";
import { isLinkCode, parseCommand, type InboundCommand } from "./parse";
import { markRead, sendText, sendTyping } from "./send";
import { CHANNEL_LABEL, type Channel, type InboundMessage } from "./types";

/**
 * What happens to a message from a phone. SERVER ONLY — called from the
 * Telegram and WhatsApp webhooks (in after(), once the platform has its 200).
 *
 *   unlinked chat → a link code links it; anything else gets one line saying
 *                   how to link it, and nothing more.
 *   linked chat   → as the person who linked it (actAs: their session, their
 *                   permissions, row-level security), either a decision on a
 *                   proposal (YES / NO / the confirmation words) or a question
 *                   for their assistant, answered in their phone conversation.
 *
 * The person's text is their message and only that: it is classified (code,
 * decision, message) and otherwise handed to the assistant word for word.
 */

export const MESSAGES = {
  notLinked: "This chat is not linked. In SED AI, open Actions → Reminders & automations → Phone and link it.",
  badCode: "That code is not valid or has expired. Get a new one in SED AI: Actions → Reminders & automations → Phone.",
  tooManyCodes: "Too many wrong codes. Wait a few minutes, then get a new code in SED AI.",
  noAccess: "Your account cannot use SED AI. Ask an admin for access.",
  deactivated: "This SED AI account is deactivated, so this chat has been unlinked.",
  textOnly: "I can only read text messages here. Type your question, or what you need done.",
  busy: "Still working on your last message…",
  signInFailed: "SED AI could not sign in to your account just now. Try again in a minute.",
  failed: "Something went wrong. Try again in a minute.",
  notSetUp: "SED AI isn't fully set up for phones yet. An admin needs to finish the setup.",
} as const;

/** How long one answer may take before it is stopped. */
export const TURN_TIMEOUT_MS = 5 * 60_000;
const TIMEOUT_REASON = "timeout";
const MAX_MESSAGE_CHARS = 8000;
/** Telegram shows "typing…" for about five seconds per call. */
const TYPING_EVERY_MS = 4_500;

export interface ChannelDeps {
  admin: SupabaseClient;
  /** Send a reply to the chat. */
  send: (channel: Channel, to: string, text: string) => Promise<void>;
  /** Platform niceties — read ticks, "typing…". Best effort. */
  presence: (msg: InboundMessage, what: "read" | "typing") => Promise<void>;
  /** The app's public address, for links in replies. */
  origin: string;
  now: () => Date;
}

function defaultDeps(overrides: Partial<ChannelDeps>): ChannelDeps {
  return {
    admin: overrides.admin ?? createAdminClient(),
    send: overrides.send ?? sendText,
    presence: overrides.presence ?? ((msg, what) => (what === "read" ? markRead(msg.channel, msg.messageId) : sendTyping(msg.channel, msg.externalId))),
    origin: overrides.origin ?? publicOrigin(),
    now: overrides.now ?? (() => new Date()),
  };
}

type Reply = (text: string) => Promise<void>;

interface Profile {
  display_name: string | null;
  email: string | null;
  ui_preferences: unknown;
  is_active: boolean | null;
}

async function loadProfile(admin: SupabaseClient, userId: string): Promise<Profile | null> {
  const { data, error } = await admin.from("profiles").select("display_name, email, ui_preferences, is_active").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Profile | null) ?? null;
}

/** Their name as the app shows it (what assistantGuard uses), or null when there is none. */
const nameOf = (p: Profile): string | null => p.display_name?.trim() || p.email?.split("@")[0] || null;
/** "Sam's SED AI" / "your SED AI". */
const whoseAssistant = (p: Profile) => {
  const name = nameOf(p);
  return name ? `${name}'s SED AI` : "your SED AI";
};

/** The conversation's recent actions, newest first (a long-lived phone chat can have many). */
async function recentActions(admin: SupabaseClient, userId: string, conversationId: string): Promise<StoredAction[]> {
  const { data, error } = await admin
    .from("assistant_actions")
    .select("*")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as StoredAction[];
}

/* ------------------------------------------------------------- entry */

/** Handle one message from a phone. Never throws: whatever happens, the chat hears back. */
export async function handleInbound(msg: InboundMessage, overrides: Partial<ChannelDeps> = {}): Promise<void> {
  if (alreadySeen(`${msg.channel}:${msg.messageId}`)) return;
  let deps: ChannelDeps;
  try {
    deps = defaultDeps(overrides);
  } catch (e) {
    console.error("[assistant/channels] not configured:", e instanceof Error ? e.message : e);
    return;
  }
  const reply: Reply = async (text) => {
    try {
      await deps.send(msg.channel, msg.externalId, text);
    } catch (e) {
      console.error(`[assistant/channels] reply on ${msg.channel} failed:`, e instanceof Error ? e.message : "unknown error");
    }
  };
  try {
    await route(msg, deps, reply);
  } catch (e) {
    if (isMissingActionTables(e)) {
      console.error("[assistant/channels] migration 0087 is not applied");
      await reply(MESSAGES.notSetUp);
      return;
    }
    console.error("[assistant/channels] message failed:", e);
    await reply(MESSAGES.failed);
  }
}

/** Several messages at once (WhatsApp batches): in order per chat, chats side by side. */
export async function handleInboundAll(messages: InboundMessage[], overrides: Partial<ChannelDeps> = {}): Promise<void> {
  const byChat = new Map<string, InboundMessage[]>();
  for (const m of messages) byChat.set(`${m.channel}:${m.externalId}`, [...(byChat.get(`${m.channel}:${m.externalId}`) ?? []), m]);
  await Promise.all(
    [...byChat.values()].map(async (list) => {
      for (const m of list) await handleInbound(m, overrides);
    }),
  );
}

async function route(msg: InboundMessage, deps: ChannelDeps, reply: Reply): Promise<void> {
  const text = (msg.text ?? "").trim();
  const cmd: InboundCommand = msg.text === null ? { kind: "message" } : parseCommand(text);
  if (cmd.kind === "link") return linkChat(msg, cmd.code, deps, reply);

  const link = await findLink(deps.admin, msg.channel, msg.externalId);
  if (!link || !link.active) {
    if (cmd.kind === "code") return linkChat(msg, cmd.code, deps, reply);
    return reply(MESSAGES.notLinked);
  }
  // A renamed Telegram account shows under its new @username in the app.
  const relabel = msg.label && msg.label !== link.label ? { label: msg.label } : {};
  await updateLink(deps.admin, link.id, { last_seen_at: deps.now().toISOString(), ...relabel }).catch(() => {});
  if (msg.text === null) return reply(MESSAGES.textOnly);
  if (!text) return;
  return serveLinked(msg, link, text, cmd, deps, reply);
}

/* ------------------------------------------------------------- linking */

async function linkChat(msg: InboundMessage, code: string, deps: ChannelDeps, reply: Reply): Promise<void> {
  const key = `${msg.channel}:${msg.externalId}`;
  const now = deps.now();
  if (linkAttemptsBlocked(key, now.getTime())) return reply(MESSAGES.tooManyCodes);
  const claimed = isLinkCode(code) ? await consumeLinkCode(deps.admin, code, msg.channel, now) : null;
  if (!claimed) {
    noteFailedLinkAttempt(key, now.getTime());
    console.warn(`[assistant/channels] wrong link code on ${msg.channel}`);
    return reply(MESSAGES.badCode);
  }
  const profile = await loadProfile(deps.admin, claimed.userId);
  if (!profile || profile.is_active === false) return reply("That account is deactivated, so this chat was not linked.");

  // Same person again: keep their phone conversation. Someone else: a fresh one.
  const existing = await findLink(deps.admin, msg.channel, msg.externalId);
  let conversationId = existing && existing.user_id === claimed.userId ? existing.conversation_id : null;
  if (!conversationId) conversationId = (await createConversation(deps.admin, claimed.userId, CHANNEL_LABEL[msg.channel])).id;
  const link = await saveLink(deps.admin, { userId: claimed.userId, channel: msg.channel, externalId: msg.externalId, label: msg.label, conversationId, now });

  // So a link they did not make cannot go unnoticed.
  await bell(deps.admin, claimed.userId, {
    title: `${CHANNEL_LABEL[msg.channel]} linked to your SED AI`,
    body: `${msg.label ?? "A chat"} can now talk to your SED AI. Not you? Unlink it under SED AI → Actions → Reminders & automations → Phone.`,
    dedupKey: `assistant_channel_link:${link.id}:${now.getTime()}`,
    targetUrl: "/assistant/actions?tab=automations",
  }).catch(() => {});
  await reply(`Linked to ${whoseAssistant(profile)}. Ask me anything, or tell me what to do.`);
}

/* ------------------------------------------------------- a linked chat */

async function ensureConversation(admin: SupabaseClient, link: ChannelLink): Promise<AssistantConversation> {
  if (link.conversation_id) {
    const found = await getConversation(admin, link.user_id, link.conversation_id);
    if (found) return found;
  }
  // Never made, or deleted in the app: start the phone conversation again.
  const created = await createConversation(admin, link.user_id, CHANNEL_LABEL[link.channel]);
  await updateLink(admin, link.id, { conversation_id: created.id });
  return created;
}

async function serveLinked(msg: InboundMessage, link: ChannelLink, text: string, cmd: InboundCommand, deps: ChannelDeps, reply: Reply): Promise<void> {
  const { admin } = deps;
  const userId = link.user_id;
  const profile = await loadProfile(admin, userId);
  if (!profile || profile.is_active === false) return unlinkDeactivated(link, deps, reply);
  const perms = await permissionsOf(admin, userId);
  if (!perms.has("assistant.use")) return reply(MESSAGES.noAccess);
  const displayName = nameOf(profile) ?? "there";
  if (cmd.kind === "start") return reply(`This chat is linked to ${whoseAssistant(profile)}. Ask me anything, or tell me what to do.`);
  void deps.presence(msg, "read").catch(() => {});

  const conversation = await ensureConversation(admin, link);
  const canAct = perms.has("assistant.act");
  const now = deps.now();

  // Decisions on proposals need action mode, exactly as the Confirm button does.
  let decision: Decision = { kind: "none" };
  let actions: StoredAction[] = [];
  if (canAct) {
    const [recent, latest] = await Promise.all([recentActions(admin, userId, conversation.id), latestQuestion(admin, userId, conversation.id)]);
    actions = recent;
    decision = decide(text, cmd, actions, latest?.turnId ?? null, now.getTime());
  }
  if (decision.kind === "explain") return reply(decision.text);

  try {
    await actAs(userId, async () => {
      const [db, settings, isAdmin] = await Promise.all([
        createClient(),
        getAppSettings().catch(() => null),
        canAct ? isAdminMember(admin, userId).catch(() => false) : Promise.resolve(false),
      ]);
      const ctx: ActionContext = { userId, displayName, perms, db, admin, timezone: settings?.work_timezone || "Asia/Karachi", now, isAdmin };
      if (decision.kind === "confirm" || decision.kind === "cancel") {
        await reply(await applyDecision(decision, ctx, actions, deps.origin));
        return;
      }
      const assistantName = assistantNameFrom(profile.ui_preferences) ?? DEFAULT_ASSISTANT_NAME;
      await answer({ msg, text, ctx, conversation, assistantName, canAct, deps, reply });
    });
  } catch (e) {
    if (!(e instanceof ActAsError)) throw e;
    if (/deactivated|could not be found/i.test(e.message)) return unlinkDeactivated(link, deps, reply);
    console.warn(`[assistant/channels] could not act as a linked ${link.channel} user: ${e.message}`);
    return reply(MESSAGES.signInFailed);
  }
}

async function unlinkDeactivated(link: ChannelLink, deps: ChannelDeps, reply: Reply): Promise<void> {
  await updateLink(deps.admin, link.id, { active: false }).catch(() => {});
  await reply(MESSAGES.deactivated);
}

/** Bulk changes run on the records the card had ticked — what the app would send. */
function selectedItems(card: ActionCard): string[] | undefined {
  const items = card.items ?? [];
  return items.length && items.some((i) => !i.selected) ? items.filter((i) => i.selected).map((i) => i.id) : undefined;
}

/** YES / NO / the confirmation words, carried out as the person. Returns the reply. */
export async function applyDecision(
  d: Extract<Decision, { kind: "confirm" | "cancel" }>,
  ctx: ActionContext,
  actions: StoredAction[],
  origin: string,
): Promise<string> {
  const card = toCard(d.action, ctx.now.getTime());
  let out: ActionCard;
  try {
    if (d.kind === "cancel") out = await cancelAction(card.id, ctx);
    // They cannot do it themselves: YES sends it to the approvers instead.
    else if (card.approval) out = await requestApproval(card.id, ctx, null);
    // A sensitive change's YES is their "I've checked"; a critical one carries its typed words.
    else out = await confirmAction({ id: card.id, ctx, origin, phrase: d.phrase, selected: selectedItems(card) });
  } catch (e) {
    if (e instanceof ActionFailure) return e.message;
    if (isMissingActionTables(e)) return ACTIONS_MIGRATION_MESSAGE;
    console.error("[assistant/channels] decision failed:", e);
    return failureMessage(e);
  }
  const lines = [outcomeText(out, origin, ctx.now.getTime())];
  const still = stillOpenLine(actions, d.action.turn_id, card.id, ctx.now.getTime());
  if (still) lines.push(still);
  return lines.join("\n\n");
}

/* --------------------------------------------------------------- answer */

interface AnswerInput {
  msg: InboundMessage;
  text: string;
  ctx: ActionContext;
  conversation: AssistantConversation;
  assistantName: string;
  canAct: boolean;
  deps: ChannelDeps;
  reply: Reply;
}

async function answer(a: AnswerInput): Promise<void> {
  const { ctx, conversation, deps } = a;
  const claim = startRun(ctx.userId, conversation.id);
  if ("reason" in claim) return a.reply(claim.reason === "busy" ? MESSAGES.busy : claim.message);

  const timer = setTimeout(() => claim.controller.abort(TIMEOUT_REASON), TURN_TIMEOUT_MS);
  const typing = setInterval(() => void deps.presence(a.msg, "typing").catch(() => {}), TYPING_EVERY_MS);
  void deps.presence(a.msg, "typing").catch(() => {});
  let turn = liveTurn("phone", a.text);
  try {
    await runTurn({
      userId: ctx.userId,
      displayName: ctx.displayName,
      assistantName: a.assistantName,
      perms: ctx.perms,
      db: ctx.db,
      admin: ctx.admin,
      conversation,
      text: a.text.slice(0, MAX_MESSAGE_CHARS),
      emit: (event) => {
        turn = applyEvent(turn, event);
      },
      signal: claim.controller.signal,
      mode: a.canAct ? "act" : "ask",
      page: null,
      attachments: [],
      source: a.msg.channel,
    });
  } catch (e) {
    console.error("[assistant/channels] turn crashed:", e);
    turn = applyEvent(turn, { type: "error", message: "Something went wrong while answering. Try again." });
  } finally {
    clearTimeout(timer);
    clearInterval(typing);
    endRun(conversation.id, claim.controller);
  }
  const timedOut = claim.controller.signal.aborted && claim.controller.signal.reason === TIMEOUT_REASON;
  const cards = a.canAct ? await proposedCards(ctx, conversation.id, turn) : [];
  await a.reply(turnReplyText(turn, cards, deps.origin, timedOut));
}

/** This answer's proposals as they stand now (a corrected one replaces the first), numbered when several. */
async function proposedCards(ctx: ActionContext, conversationId: string, turn: TurnModel): Promise<{ card: ActionCard; n: number | null }[]> {
  const now = Date.now();
  const fresh = await recentActions(ctx.admin, ctx.userId, conversationId).catch(() => null);
  if (!fresh) {
    const open = turn.actions.filter((c) => c.status === "proposed");
    return open.map((card, i) => ({ card, n: open.length > 1 ? i + 1 : null }));
  }
  const listing = listingFor(fresh, turn.id);
  return listing.filter((a) => isOpenAction(a, now)).map((a) => ({ card: toCard(a, now), n: listing.length > 1 ? listing.indexOf(a) + 1 : null }));
}

/** The reply to a question: the answer as chat text, then each proposal and how to answer it. */
export function turnReplyText(turn: TurnModel, cards: { card: ActionCard; n: number | null }[], origin: string, timedOut = false): string {
  const parts: string[] = [];
  const body = answerToChat(answerText(turn), origin);
  if (body) parts.push(body);
  for (const c of cards) parts.push(cardToText(c.card, { origin, n: c.n }));
  if (turn.status === "error") parts.push(turn.error || "Something went wrong while answering. Try again.");
  if (turn.status === "stopped") {
    parts.push(timedOut ? "(I stopped there: that took longer than 5 minutes. Try a narrower question.)" : "(Stopped.)");
  }
  if (!parts.length) parts.push("SED AI had no answer to that. Try rephrasing it.");
  return parts.join("\n\n");
}
