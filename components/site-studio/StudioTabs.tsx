"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/ai-tools/site-studio", label: "Templates" },
  { href: "/ai-tools/site-studio/runs", label: "Runs" },
  { href: "/ai-tools/site-studio/library", label: "Library" },
  { href: "/ai-tools/site-studio/deployments", label: "Deployments" },
  { href: "/ai-tools/site-studio/sops", label: "SOPs" },
] as const;

/** Templates | Runs | Library | Deployments | SOPs — mounted at the top of
 *  all five Site Studio server pages. Active state is pathname-aware; the
 *  Templates tab only matches the exact root path (it would otherwise stay
 *  "active" while looking at any of the others too, since every studio path
 *  starts with it). */
export function StudioTabs() {
  const pathname = usePathname() ?? "";

  return (
    <nav className="flex items-center gap-1 border-b border-border" aria-label="Site Studio sections">
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
