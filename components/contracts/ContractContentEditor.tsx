"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { Plus, Trash2, Undo2, Loader2, Lock, RefreshCw, Save, Banknote, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { btnPrimary, btnSecondary, btnSecondarySm, iconBtn, iconBtnDanger } from "@/components/common/buttons";
import { Skeleton } from "@/components/common/Skeleton";
import { formatUsd } from "@/lib/contracts/merge";
import { paymentTermsText } from "@/lib/contracts/payments";
import type { DocBlock, BlockEdit } from "@/lib/contracts/docEdit";
import type { ContractRow } from "@/lib/contracts/types";

/**
 * Edit a draft contract's wording paragraph by paragraph. The text comes
 * straight from the contract's Google Doc and edits are written back into it,
 * so the PDF keeps the template's fonts and layout. Only what changed is sent.
 */

type Local = { text: string; removed: boolean; added: string[] };

function AutoTextarea({
  value,
  onChange,
  className,
  onFocus,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  onFocus?: () => void;
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      className={cn(
        "block w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-text outline-none",
        "hover:border-border focus:border-border focus:bg-surface focus:ring-2 focus:ring-accent",
        className,
      )}
      {...rest}
    />
  );
}

const styleCls = (b: DocBlock) =>
  /^(TITLE|HEADING_1)/.test(b.style)
    ? "text-base font-semibold"
    : /^(SUBTITLE|HEADING_)/.test(b.style)
      ? "font-semibold"
      : "";

