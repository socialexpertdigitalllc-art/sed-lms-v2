"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; perm: string };

const MAIN: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", perm: "analytics.view" },
  { href: "/leads", label: "Leads", perm: "leads.view" },
  { href: "/leads/follow-ups", label: "Follow-ups", perm: "leads.view" },
  { href: "/tickets", label: "Tickets", perm: "tickets.view" },
  { href: "/by-agent", label: "By Agent", perm: "analytics.view" },
];

const PRELEADS: NavItem[] = [
  { href: "/pre-leads", label: "Overview", perm: "pre_leads.view" },
  { href: "/pre-leads/all", label: "All Pre-Leads", perm: "pre_leads.view" },
];

type NavItemAny = { href: string; label: string; perms: string[] };

const AI_TOOLS: NavItemAny[] = [
  { href: "/ai-tools", label: "Overview", perms: ["ai_tools.webcraft", "ai_tools.deepseek", "analytics.view_webcraft", "analytics.view_deepseek", "analytics.view_all_agents"] },
  { href: "/ai-tools/webcraft", label: "WebCraft", perms: ["ai_tools.webcraft"] },
  { href: "/ai-tools/deepseek", label: "DeepSeek", perms: ["ai_tools.deepseek"] },
  { href: "/ai-tools/analytics", label: "Analytics", perms: ["analytics.view_webcraft", "analytics.view_deepseek", "analytics.view_all_agents"] },
  { href: "/ai-tools/wge", label: "Engine (WGE)", perms: ["wge.manage"] },
];

const ADMIN: NavItem[] = [
  { href: "/admin/users", label: "Users", perm: "admin.users.view" },
  { href: "/admin/departments", label: "Departments", perm: "admin.departments.manage" },
  { href: "/admin/permissions", label: "Permissions", perm: "admin.permissions.manage" },
  { href: "/admin/logs", label: "Activity Log", perm: "admin.logs.view" },
  { href: "/admin/import", label: "Import", perm: "admin.import" },
  { href: "/admin/add-ons", label: "Add-ons", perm: "admin.settings.manage" },
];

export function Sidebar() {
  const { has, hasAny } = usePermissions();
  const path = usePathname();

  const mainVisible = MAIN.filter((n) => has(n.perm));
  const preVisible = PRELEADS.filter((n) => has(n.perm));
  const hasAiTools = hasAny(["ai_tools.webcraft", "ai_tools.deepseek"]);
  const aiVisible = AI_TOOLS
    .filter((n) => hasAny(n.perms) && (n.href !== "/ai-tools/wge" || hasAiTools))
    .map((n) => ({ href: n.href, label: n.label, perm: n.perms[0] }));
  const adminVisible = ADMIN.filter((n) => has(n.perm));

  // longest-prefix match so only the most specific nav item is active
  const all = [...mainVisible, ...preVisible, ...aiVisible, ...adminVisible];
  let bestHref = "";
  for (const n of all) {
    if ((path === n.href || path.startsWith(n.href + "/")) && n.href.length > bestHref.length) {
      bestHref = n.href;
    }
  }

  const renderItem = (n: NavItem) => {
    const active = n.href === bestHref;
    return (
      <Link
        key={n.href}
        href={n.href}
        className={cn(
          "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
          active ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2 hover:text-text"
        )}
      >
        <span className={cn("w-1.5 h-1.5 rounded-full", active ? "bg-accent" : "bg-border")} />
        {n.label}
      </Link>
    );
  };

  const sectionLabel = (label: string) => (
    <div className="px-3 pt-5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-faint">
      {label}
    </div>
  );

  return (
    <aside className="w-56 shrink-0 bg-surface-2 border-r border-border p-3 flex flex-col gap-0.5">
      <div className="flex items-center gap-2.5 px-2 py-3 mb-2">
        <div className="w-8 h-8 rounded-lg bg-accent grid place-items-center text-white font-bold text-sm">S</div>
        <div className="font-semibold text-text">SED LMS</div>
      </div>

      {mainVisible.map(renderItem)}

      {preVisible.length > 0 && (
        <>
          {sectionLabel("Pre-Leads")}
          {preVisible.map(renderItem)}
        </>
      )}

      {aiVisible.length > 0 && (
        <>
          {sectionLabel("AI Tools")}
          {aiVisible.map(renderItem)}
        </>
      )}

      {adminVisible.length > 0 && (
        <>
          {sectionLabel("Admin")}
          {adminVisible.map(renderItem)}
        </>
      )}
    </aside>
  );
}
