"use client";

import { useMemo, useState } from "react";
import { Check, MessageSquare, Pencil, Pin, PinOff, Search, SquarePen, Trash2, X } from "lucide-react";
import type { AssistantConversation } from "@/lib/assistant/types";
import { btnPrimary, iconBtn, iconBtnDanger } from "@/components/common/buttons";
import { cn } from "@/lib/utils";

/** The user's own chats, newest first, pinned on top, grouped by when they were last used. */

function bucketOf(iso: string, now: Date): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return "Previous 7 days";
  if (diff < 30) return "Previous 30 days";
  return "Older";
}

export function ConversationList({
  conversations,
  activeId,
  runningIds,
  onSelect,
  onNew,
  onRename,
  onTogglePin,
  onDelete,
}: {
  conversations: AssistantConversation[];
  activeId: string | null;
  runningIds: Set<string>;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (c: AssistantConversation) => void;
  onDelete: (c: AssistantConversation) => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = new Date();
    const list = q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
    const out: { label: string; items: AssistantConversation[] }[] = [];
    for (const c of list) {
      const label = c.pinned ? "Pinned" : bucketOf(c.last_message_at, now);
      const g = out.find((x) => x.label === label);
      if (g) g.items.push(c);
      else out.push({ label, items: [c] });
    }
    return out;
  }, [conversations, query]);

  function commit(id: string) {
    const t = draft.trim();
    if (t) onRename(id, t);
    setEditing(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 p-3">
        <button type="button" onClick={onNew} className={cn(btnPrimary, "w-full")}>
          <SquarePen className="h-4 w-4" aria-hidden /> New chat
        </button>
        <label className="relative block">
          <span className="sr-only">Search chats</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
          />
        </label>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Your chats">
        {groups.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-text-faint">{query ? "No chats match." : "No chats yet."}</p>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="mb-3">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-faint">{g.label}</p>
              <ul className="space-y-0.5">
                {g.items.map((c) => {
                  const active = c.id === activeId;
                  if (editing === c.id) {
                    return (
                      <li key={c.id} className="flex items-center gap-1 rounded-md bg-surface px-1 py-1">
                        <input
                          autoFocus
                          value={draft}
                          maxLength={120}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commit(c.id);
                            if (e.key === "Escape") setEditing(null);
                          }}
                          className="min-w-0 flex-1 rounded border border-accent bg-surface px-2 py-1 text-sm text-text focus:outline-none"
                          aria-label="Chat title"
                        />
                        <button type="button" className={iconBtn} onClick={() => commit(c.id)} aria-label="Save title" title="Save">
                          <Check className="h-4 w-4" />
                        </button>
                        <button type="button" className={iconBtn} onClick={() => setEditing(null)} aria-label="Cancel" title="Cancel">
                          <X className="h-4 w-4" />
                        </button>
                      </li>
                    );
                  }
                  return (
                    <li key={c.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => onSelect(c.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 pr-[5.5rem] text-left text-sm transition-colors",
                          active ? "bg-accent-soft font-medium text-accent-ink" : "text-text-muted hover:bg-surface hover:text-text",
                        )}
                        aria-current={active ? "page" : undefined}
                      >
                        {runningIds.has(c.id) ? (
                          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" aria-label="Answering" />
                        ) : (
                          <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
                        )}
                        <span className="truncate">{c.title}</span>
                      </button>
                      <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-focus-within:flex group-hover:flex">
                        <button
                          type="button"
                          className={cn(iconBtn, "h-7 w-7")}
                          onClick={() => onTogglePin(c)}
                          aria-label={c.pinned ? "Unpin chat" : "Pin chat"}
                          title={c.pinned ? "Unpin" : "Pin"}
                        >
                          {c.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          className={cn(iconBtn, "h-7 w-7")}
                          onClick={() => {
                            setDraft(c.title);
                            setEditing(c.id);
                          }}
                          aria-label="Rename chat"
                          title="Rename"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className={cn(iconBtnDanger, "h-7 w-7")}
                          onClick={() => onDelete(c)}
                          aria-label="Delete chat"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </nav>
    </div>
  );
}
