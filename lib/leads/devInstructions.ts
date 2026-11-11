/**
 * "Instructions for Developer" as a list: the agent adds them one item at a
 * time, each at most 50 words, so the developer receives a numbered list
 * rather than a wall of text. Stored on the lead as numbered lines
 * ("1. …\n2. …") in the same `developer_instructions` text column, which is
 * also what Site Builder's "Additional instructions" box is filled with.
 */

export const MAX_INSTRUCTION_WORDS = 50;
export const MAX_INSTRUCTION_ITEMS = 15;

/** Words in one item (runs of non-space characters). */
export function wordCount(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** One item as it will be saved: one line, single spaces. */
export function cleanItem(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** The filled items, cleaned. */
export function instructionItems(items: string[]): string[] {
  return items.map(cleanItem).filter(Boolean);
}

/** The text saved on the lead: "1. first\n2. second", or null when there are none. */
export function formatInstructions(items: string[]): string | null {
  const list = instructionItems(items);
  return list.length ? list.map((t, i) => `${i + 1}. ${t}`).join("\n") : null;
}

/** Saved text back to items (numbered, bulleted or plain lines all read back). */
export function parseInstructions(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, ""))
    .map(cleanItem)
    .filter(Boolean);
}

/** The first problem with a list, or null. */
export function instructionsError(items: string[]): string | null {
  const list = instructionItems(items);
  if (list.length > MAX_INSTRUCTION_ITEMS) return `At most ${MAX_INSTRUCTION_ITEMS} instructions.`;
  const i = list.findIndex((t) => wordCount(t) > MAX_INSTRUCTION_WORDS);
  if (i >= 0) return `Instruction ${i + 1} is ${wordCount(list[i])} words — keep each one to ${MAX_INSTRUCTION_WORDS} words or fewer.`;
  return null;
}

/**
 * Free text (SED AI, an old note) as list items that each fit the limit:
 * one item per line, a long line split at sentence ends, and a sentence still
 * over the limit cut every 50 words. Nothing is dropped.
 */
export function toInstructionItems(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const line of parseInstructions(text)) {
    if (wordCount(line) <= MAX_INSTRUCTION_WORDS) {
      out.push(line);
      continue;
    }
    let cur: string[] = [];
    const flush = () => {
      if (cur.length) out.push(cur.join(" "));
      cur = [];
    };
    for (const sentence of line.split(/(?<=[.!?;])\s+/)) {
      const words = sentence.split(/\s+/).filter(Boolean);
      if (cur.length + words.length <= MAX_INSTRUCTION_WORDS) {
        cur.push(...words);
        continue;
      }
      flush();
      for (let i = 0; i < words.length; i += MAX_INSTRUCTION_WORDS) {
        const chunk = words.slice(i, i + MAX_INSTRUCTION_WORDS);
        if (chunk.length === MAX_INSTRUCTION_WORDS) out.push(chunk.join(" "));
        else cur = chunk;
      }
    }
    flush();
  }
  return out;
}
