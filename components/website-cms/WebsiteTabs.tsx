"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/website", label: "Content" },
  { href: "/website/offers", label: "Offers" },
  { href: "/website/coupons", label: "Coupons" },
  { href: "/website/testimonials", label: "Testimonials" },
  { href: "/website/portfolio", label: "Portfolio" },
  { href: "/website/settings", label: "Settings" },
];

export function WebsiteTabs() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border">
      {TABS.map((t) => {
        const active = t.href === "/website" ? path === "/website" : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
              active ? "border-accent text-accent-ink" : "border-transparent text-text-muted hover:text-text"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
