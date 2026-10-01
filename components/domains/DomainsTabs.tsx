"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

/** The Domains section's two views. A domain's own page belongs to "All domains". */
export function DomainsTabs() {
  const path = usePathname() ?? "/domains";
  const analytics = path.startsWith("/domains/analytics");
  const tabs = [
    { href: "/domains", label: "All domains", icon: Globe, active: !analytics },
    { href: "/domains/analytics", label: "Analytics", icon: BarChart3, active: analytics },
  ];
  return (
    <nav className="flex gap-1 border-b border-border" aria-label="Domains sections">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
            t.active ? "border-accent font-medium text-accent-ink" : "border-transparent text-text-muted hover:text-text",
          )}
        >
          <t.icon className="h-4 w-4" /> {t.label}
        </Link>
      ))}
    </nav>
  );
}