export function ContractContentEditor({
  contract,
  onSaved,
  onClose,
}: {
  contract: ContractRow;
  onSaved: (c: ContractRow) => void;
  onClose: () => void;
}) {
  const [blocks, setBlocks] = useState<DocBlock[] | null>(null);
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, Local>>({});
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  function fetchContent() {
    fetch(`/api/contracts/${contract.id}/content`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not load the contract");
        adopt(d.blocks, d.revisionId);
      })
      .catch((e: Error) => setError(e.message));
  }

  function load() {
    setBlocks(null);
    setError(null);
    setStale(false);
    fetchContent();
  }

  function adopt(next: DocBlock[], rev: string | null) {
    setBlocks(next);
    setRevisionId(rev);
    setLocal(Object.fromEntries(next.map((b) => [b.key, { text: b.text, removed: false, added: [] }])));
  }

  const loadOnOpen = useEffectEvent(fetchContent);
  useEffect(() => {
    loadOnOpen();
  }, [contract.id]);

  const patch = (key: string, p: Partial<Local>) => setLocal((prev) => ({ ...prev, [key]: { ...prev[key], ...p } }));

  const edits: BlockEdit[] = [];
  for (const b of blocks ?? []) {
    const l = local[b.key];
    if (!l) continue;
    const added = l.added.filter((t) => t.trim());
    if (l.removed) edits.push({ op: "remove", key: b.key, oldText: b.text });
    else if (l.text !== b.text) edits.push({ op: "replace", key: b.key, oldText: b.text, text: l.text });
    if (added.length) edits.push({ op: "insert_after", key: b.key, paragraphs: added });
  }

  async function save() {
    if (!revisionId || !edits.length) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisionId, edits }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not save the edits");
        if (d.code === "doc_changed") setStale(true);
        return;
      }
      onSaved(d.contract as ContractRow);
      if (d.blocks) adopt(d.blocks, d.revisionId);
      else load();
    } finally {
      setSaving(false);
    }
  }

  /** Payment terms from the contract's schedule, after the focused paragraph
   *  (or the one quoting the price, or the end). */
  function insertPaymentTerms() {
    if (!blocks?.length) return;
    const fee = formatUsd(contract.one_time_price);
    const editable = blocks.filter((b) => b.editable);
    const target =
      editable.find((b) => b.key === focusKey) ??
      editable.find((b) => b.text.includes(fee)) ??
      editable[editable.length - 1];
    if (!target) return;
    const lines = paymentTermsText(contract.payment_plan ?? null, contract.one_time_price).split("\n");
    // In a bulleted list, one bullet with line breaks (as when it's added at generation).
    const paras = target.bullet ? [lines.join("\n")] : lines;
    patch(target.key, { added: [...(local[target.key]?.added ?? []), ...paras] });
  }

  const count = edits.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-[11px] text-text-faint">
          Click any paragraph to change it. Enter adds a line break; <Plus className="inline h-3 w-3" /> adds a paragraph.
        </p>
        <div className="flex items-center gap-1.5">
          {contract.one_time_price !== null && (
            <button type="button" className={btnSecondarySm} onClick={insertPaymentTerms} disabled={!blocks} title="Add the payment terms after the selected paragraph">
              <Banknote className="h-3.5 w-3.5" /> Insert payment terms
            </button>
          )}
          <button type="button" className={iconBtn} onClick={onClose} title="Close the editor" aria-label="Close the editor">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {!blocks && !error && (
          <div className="space-y-2 p-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className={cn("h-5", i % 3 === 0 ? "w-1/3" : "w-full")} />
            ))}
          </div>
        )}
        {blocks && (
          <ol className="space-y-0.5">
            {blocks.map((b) => {
              const l = local[b.key] ?? { text: b.text, removed: false, added: [] };
              const changed = !l.removed && l.text !== b.text;
              return (
                <li key={b.key} className="group">
                  {!b.editable ? (
                    <div className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-text-faint">
                      <Lock className="h-3 w-3 shrink-0" />
                      <span className="truncate">{b.text.trim() ? b.text : "Image or signature"} — edit this part in Google Docs</span>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "flex items-start gap-1 rounded-md border-l-2 pl-1",
                        l.removed ? "border-dropped-fg bg-dropped-bg/40" : changed ? "border-accent" : "border-transparent",
                        b.inTable && "ml-3",
                      )}
                    >
                      {b.bullet && <span className="mt-1.5 select-none text-sm text-text-faint">•</span>}
                      {l.removed ? (
                        <p className="min-w-0 flex-1 px-2 py-1 text-sm text-text-faint line-through">{b.text || "(empty line)"}</p>
                      ) : (
                        <AutoTextarea
                          value={l.text}
                          onChange={(text) => patch(b.key, { text })}
                          onFocus={() => setFocusKey(b.key)}
                          placeholder="(empty line)"
                          className={cn(styleCls(b), !b.text && !l.text && "py-0 text-xs")}
                          aria-label="Paragraph"
                        />
                      )}
                      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
                        {l.removed || changed ? (
                          <button
                            type="button"
                            className={iconBtn}
                            title="Undo"
                            aria-label="Undo the change to this paragraph"
                            onClick={() => patch(b.key, { text: b.text, removed: false })}
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={iconBtnDanger}
                            title={b.removable ? "Remove this paragraph" : "Clear this paragraph (it can't be removed)"}
                            aria-label="Remove this paragraph"
                            onClick={() => patch(b.key, { removed: true })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          className={iconBtn}
                          title="Add a paragraph after this one"
                          aria-label="Add a paragraph after this one"
                          onClick={() => patch(b.key, { added: [...l.added, ""] })}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                  {l.added.map((t, i) => (
                    <div key={i} className={cn("flex items-start gap-1 rounded-md border-l-2 border-ready-fg bg-ready-bg/40 pl-1", b.inTable && "ml-3")}>
                      <AutoTextarea
                        value={t}
                        autoFocus={!t}
                        onChange={(text) => patch(b.key, { added: l.added.map((x, j) => (j === i ? text : x)) })}
                        placeholder="New paragraph"
                        aria-label="New paragraph"
                      />
                      <button
                        type="button"
                        className={iconBtnDanger}
                        title="Drop this new paragraph"
                        aria-label="Drop this new paragraph"
                        onClick={() => patch(b.key, { added: l.added.filter((_, j) => j !== i) })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 border-t border-border bg-dropped-bg px-3 py-2 text-xs text-dropped-fg">
          <span className="min-w-0 flex-1">{error}</span>
          {(stale || !blocks) && (
            <button type="button" className={btnSecondarySm} onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" /> Reload
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-2 px-3 py-2">
        <p className="text-[11px] text-text-faint">
          {count ? `${count} change${count === 1 ? "" : "s"} not saved` : contract.pdf_uploaded_name ? "Saving replaces your uploaded PDF with this edited contract." : "No changes yet."}
        </p>
        <div className="flex gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>
            {count ? "Discard" : "Done"}
          </button>
          <button type="button" className={btnPrimary} onClick={save} disabled={saving || !count || stale}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving…" : "Save & update PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
