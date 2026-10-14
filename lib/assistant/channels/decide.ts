import type { StoredAction } from "../actions/types";
import { matchesPhrase, type InboundCommand } from "./parse";

/**
 * Which proposal a YES / NO from the phone is about. PURE.
 *
 * On the phone there are no buttons: the last reply listed the proposals its
 * question produced — numbered when there were several — and a reply refers
 * to them. The numbering is derived from the stored actions, so it is the
 * same when the reply is written and when the answer to it arrives:
 *
 *   the proposals of the conversation's LATEST question, oldest first.
 *
 * A YES or NO only decides something when that latest question proposed
 * something. Otherwise it is an answer to whatever the assistant last asked
 * ("Shall I also set a reminder?" — "yes") and goes to the assistant: an
 * older proposal is never confirmed by a YES meant for something else.
 *
 * A critical change's confirmation words decide it wherever it is listed —
 * nobody types "Jumbo's Pizza Ltd" by accident.
 */

/** A proposal withdrawn because the assistant corrected it — never shown, never numbered. */
const REPLACED = /^Replaced by a corrected proposal/;

export function isOpenAction(a: StoredAction, now: number): boolean {
  return a.status === "proposed" && Date.parse(a.expires_at) > now;
}

/** The proposals of one question, in the order they were made (plan steps in step order). */
export function listingFor(actions: StoredAction[], turnId: string | null | undefined): StoredAction[] {
  if (!turnId) return [];
  return actions
    .filter((a) => a.turn_id === turnId && !(a.status === "cancelled" && REPLACED.test(a.error ?? "")))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || (a.plan_index ?? 0) - (b.plan_index ?? 0));
}

export type Decision =
  /** Confirm it (`phrase` for a critical change). */
  | { kind: "confirm"; action: StoredAction; n: number | null; phrase?: string }
  | { kind: "cancel"; action: StoredAction; n: number | null }
  /** Nothing to do but say this. */
  | { kind: "explain"; text: string }
  /** Not a decision: a message for the assistant. */
  | { kind: "none" };

const numbersOf = (listing: StoredAction[], open: StoredAction[]) => open.map((a) => listing.indexOf(a) + 1);

function orList(ns: number[], word: string): string {
  const parts = ns.map((n) => `${word} ${n}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}` : parts[0];
}

const STATUS_WORDS: Record<StoredAction["status"], string> = {
  proposed: "is waiting for your answer.",
  executing: "is being done right now.",
  done: "is already done.",
  failed: "was tried and failed.",
  cancelled: "was cancelled.",
  expired: "has expired. Ask again for a fresh one.",
  undone: "was done and then undone.",
  awaiting_approval: "is waiting for an admin's approval.",
  rejected: "was turned down by an admin.",
};

function statusLine(a: StoredAction, n: number | null, now: number): string {
  const status = a.status === "proposed" && Date.parse(a.expires_at) <= now ? "expired" : a.status;
  return `${n ? `#${n} (${a.title})` : a.title} ${STATUS_WORDS[status]}`;
}

/** "YES" for a single proposal (it was shown without a number), else "YES 1, YES 2 or YES 3". */
function replyHint(listing: StoredAction[], open: StoredAction[], word: string): string {
  return listing.length > 1 ? orList(numbersOf(listing, open), word) : word;
}

/**
 * @param actions  the conversation's recent actions (any order)
 * @param latestTurnId  the turn id of the conversation's latest question
 */
export function decide(text: string, cmd: InboundCommand, actions: StoredAction[], latestTurnId: string | null, now = Date.now()): Decision {
  // A critical change's words, typed out.
  const byPhrase = actions
    .filter((a) => a.risk === "critical" && isOpenAction(a, now) && matchesPhrase(text, a.confirm_phrase))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (byPhrase) {
    const listing = listingFor(actions, byPhrase.turn_id);
    const n = listing.length > 1 ? listing.indexOf(byPhrase) + 1 : null;
    return { kind: "confirm", action: byPhrase, n, phrase: byPhrase.confirm_phrase ?? undefined };
  }

  if (cmd.kind !== "confirm" && cmd.kind !== "cancel") return { kind: "none" };
  const listing = listingFor(actions, latestTurnId);
  if (!listing.length) return { kind: "none" };
  const open = listing.filter((a) => isOpenAction(a, now));
  const word = cmd.kind === "confirm" ? "YES" : "NO";

  let target: StoredAction;
  let n: number | null = null;
  if (cmd.n !== null) {
    const picked = listing[cmd.n - 1];
    if (!picked) {
      return {
        kind: "explain",
        text: open.length
          ? `There is no #${cmd.n}. Reply ${replyHint(listing, open, word)}.`
          : `There is no #${cmd.n}, and nothing is waiting for your answer.`,
      };
    }
    if (!isOpenAction(picked, now)) return { kind: "explain", text: statusLine(picked, listing.length > 1 ? cmd.n : null, now) };
    target = picked;
    n = listing.length > 1 ? cmd.n : null;
  } else {
    // Everything listed is already decided: a plain YES / NO answers the assistant.
    if (!open.length) return { kind: "none" };
    if (open.length > 1) {
      return { kind: "explain", text: `Which one? Reply ${replyHint(listing, open, word)}.` };
    }
    target = open[0];
    n = listing.length > 1 ? listing.indexOf(target) + 1 : null;
  }
  if (cmd.kind === "cancel") return { kind: "cancel", action: target, n };
  // A high-impact change is confirmed with its words, never a bare YES —
  // unless it goes to an approver, who confirms it for them.
  if (target.risk === "critical" && !target.card?.approval) {
    const no = `NO${n ? ` ${n}` : ""}`;
    return {
      kind: "explain",
      text: target.confirm_phrase
        ? `${n ? `#${n} (${target.title})` : target.title} is a high-impact change. To confirm it, type "${target.confirm_phrase}" — or reply ${no} to cancel.`
        : `${target.title} is a high-impact change: confirm it in SED AI, or reply ${no} to cancel.`,
    };
  }
  return { kind: "confirm", action: target, n };
}

/** "Still waiting: 2) Open a ticket. Reply YES 2 to confirm." for what is left of the listing. */
export function stillOpenLine(actions: StoredAction[], listingTurnId: string | null, exceptId: string, now = Date.now()): string | null {
  const listing = listingFor(actions, listingTurnId);
  const rest = listing.filter((a) => a.id !== exceptId && isOpenAction(a, now));
  if (!rest.length || listing.length < 2) return null;
  const ns = numbersOf(listing, rest);
  const titles = rest.map((a, i) => `${ns[i]}) ${a.title}`).join("; ");
  return `Still waiting: ${titles}. Reply ${orList(ns, "YES")} to confirm.`;
}
