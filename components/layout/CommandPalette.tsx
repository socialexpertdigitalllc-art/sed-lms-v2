"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/leads/StatusPill";

type LiteLead = {
  id: string;
  business_name: string;
  business_email: string | null;
  business_phone: string | null;
  status: string;
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [leads, setLeads] = useState<LiteLead[] | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // global ⌘K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // load leads on first open + focus
  useEffect(() => {
    if (!open) return;
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 10);
    if (leads === null) {
      fetch("/api/leads")
        .then((r) => (r.ok ? r.json() : { leads: [] }))
        .then((d) => setLeads(d.leads ?? []))
        .catch(() => setLeads([]));
    }
  }, [open, leads]);

  const q = query.trim().toLowerCase();
  const results = (leads ?? [])
    .filter((l) =>
      !q
        ? true
        : [l.business_name, l.business_email, l.business_phone]
            .some((v) => (v ?? "").toLowerCase().includes(q))
    )
    .slice(0, 8);

  function go(id: string) {
    setOpen(false);
    setQuery("");
    router.push(`/leads/${id}`);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      go(results[active].id);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-sm text-text-faint hover:text-text-muted border border-border rounded-md px-3 py-1.5 bg-surface-2 transition-colors"
      >
        Search leads…
        <kbd className="font-mono text-[11px] border border-border rounded px-1.5 py-0.5 bg-surface">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center pt-[12vh] px-4" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-surface border border-border rounded-xl shadow-2xl overflow-hidden">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onInputKey}
              placeholder="Search by business, email, or phone…"
              className="w-full px-4 py-3.5 text-sm bg-surface text-text outline-none border-b border-border"
            />
            <div className="max-h-80 overflow-y-auto py-1">
              {leads === null ? (
                <div className="px-4 py-6 text-sm text-text-faint text-center">Loading…</div>
              ) : results.length === 0 ? (
                <div className="px-4 py-6 text-sm text-text-faint text-center">No matching leads.</div>
              ) : (
                results.map((l, i) => (
                  <button
                    key={l.id}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(l.id)}
                    className={"w-full flex items-center gap-3 px-4 py-2.5 text-left " + (i === active ? "bg-accent-soft" : "hover:bg-surface-2")}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-text truncate">{l.business_name}</div>
                      <div className="text-xs text-text-faint truncate">{l.business_email || l.business_phone || "—"}</div>
                    </div>
                    <StatusPill status={l.status} />
                  </button>
                ))
              )}
            </div>
            <div className="px-4 py-2 border-t border-border text-[11px] text-text-faint flex items-center gap-3">
              <span><kbd className="font-mono">↑↓</kbd> navigate</span>
              <span><kbd className="font-mono">↵</kbd> open</span>
              <span><kbd className="font-mono">esc</kbd> close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
