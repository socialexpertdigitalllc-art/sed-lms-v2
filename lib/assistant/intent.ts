/**
 * Does a message read like a TASK ("create a lead for…", "mark Jumbo's as
 * closed", "remind me tomorrow…") rather than a question? Used only for a hint
 * in the message box — "Switch to Act?" — the assistant itself also decides,
 * and asks to switch on its own. PURE; deliberately conservative: a question
 * ("how many leads did I create?") is never a task.
 */

const TASK_START =
  /^(please\s+|pls\s+|can you\s+|could you\s+|kindly\s+|go ahead and\s+)?(create|add|submit|log|mark|move|assign|reassign|give|send|email|mail|schedule|reschedule|remind|tag|untag|archive|delete|remove|update|change|set|edit|rename|open|close|resolve|reopen|start|build|generate|regenerate|deploy|publish|buy|register|renew|cancel|resend|approve|discard|reject|import|grant|revoke|enable|disable|turn on|turn off|activate|deactivate|make|put|book|transfer|link|take down|restore|draft|write and send|file|raise)\b/i;

const QUESTION = /^(how|what|which|who|whom|whose|why|when|where|is|are|was|were|do|does|did|should|would|will|have|has|show|tell|list|compare|give me (a|the) (summary|breakdown|overview|report))\b/i;

/** Roman-Urdu task verbs agents type ("lead bana do", "status change kar do"). */
const URDU_TASK = /\b(bana do|banao|kar do|kardo|kr do|krdo|bhej do|bhejo|daal do|dal do|laga do|hata do|update kar|add kar)\b/i;

export function looksLikeTask(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  if (QUESTION.test(t) || /\?\s*$/.test(t)) return false;
  return TASK_START.test(t) || URDU_TASK.test(t);
}
