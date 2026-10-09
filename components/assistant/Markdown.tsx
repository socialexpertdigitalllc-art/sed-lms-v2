"use client";

import { Fragment, useMemo } from "react";
import Link from "next/link";
import { parseMarkdown, type Align, type Block, type Inline } from "@/lib/assistant/markdown";
import { cn } from "@/lib/utils";
import { ChartBlock } from "./ChartBlock";

/**
 * Renders the assistant's Markdown as React elements — never as HTML, so a
 * reply (or a lead name echoed inside one) cannot inject markup. Internal
 * links (/leads/…) navigate in-app; external ones open in a new tab.
 */

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

function BlockView({ block, streaming }: { block: Block; streaming: boolean }) {
  switch (block.kind) {
    case "heading": {
      const cls = cn(
        "font-display font-semibold tracking-tight text-text",
        block.level === 1 ? "text-lg" : block.level === 2 ? "text-base" : "text-sm",
      );
      const Tag = (`h${Math.min(block.level + 1, 4)}` as "h2" | "h3" | "h4");
      return (
        <Tag className={cls}>
          <InlineView nodes={block.content} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="leading-relaxed">
          <InlineView nodes={block.content} />
        </p>
      );
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i} className="pl-1">
          <InlineView nodes={item.content} />
          {item.children.map((c, j) => (
            <div key={j} className="mt-1">
              <BlockView block={c} streaming={streaming} />
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
      return (
        <pre className="overflow-x-auto rounded-md border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed text-text">
          <code>{block.text}</code>
        </pre>
      );
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
            <BlockView key={i} block={b} streaming={streaming} />
          ))}
        </blockquote>
      );
    case "hr":
      return <hr className="border-border" />;
  }
}

export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="space-y-3 text-sm text-text">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} streaming={streaming} />
      ))}
    </div>
  );
}
