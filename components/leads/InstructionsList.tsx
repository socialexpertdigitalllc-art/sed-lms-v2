"use client";

import { Plus, X } from "lucide-react";
import { inputCls } from "@/components/forms/Field";
import { MAX_INSTRUCTION_ITEMS, MAX_INSTRUCTION_WORDS, wordCount } from "@/lib/leads/devInstructions";

/**
 * Instructions for the developer, one item at a time: each item is a line of
 * at most 50 words, numbered as the developer will read it. "Add instruction"
 * adds the next item; the × removes one. Enter in an item jumps to a new one.
 */
export function InstructionsList({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  const list = items.length ? items : [""];
  const canAdd = list.length < MAX_INSTRUCTION_ITEMS && list[list.length - 1].trim() !== "";

  const setAt = (i: number, v: string) => onChange(list.map((x, j) => (j === i ? v.replace(/\r?\n/g, " ") : x)));
  const removeAt = (i: number) => {
    const next = list.filter((_, j) => j !== i);
    onChange(next.length ? next : [""]);
  };
  const add = () => {
    if (canAdd) onChange([...list, ""]);
  };

  return (
    <div className="space-y-2" data-testid="instructions-list">
      {list.map((item, i) => {
        const words = wordCount(item);
        const over = words > MAX_INSTRUCTION_WORDS;
        return (
          <div key={i} className="flex items-start gap-2">
            <span className="mt-2 w-6 shrink-0 text-right font-mono text-xs text-text-faint">{i + 1}.</span>
            <div className="min-w-0 flex-1">
              <textarea
                value={item}
                rows={1}
                aria-label={`Instruction ${i + 1}`}
                placeholder={i === 0 ? "e.g., Keep the booking button in the header on mobile" : "Next instruction"}
                onChange={(e) => setAt(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (i === list.length - 1) add();
                  }
                }}
                className={inputCls + " min-h-[38px] resize-y" + (over ? " border-dropped-fg focus:ring-dropped-fg" : "")}
              />
              <div className={"mt-0.5 text-right text-[11px] " + (over ? "font-medium text-dropped-fg" : "text-text-faint")}>
                {words}/{MAX_INSTRUCTION_WORDS} words{over ? " — shorten this one or split it in two" : ""}
              </div>
            </div>
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label={`Remove instruction ${i + 1}`}
              className="mt-1.5 rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        disabled={!canAdd}
        className="ml-8 inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2.5 py-1 text-xs font-medium text-text-muted hover:bg-surface-2 disabled:opacity-50"
      >
        <Plus size={13} /> Add instruction
      </button>
      {list.length >= MAX_INSTRUCTION_ITEMS && (
        <p className="ml-8 text-[11px] text-text-faint">That&apos;s the most: {MAX_INSTRUCTION_ITEMS} instructions.</p>
      )}
    </div>
  );
}
