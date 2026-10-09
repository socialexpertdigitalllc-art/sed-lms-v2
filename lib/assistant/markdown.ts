/**
 * A small Markdown parser for the assistant's replies — the subset models
 * actually write: headings, paragraphs, bullet and numbered lists (nested),
 * GitHub tables, fenced code, quotes, rules, and inline bold / italic / code /
 * strikethrough / links.
 *
 * Purpose-built rather than a library because it must (1) render a reply
 * that is STILL STREAMING — an unclosed fence or table mid-arrival is normal,
 * not an error — (2) hand ```chart fences to the chart renderer, and (3) never
 * produce HTML: the output is a tree the React renderer turns into elements,
 * so there is no injection surface at all. Links are filtered to safe schemes.
 *
 * PURE and framework-free, so it is unit-tested directly.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "del"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "br" };

export type Align = "left" | "center" | "right" | null;

export interface ListItem {
  content: Inline[];
  children: Block[];
}

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; content: Inline[] }
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "code"; lang: string; text: string; closed: boolean }
  | { kind: "table"; header: Inline[][]; align: Align[]; rows: Inline[][][] }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "hr" };

/* --------------------------------------------------------------- links */

/** Internal paths and http(s)/mailto/tel only. Anything else renders as text. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^\/(?!\/)/.test(href)) return href;
  if (/^https?:\/\/[^\s]+$/i.test(href)) return href;
  if (/^(mailto|tel):[^\s]+$/i.test(href)) return href;
  return null;
}

/* -------------------------------------------------------------- inline */

const DELIMS: { open: string; kind: "strong" | "em" | "del" }[] = [
  { open: "**", kind: "strong" },
  { open: "__", kind: "strong" },
  { open: "~~", kind: "del" },
  { open: "*", kind: "em" },
  { open: "_", kind: "em" },
];

const isWordChar = (ch: string | undefined) => !!ch && /[A-Za-z0-9]/.test(ch);

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ kind: "text", text: buf });
    buf = "";
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === "\\" && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!|~>]/.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") {
      flush();
      out.push({ kind: "br" });
      i++;
      continue;
    }
    if (ch === "`") {
      const close = src.indexOf("`", i + 1);
      if (close > i) {
        flush();
        out.push({ kind: "code", text: src.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    if (ch === "[") {
      const m = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(src.slice(i));
      if (m) {
        flush();
        const href = safeHref(m[2]);
        const children = parseInline(m[1]);
        if (href) out.push({ kind: "link", href, children });
        else out.push(...children);
        i += m[0].length;
        continue;
      }
    }
    const delim = DELIMS.find((d) => src.startsWith(d.open, i));
    if (delim) {
      // "_" inside a word (snake_case, file_name) is not emphasis.
      const intraword = delim.open[0] === "_" && isWordChar(src[i - 1]);
      const close = intraword ? -1 : findClose(src, i + delim.open.length, delim.open);
      if (close > i + delim.open.length) {
        flush();
        out.push({ kind: delim.kind, children: parseInline(src.slice(i + delim.open.length, close)) });
        i = close + delim.open.length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** The closing delimiter: not preceded by whitespace, and for a single-char
 *  delimiter not the start of a doubled one. */
function findClose(src: string, from: number, delim: string): number {
  if (/\s/.test(src[from] ?? " ")) return -1;
  let j = from;
  while (j < src.length) {
    const at = src.indexOf(delim, j);
    if (at === -1) return -1;
    const doubled = delim.length === 1 && (src[at + 1] === delim || src[at - 1] === delim);
    const afterWord = delim === "_" && isWordChar(src[at + 1]);
    if (at > from && !/\s/.test(src[at - 1]) && !doubled && !afterWord) return at;
    j = at + delim.length;
  }
  return -1;
}

/* --------------------------------------------------------------- blocks */

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

function alignOf(cell: string): Align {
  const c = cell.trim();
  const left = c.startsWith(":");
  const right = c.endsWith(":");
  return left && right ? "center" : right ? "right" : left ? "left" : null;
}

const isBlank = (l: string) => !l.trim();

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    LIST_ITEM.test(line) ||
    QUOTE.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_SEP.test(next) && next.includes("-"))
  );
}

interface RawItem {
  indent: number;
  ordered: boolean;
  num: number;
  lines: string[];
}

/** Turn a run of list lines into nested list blocks by indentation. */
function buildList(items: RawItem[]): Block {
  const top = items[0];
  const block: Block & { kind: "list" } = { kind: "list", ordered: top.ordered, start: top.num, items: [] };
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    const nested: RawItem[] = [];
    let j = i + 1;
    while (j < items.length && items[j].indent > top.indent) nested.push(items[j++]);
    block.items.push({
      content: parseInline(item.lines.join("\n").trim()),
      children: nested.length ? [buildList(nested)] : [],
    });
    i = j;
  }
  return block;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        if (lines[j].trim().startsWith(marker[0].repeat(marker.length)) && lines[j].trim().replace(/[`~]/g, "") === "") {
          closed = true;
          break;
        }
        body.push(lines[j]);
        j++;
      }
      blocks.push({ kind: "code", lang: fence[2].toLowerCase(), text: body.join("\n"), closed });
      i = closed ? j + 1 : j;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 4) as 1 | 2 | 3 | 4;
      blocks.push({ kind: "heading", level, content: parseInline(heading[2]) });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map(alignOf);
      const rows: Inline[][][] = [];
      let j = i + 2;
      while (j < lines.length && !isBlank(lines[j]) && lines[j].includes("|")) {
        const cells = splitRow(lines[j]);
        rows.push(header.map((_, k) => parseInline(cells[k] ?? "")));
        j++;
      }
      blocks.push({ kind: "table", header: header.map(parseInline), align: header.map((_, k) => align[k] ?? null), rows });
      i = j;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        inner.push(QUOTE.exec(lines[i])![1]);
        i++;
      }
      blocks.push({ kind: "quote", blocks: parseMarkdown(inner.join("\n")) });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const items: RawItem[] = [];
      while (i < lines.length) {
        const l = lines[i];
        const m = LIST_ITEM.exec(l);
        if (m) {
          const marker = m[2];
          const indent = m[1].replace(/\t/g, "    ").length;
          const ordered = /\d/.test(marker);
          // Bullets switching to numbers (or back) at the top level start a
          // new list.
          if (items.length && indent <= items[0].indent && ordered !== items[0].ordered) break;
          items.push({ indent, ordered, num: ordered ? parseInt(marker, 10) : 1, lines: [m[3]] });
          i++;
          continue;
        }
        if (isBlank(l)) {
          // A blank line continues the list only if more of it follows.
          const next = lines[i + 1];
          if (next !== undefined && (LIST_ITEM.test(next) || /^\s{2,}\S/.test(next))) {
            i++;
            continue;
          }
          break;
        }
        // An indented line continues the current item.
        if (/^\s{2,}\S/.test(l) && items.length) {
          items[items.length - 1].lines.push(l.trim());
          i++;
          continue;
        }
        break;
      }
      blocks.push(buildList(items));
      continue;
    }

    // Paragraph: until a blank line or the start of another block.
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ kind: "paragraph", content: parseInline(para.join("\n")) });
  }
  return blocks;
}

/** Plain text of a reply, for copying. Markdown punctuation stays as typed. */
export function plainText(src: string): string {
  return src.replace(/```chart[\s\S]*?(```|$)/g, "").trim();
}
