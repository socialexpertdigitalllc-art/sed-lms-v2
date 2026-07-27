"use client";

import { useState, type ReactNode } from "react";
import { PageHeader } from "@/components/common/Panel";
import { cn } from "@/lib/utils";

export interface SopDoc {
  slug: string;
  title: string;
  markdown: string;
}

/**
 * A minimal, safe Markdown -> React renderer for the operator SOPs
 * (`docs/sops/site-studio/*.md`). There is no Markdown-rendering dependency
 * anywhere else in this repo (checked before writing this — see Phase 4b's
 * report), so this exists rather than adding one for three short files.
 *
 * SAFETY: every block/inline handler below builds React ELEMENTS directly
 * (`<p>`, `<code>`, `<a>`, ...) with plain strings as children — never a raw
 * HTML string and never `dangerouslySetInnerHTML`. React escapes string
 * children automatically, so anything in the source markdown that ISN'T one
 * of the handful of constructs recognised below (heading/list/table/code
 * fence/bold/inline-code/link) renders as inert, escaped text — it can never
 * inject markup. A link's `href` is restricted to `http(s):`, `mailto:`, or a
 * root-relative path for the same reason `isSafeAssetPath`
 * (`lib/site-studio/preview/assetPath.ts`) restricts what it accepts: this is
 * content read from disk, not written by the person viewing it, but treating
 * it as untrusted costs nothing and a future SOP edit can never turn into an
 * XSS vector by accident.
 *
 * Supports: `#`..`######` headings, fenced code blocks, inline `code`,
 * **bold**, `[text](url)` links, `-`/`*`/`1.` lists (with a light touch for
 * `- [ ]` / `- [x]` checklist items, since every SOP in this repo is written
 * that way), simple GFM-style pipe tables (used by SOP 01's diagnostics
 * tables), and plain paragraphs. Nothing else — no images, no nested
 * emphasis, no blockquotes. That's a deliberate scope match to what the three
 * SOPs actually use, not an attempt at a general Markdown engine.
 */

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "code"; content: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "paragraph"; text: string };

