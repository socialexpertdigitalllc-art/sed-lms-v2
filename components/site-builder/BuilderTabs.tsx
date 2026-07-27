"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/ai-tools/site-builder", label: "Templates" },
  { href: "/ai-tools/site-builder/new", label: "New Site" },
  { href: "/ai-tools/site-builder/runs", label: "Runs" },
] as const;

/** Templates | New Site | Runs — mounted at the top of every Site Builder
 *  server page. Same idiom as `StudioTabs` (Site Studio's own tab bar): the
 *  Templates tab matches only the exact root path, since every Site Builder
 *  path starts with it. */
export function BuilderTabs() {
  const pathname = usePathname() ?? "";

  return (
    <nav className="flex items-center gap-1 border-b border-border" aria-label="Site Builder sections">
      {TABS.map((t) => {
        const active = t.label === "Templates" ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
