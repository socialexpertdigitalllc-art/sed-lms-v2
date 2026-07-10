"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

/**
 * Small inline "copy to clipboard" icon button. Shows a check for ~1.4s after a
 * successful copy. Stops click propagation so it works inside clickable rows.
 */
export function CopyButton({
  value,
  title = "Copy",
  className = "",
}: {
  value: string;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      title={copied ? "Copied" : title}
      aria-label={copied ? "Copied" : title}
      className={
        "inline-flex items-center justify-center p-1 rounded text-text-faint hover:text-text hover:bg-surface-2 transition-colors " +
        className
      }
    >
      {copied ? <Check className="w-3.5 h-3.5 text-ready-fg" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}
