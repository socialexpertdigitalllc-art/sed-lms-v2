"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { parseMarkdown, type Align, type Block, type Inline } from "@/lib/assistant/markdown";
import { cn } from "@/lib/utils";
import { ChartBlock } from "./ChartBlock";

/**
 * Renders the assistant's Markdown as React elements — never as HTML, so a
 * reply (or a lead name echoed inside one) cannot inject markup. Internal
 * links (/leads/…) navigate in-app; external ones open in a new tab. While an
 * answer is being written, a pulsing dot follows its last word.
 */

function Caret() {
  return <span className="sed-ai-caret text-text" aria-hidden />;
}

function CodeBlock({ lang, text }: { lang: string | null; text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-2">
      <div className="flex items-center justify-between border-b border-border px-3 py-1 text-[11px] text-text-faint">
        <span className="font-mono">{lang || "text"}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 transition-colors hover:bg-surface hover:text-text"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-text">
        <code>{text}</code>
      </pre>
    </div>
  );
}

const linkCls = "font-medium text-accent-ink underline decoration-accent/40 underline-offset-2 hover:decoration-accent";

function InlineView({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.kind) {
          case "text":
            return <Fragment key={i}>{n.text}</Fragment>;
          case "br":
            return <br key={i} />;
          case "strong":
            return (
              <strong key={i} className="font-semibold text-text">
                <InlineView nodes={n.children} />
              </strong>
            );
          case "em":
            return (
              <em key={i}>
                <InlineView nodes={n.children} />
              </em>
            );
          case "del":
            return (
              <del key={i} className="text-text-faint">
                <InlineView nodes={n.children} />
              </del>
            );
          case "code":
            return (
              <code key={i} className="rounded border border-border-subtle bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">
                {n.text}
              </code>
            );
          case "link":
            return n.href.startsWith("/") ? (
              <Link key={i} href={n.href} className={linkCls}>
                <InlineView nodes={n.children} />
              </Link>
            ) : (
              <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className={linkCls}>
                <InlineView nodes={n.children} />
              </a>
            );
        }
      })}
    </>
  );
}

const alignCls = (a: Align) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");

function BlockView({ block, streaming, caret = false }: { block: Block; streaming: boolean; caret?: boolean }) {
  switch (block.kind) {
    case "heading": {
      const cls = cn(
        "font-display font-semibold tracking-tight text-text",
        block.level === 1 ? "text-[1.15em]" : block.level === 2 ? "text-[1.075em]" : "text-[1em]",
      );
      const Tag = (`h${Math.min(block.level + 1, 4)}` as "h2" | "h3" | "h4");
      return (
        <Tag className={cls}>
          <InlineView nodes={block.content} />
          {caret ? <Caret /> : null}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p>
          <InlineView nodes={block.content} />
          {caret ? <Caret /> : null}
        </p>
      );
    case "list": {
      const lastItem = block.items.length - 1;
      const items = block.items.map((item, i) => (
        <li key={i} className="pl-1">
          <InlineView nodes={item.content} />
          {caret && i === lastItem && item.children.length === 0 ? <Caret /> : null}
          {item.children.map((c, j) => (
            <div key={j} className="mt-1">
              <BlockView block={c} streaming={streaming} caret={caret && i === lastItem && j === item.children.length - 1} />
            </div>
          ))}
        </li>
      ));
      return block.ordered ? (
        <ol start={block.start} className="list-decimal space-y-1 pl-5 marker:text-text-faint">
          {items}
        </ol>
      ) : (
        <ul className="list-disc space-y-1 pl-5 marker:text-text-faint">{items}</ul>
      );
    }
    case "code":
      if (block.lang === "chart") return <ChartBlock source={block.text} complete={block.closed || !streaming} />;
      return <CodeBlock lang={block.lang} text={block.text} />;
    case "table":
      return (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full border-collapse text-[13px]">
            <thead className="bg-surface-2">
              <tr>
                {block.header.map((cell, i) => (
                  <th
                    key={i}
                    className={cn("whitespace-nowrap border-b border-border px-3 py-2 font-semibold text-text-muted", alignCls(block.align[i]))}
                  >
                    <InlineView nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b border-border-subtle last:border-0">
                  {row.map((cell, c) => (
                    <td key={c} className={cn("px-3 py-1.5 align-top tabular-nums", alignCls(block.align[c]))}>
                      <InlineView nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "quote":
      return (
        <blockquote className="space-y-2 border-l-2 border-accent/50 pl-3 text-text-muted">
          {block.blocks.map((b, i) => (
            <BlockView key={i} block={b} streaming={streaming} caret={caret && i === block.blocks.length - 1} />
          ))}
        </blockquote>
      );
    case "hr":
      return <hr className="border-border" />;
  }
}

export function Markdown({
  text,
  streaming = false,
  caret = false,
  className,
}: {
  text: string;
  streaming?: boolean;
  /** Show the "still writing" dot after the last word. */
  caret?: boolean;
  className?: string;
}) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={cn("space-y-3 text-sm leading-relaxed text-text", className)}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} streaming={streaming} caret={caret && i === blocks.length - 1} />
      ))}
    </div>
  );
}
