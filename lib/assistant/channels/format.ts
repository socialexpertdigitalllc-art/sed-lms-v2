import { RISK_LABEL, STATUS_LABEL, type ActionCard } from "../actions/card";
import { parseMarkdown, type Block, type Inline } from "../markdown";

/**
 * Turning what SED AI says — and the changes it proposes — into plain chat
 * text for Telegram and WhatsApp. PURE.
 *
 * Plain on purpose: no Markdown or HTML parse mode, so nothing a model (or a
 * record's name) writes can break the message or smuggle in formatting.
 * Links become "label: https://…" on the app's public address, charts are
 * pointed to the app, and tables become one line per row.
 */

/** Both platforms cap a message at 4096 characters; leave room. */
export const MAX_CHAT_CHARS = 4000;

const CHART_NOTE = "(chart in the app)";

/** "/leads/1" → "https://app.example.com/leads/1"; absolute URLs pass through. */
export function absoluteUrl(href: string, origin: string): string {
  if (/^\/(?!\/)/.test(href)) return `${origin.replace(/\/+$/, "")}${href}`;
  return href;
}

function inlineText(parts: Inline[], origin: string): string {
  return parts
    .map((p) => {
      switch (p.kind) {
        case "text":
        case "code":
          return p.text;
        case "br":
          return "\n";
        case "link": {
          const label = inlineText(p.children, origin).trim();
          const target = absoluteUrl(p.href, origin).replace(/^(mailto|tel):/i, "");
          return !label || label === target || label === p.href ? target : `${label}: ${target}`;
        }
        default:
          return inlineText(p.children, origin);
      }
    })
    .join("");
}

function blockText(b: Block, origin: string, indent = ""): string {
  switch (b.kind) {
    case "heading":
    case "paragraph":
      return indent + inlineText(b.content, origin).replace(/\n/g, `\n${indent}`);
    case "code":
      return b.lang === "chart" ? `${indent}${CHART_NOTE}` : b.text.replace(/\n+$/, "");
    case "hr":
      return `${indent}———`;
    case "quote":
      return b.blocks
        .map((x) => blockText(x, origin))
        .join("\n")
        .split("\n")
        .map((l) => `${indent}> ${l}`)
        .join("\n");
    case "list":
      return b.items
        .map((item, i) => {
          const marker = b.ordered ? `${b.start + i}.` : "-";
          const head = `${indent}${marker} ${inlineText(item.content, origin).replace(/\n/g, `\n${indent}  `)}`;
          const kids = item.children.map((c) => blockText(c, origin, `${indent}   `));
          return [head, ...kids].join("\n");
        })
        .join("\n");
    case "table": {
      const header = b.header.map((h) => inlineText(h, origin).trim());
      return b.rows
        .map((row) => {
          const cells = row.map((c) => inlineText(c, origin).trim());
          const rest = cells
            .slice(1)
            .map((c, k) => (header[k + 1] ? `${header[k + 1]}: ${c}` : c))
            .filter((c) => c.trim());
          return `${indent}- ${cells[0] || "—"}${rest.length ? ` — ${rest.join(", ")}` : ""}`;
        })
        .join("\n");
    }
  }
}

/**
 * An answer (the Markdown the app renders) → plain chat text.
 * [x](/path) → "x: https://origin/path"; ```chart blocks → "(chart in the app)".
 */
export function answerToChat(markdown: string, origin: string): string {
  return parseMarkdown(markdown)
    .map((b) => blockText(b, origin))
    .filter((s) => s.trim())
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const MAX_ITEMS = 15;

/** How to answer a proposal from the phone. `n` is its number when the reply lists several. */
export function howToAnswer(card: Pick<ActionCard, "risk" | "confirmPhrase" | "approval">, n?: number | null): string {
  const num = n ? ` ${n}` : "";
  if (card.approval) return `Reply YES${num} to send it to an admin for approval, or NO${num} to cancel.`;
  if (card.risk === "critical") {
    return card.confirmPhrase ? `Type "${card.confirmPhrase}" to confirm, or NO${num} to cancel.` : `Confirm it in SED AI, or reply NO${num} to cancel.`;
  }
  return `Reply YES${num} to confirm or NO${num} to cancel.`;
}

/**
 * A proposed change as chat text: what it is, every value, before → after,
 * the records it touches, its warnings — and exactly what to reply.
 */
export function cardToText(card: ActionCard, opts: { origin: string; n?: number | null }): string {
  const lines: string[] = [];
  const step = card.plan && card.plan.total > 1 ? `Step ${card.plan.index} of ${card.plan.total}: ` : "";
  lines.push(`${opts.n ? `${opts.n}) ` : ""}${step}${card.title}`);
  if (card.risk !== "standard") lines.push(`(${RISK_LABEL[card.risk]})`);
  for (const f of card.fields ?? []) {
    if (f.value.trim()) lines.push(`${f.label}: ${clip(f.value.trim(), 500)}`);
  }
  for (const c of card.changes ?? []) lines.push(`${c.label}: ${c.from || "(empty)"} → ${c.to || "(empty)"}`);
  const items = card.items ?? [];
  if (items.length) {
    const chosen = items.filter((i) => i.selected);
    lines.push(`Records (${chosen.length}):`);
    for (const i of chosen.slice(0, MAX_ITEMS)) lines.push(`- ${i.label}${i.detail ? ` — ${i.detail}` : ""}`);
    if (chosen.length > MAX_ITEMS) lines.push(`…and ${chosen.length - MAX_ITEMS} more (all listed in the app)`);
  }
  for (const w of card.warnings ?? []) lines.push(`Warning: ${w}`);
  for (const note of card.notes ?? []) lines.push(`Note: ${note}`);
  if (card.link) lines.push(`${card.link.label}: ${absoluteUrl(card.link.href, opts.origin)}`);
  if (card.status === "proposed") {
    if (card.approval) lines.push(`You can't do this yourself: ${card.approval.reason}`);
    lines.push(howToAnswer(card, opts.n));
  } else {
    lines.push(`(${STATUS_LABEL[card.status]})`);
  }
  return lines.join("\n");
}

/** What happened when a proposal was confirmed from the phone. */
export function outcomeText(card: ActionCard, origin: string, now = Date.now()): string {
  switch (card.status) {
    case "done": {
      const lines = [`Done: ${card.result?.message || card.title}`];
      if (card.result?.link) lines.push(`${card.result.link.label}: ${absoluteUrl(card.result.link.href, origin)}`);
      const undoMs = card.undoUntil ? Date.parse(card.undoUntil) - now : 0;
      if (undoMs > 60_000) lines.push(`You can undo it in SED AI for the next ${Math.floor(undoMs / 60_000)} min.`);
      return lines.join("\n");
    }
    case "failed":
      return `That didn't work: ${card.error || "it could not be done."}`;
    case "awaiting_approval":
      return `Sent to an admin for approval: ${card.title}. You'll get a notification in SED AI when they decide.`;
    case "cancelled":
      return `Cancelled: ${card.title}. Nothing was changed.`;
    default:
      return `${card.title}: ${STATUS_LABEL[card.status]}.`;
  }
}

/**
 * Cut a reply into messages the platforms accept — between paragraphs where
 * possible, then lines, then words, and never inside a character.
 */
export function splitMessage(text: string, max = MAX_CHAT_CHARS): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf("\n\n");
    if (cut < max * 0.5) cut = window.lastIndexOf("\n");
    if (cut < max * 0.5) cut = window.lastIndexOf(" ");
    if (cut < max * 0.5) {
      cut = max;
      const code = rest.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    }
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}
