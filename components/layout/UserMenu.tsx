"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { initials } from "@/lib/leads/format";
import { logout } from "@/app/login/actions";

export function UserMenu({ email, displayName }: { email: string; displayName: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = displayName || email;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md pl-1.5 pr-2 py-1 hover:bg-surface-2 transition-colors"
      >
        <span className="w-7 h-7 rounded-full bg-accent-soft text-accent-ink grid place-items-center text-xs font-semibold">
          {initials(name)}
        </span>
        <span className="text-sm text-text-muted max-w-[160px] truncate hidden sm:block">{name}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-faint">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-60 bg-surface border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle">
            <div className="text-sm font-medium text-text truncate">{displayName || "—"}</div>
            <div className="text-xs text-text-faint truncate">{email}</div>
          </div>
          <Link
            href="/account"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-text-muted hover:bg-surface-2 hover:text-text transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
            </svg>
            My account
          </Link>
          <div className="border-t border-border-subtle">
            <form action={logout}>
              <button className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-dropped-fg hover:bg-dropped-bg transition-colors text-left">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="M16 17l5-5-5-5" />
                  <path d="M21 12H9" />
                </svg>
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