const isUnorderedItem = (line: string) => /^\s*[-*]\s+(.*)$/.test(line);
const isOrderedItem = (line: string) => /^\s*\d+\.\s+(.*)$/.test(line);
const isTableRow = (line: string) => /^\|.*\|\s*$/.test(line.trim());
const isTableSeparator = (line: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line.trim());

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    if (/^```/.test(line.trim())) {
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== "```") {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip the closing fence (or run off the end if unterminated)
      blocks.push({ type: "code", content: codeLines.join("\n") });
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      blocks.push({ type: "heading", level: headingMatch[1].length, text: headingMatch[2].trim() });
      i++;
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    if (isUnorderedItem(line) || isOrderedItem(line)) {
      const ordered = isOrderedItem(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? isOrderedItem(lines[i]) : isUnorderedItem(lines[i]))) {
        const m = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        items.push(m ? m[1] : lines[i].trim());
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^```/.test(lines[i].trim()) &&
      !isUnorderedItem(lines[i]) &&
      !isOrderedItem(lines[i]) &&
      !isTableRow(lines[i])
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "paragraph", text: paraLines.join(" ") });
  }

  return blocks;
}

const SAFE_HREF_RE = /^(https?:\/\/|mailto:|\/)/i;

/** `code` | **bold** | [text](url) — plain text everywhere else, always as a
 *  React string child (never innerHTML), so it's always auto-escaped. */
function parseInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/;
  let rest = text;
  let key = 0;

  while (rest.length > 0) {
    const m = pattern.exec(rest);
    if (!m) {
      nodes.push(rest);
      break;
    }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));

    if (m[1] !== undefined) {
      nodes.push(
        <code key={`${keyPrefix}-${key++}`} className="rounded bg-surface-2 px-1 py-0.5 text-[0.9em] text-text">
          {m[1]}
        </code>,
      );
    } else if (m[2] !== undefined) {
      nodes.push(
        <strong key={`${keyPrefix}-${key++}`} className="font-semibold text-text">
          {m[2]}
        </strong>,
      );
    } else if (m[3] !== undefined && SAFE_HREF_RE.test(m[4])) {
      nodes.push(
        <a
          key={`${keyPrefix}-${key++}`}
          href={m[4]}
          target={m[4].startsWith("/") ? undefined : "_blank"}
          rel={m[4].startsWith("/") ? undefined : "noreferrer noopener"}
          className="text-accent-ink underline underline-offset-2 hover:opacity-80"
        >
          {m[3]}
        </a>,
      );
    } else {
      // A link-shaped match whose href isn't one of the safe schemes — render
      // the original bracket text back verbatim rather than a live link.
      nodes.push(m[0]);
    }

    rest = rest.slice(m.index + m[0].length);
  }

  return nodes;
}

const CHECK_ITEM_RE = /^\[([ xX])\]\s*(.*)$/;

function renderListItem(item: string, key: string): ReactNode {
  const checked = CHECK_ITEM_RE.exec(item);
  if (checked) {
    const done = checked[1].toLowerCase() === "x";
    return (
      <li key={key} className="flex gap-2">
        <span aria-hidden className="mt-0.5 shrink-0 text-text-faint">{done ? "☑" : "☐"}</span>
        <span>{parseInline(checked[2], key)}</span>
      </li>
    );
  }
  return <li key={key}>{parseInline(item, key)}</li>;
}

function renderBlocks(blocks: Block[]): ReactNode[] {
  return blocks.map((block, i) => {
    const key = `b${i}`;
    switch (block.type) {
      case "heading": {
        const level = Math.min(block.level, 6);
        const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
        const sizeCls =
          level <= 1
            ? "text-xl font-display font-semibold text-text"
            : level === 2
              ? "mt-6 text-lg font-display font-semibold text-text"
              : "mt-4 text-sm font-semibold uppercase tracking-wide text-text-faint";
        return (
          <Tag key={key} className={sizeCls}>
            {parseInline(block.text, key)}
          </Tag>
        );
      }
      case "code":
        return (
          <pre key={key} className="overflow-x-auto rounded-md border border-border bg-surface-2 p-3 text-xs text-text">
            <code>{block.content}</code>
          </pre>
        );
      case "list": {
        const ListTag = block.ordered ? "ol" : "ul";
        return (
          <ListTag key={key} className={cn("space-y-1.5 pl-5 text-sm text-text", block.ordered ? "list-decimal" : "list-disc")}>
            {block.items.map((item, j) => renderListItem(item, `${key}-${j}`))}
          </ListTag>
        );
      }
      case "table":
        return (
          <div key={key} className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-text-faint">
                  {block.header.map((cell, j) => (
                    <th key={j} className="px-2.5 py-1.5 font-medium">
                      {parseInline(cell, `${key}-h${j}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r} className="border-b border-border last:border-0">
                    {row.map((cell, j) => (
                      <td key={j} className="px-2.5 py-1.5 align-top text-text-muted">
                        {parseInline(cell, `${key}-${r}-${j}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "paragraph":
      default:
        return (
          <p key={key} className="text-sm leading-relaxed text-text-muted">
            {parseInline(block.text, key)}
          </p>
        );
    }
  });
}

/** Renders one SOP's markdown as sanitised React elements — no
 *  `dangerouslySetInnerHTML` anywhere in this file. Exported separately from
 *  `SopViewer` so a future contextual-link surface could render a single
 *  document without pulling in the tabbed shell. */
export function SopMarkdown({ markdown }: { markdown: string }) {
  return <div className="space-y-3">{renderBlocks(parseBlocks(markdown))}</div>;
}

/**
 * The SOPs page's body: a small tab rail (one per document) plus the
 * rendered markdown. All three documents are loaded server-side up front
 * (Task 3's `page.tsx`, via `loadSop`) and handed in as plain data — there is
 * no client-side fetch here, matching how few and how static these three
 * files are; the tab switch is pure client state.
 */
export function SopViewer({ docs, initialSlug }: { docs: SopDoc[]; initialSlug?: string }) {
  const fallback = docs[0]?.slug ?? "";
  const [active, setActive] = useState(docs.some((d) => d.slug === initialSlug) ? (initialSlug as string) : fallback);
  const doc = docs.find((d) => d.slug === active) ?? docs[0];

  return (
    <div className="space-y-4">
      <PageHeader title="SOPs" description="Operator procedures for Site Studio — versioned with the code." />
      <div className="flex flex-col gap-4 md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-56 md:flex-col md:overflow-visible" aria-label="SOP documents">
          {docs.map((d) => (
            <button
              key={d.slug}
              type="button"
              onClick={() => setActive(d.slug)}
              aria-current={d.slug === active ? "page" : undefined}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-2 text-left text-sm font-medium transition-colors",
                d.slug === active ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              {d.title}
            </button>
          ))}
        </nav>
        <article className="min-w-0 flex-1 rounded-lg border border-border bg-surface p-5">
          {doc ? <SopMarkdown markdown={doc.markdown} /> : <p className="text-sm text-text-muted">No SOPs found.</p>}
        </article>
      </div>
    </div>
  );
}
