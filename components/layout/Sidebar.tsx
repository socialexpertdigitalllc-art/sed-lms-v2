"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Building2, PhoneCall, Ticket, BarChart3, MessageSquare,
  CreditCard, Bell, LayoutList, ListChecks, Sparkles, Globe, Bot, LineChart, Cog,
  Users, Building, ShieldCheck, ScrollText, Upload, Puzzle, BellRing, Pin, PinOff,
  Settings, LayoutTemplate, Library, Mail, FileText, Inbox, MailCheck, Cpu, Wand2, Hammer, Images,
  ClipboardList, ChevronDown, Plus, Earth, BrainCircuit,
  type LucideIcon,
} from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { useNavCounts } from "@/hooks/useNavCounts";
import { useHasMailbox } from "@/hooks/useHasMailbox";
import { useUnreadMail } from "@/hooks/useUnreadMail";
import { navCountKey, navCountTone } from "@/lib/nav/counts";
import { cn } from "@/lib/utils";
import { NavItemContent } from "@/components/layout/NavItemContent";
import { BrandMark } from "@/components/branding/BrandMark";
import type { Branding } from "@/lib/settings/appSettings";

type NavChild = { href: string; label: string };
/** A small always-visible shortcut on the row itself (e.g. Leads' "+" that
 *  jumps straight to the new-lead form), gated by its own permission. */
type NavQuickAction = { href: string; label: string; perm: string };
type NavItem = { href: string; label: string; icon: LucideIcon; perm?: string; children?: NavChild[]; quickAction?: NavQuickAction };

/** Appended to MAIN only for users with a linked mailbox; badged with unread IMAP mail. */
const MAILBOX_HREF = "/mailbox";

const MAIN: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, perm: "analytics.view" },
  { href: "/assistant", label: "AI Assistant", icon: BrainCircuit, perm: "assistant.use" },
  { href: "/leads", label: "Leads", icon: Building2, perm: "leads.view", quickAction: { href: "/leads/new", label: "New lead", perm: "leads.create" } },
  { href: "/leads/follow-ups", label: "Follow-ups", icon: PhoneCall, perm: "leads.view" },
  { href: "/tickets", label: "Tickets", icon: Ticket, perm: "tickets.view" },
  { href: "/by-agent", label: "By Agent", icon: BarChart3, perm: "analytics.by_agent" },
  { href: "/reports/agent", label: "Agent Report", icon: ClipboardList, perm: "reports.agent_periodic" },
  { href: "/feedback", label: "Feedback", icon: MessageSquare, perm: "feedback.submit" },
  { href: "/payments", label: "Payments", icon: CreditCard, perm: "payments.view" },
  { href: "/contracts", label: "Contracts", icon: FileText, perm: "contracts.view" },
  { href: "/forms", label: "Forms", icon: Inbox, perm: "forms.view" },
  { href: "/domains", label: "Domains", icon: Earth, perm: "domains.view" },
  { href: "/website", label: "Website", icon: Globe, perm: "website.view" },
  { href: "/notifications", label: "Notifications", icon: Bell },
  // No `perm`: the verifier is auth-gated only, like Notifications.
  { href: "/verify", label: "Verify", icon: MailCheck },
];

const PRELEADS: NavItem[] = [
  { href: "/pre-leads", label: "Overview", icon: LayoutList, perm: "pre_leads.view" },
  { href: "/pre-leads/all", label: "All Pre-Leads", icon: ListChecks, perm: "pre_leads.view" },
];

type NavItemAny = { href: string; label: string; icon: LucideIcon; perms: string[]; children?: NavChild[] };

const AI_TOOLS: NavItemAny[] = [
  { href: "/ai-tools", label: "Overview", icon: Sparkles, perms: ["ai_tools.webcraft", "ai_tools.deepseek", "analytics.view_webcraft", "analytics.view_deepseek", "analytics.view_all_agents"] },
  { href: "/ai-tools/webcraft", label: "WebCraft", icon: Globe, perms: ["ai_tools.webcraft"] },
  { href: "/ai-tools/deepseek", label: "DeepSeek", icon: Bot, perms: ["ai_tools.deepseek"] },
  { href: "/ai-tools/analytics", label: "Analytics", icon: LineChart, perms: ["analytics.view_webcraft", "analytics.view_deepseek", "analytics.view_all_agents"] },
  { href: "/ai-tools/wge", label: "Engine (WGE)", icon: Cog, perms: ["wge.manage"] },
  { href: "/ai-tools/template-engine", label: "Template Engine", icon: LayoutTemplate, perms: ["templates.generate"] },
  { href: "/ai-tools/templates", label: "Templates", icon: Library, perms: ["templates.manage"] },
  {
    href: "/ai-tools/site-studio", label: "Site Studio", icon: Wand2, perms: ["studio.manage"],
    children: [
      { href: "/ai-tools/site-studio", label: "Templates" },
      { href: "/ai-tools/site-studio/runs", label: "Runs" },
      { href: "/ai-tools/site-studio/library", label: "Library" },
      { href: "/ai-tools/site-studio/deployments", label: "Deployments" },
      { href: "/ai-tools/site-studio/sops", label: "SOPs" },
    ],
  },
  {
    href: "/ai-tools/site-builder", label: "Site Builder", icon: Hammer, perms: ["studio.manage"],
    children: [
      { href: "/ai-tools/site-builder", label: "Templates" },
      { href: "/ai-tools/site-builder/new", label: "New Site" },
      { href: "/ai-tools/site-builder/runs", label: "Runs" },
      { href: "/ai-tools/site-builder/deployments", label: "Deployments" },
    ],
  },
];

const ADMIN: NavItem[] = [
  { href: "/admin/settings", label: "Settings", icon: Settings, perm: "admin.settings.manage" },
  { href: "/admin/users", label: "Users", icon: Users, perm: "admin.users.view" },
  { href: "/admin/departments", label: "Departments", icon: Building, perm: "admin.departments.manage" },
  { href: "/admin/permissions", label: "Permissions", icon: ShieldCheck, perm: "admin.permissions.manage" },
  { href: "/admin/logs", label: "Activity Log", icon: ScrollText, perm: "admin.logs.view" },
  { href: "/admin/import", label: "Import", icon: Upload, perm: "admin.import" },
  { href: "/admin/add-ons", label: "Add-ons", icon: Puzzle, perm: "admin.settings.manage" },
  { href: "/admin/mail", label: "Company Mail", icon: Mail, perm: "mail.manage" },
  { href: "/admin/contract-templates", label: "Contract Templates", icon: LayoutTemplate, perm: "integrations.manage" },
  { href: "/admin/email-providers", label: "Email Verification", icon: ShieldCheck, perm: "integrations.manage" },
  { href: "/admin/ai-models", label: "AI Models", icon: Cpu, perm: "integrations.manage" },
  { href: "/admin/image-hosts", label: "Image Hosts", icon: Images, perm: "integrations.manage" },
  { href: "/admin/notifications", label: "Notifications", icon: BellRing, perm: "admin.notifications.manage" },
];

export function Sidebar({
  branding,
  pinned,
  onTogglePin,
  mobileOpen,
  onMobileClose,
}: {
  branding: Branding;
  pinned: boolean;
  onTogglePin: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const { has, hasAny } = usePermissions();
  const path = usePathname();
  const counts = useNavCounts();
  const hasMailbox = useHasMailbox();
  // Only polls once the user is known to have a mailbox — no mailbox, no badge.
  const unreadMail = useUnreadMail(hasMailbox);

  const [hovering, setHovering] = useState(false);
  // Manual submenu toggles; when unset, a submenu opens iff its branch is active.
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expanded = pinned || hovering;

  function onEnter() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setHovering(true);
  }
  function onLeave() {
    if (pinned) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHovering(false), 1000);
  }

  const mainVisible = MAIN.filter((n) => (n.perm ? has(n.perm) : true));
  if (hasMailbox) mainVisible.push({ href: MAILBOX_HREF, label: "Mailbox", icon: Inbox });
  const preVisible = PRELEADS.filter((n) => (n.perm ? has(n.perm) : true));
  const hasAiTools = hasAny(["ai_tools.webcraft", "ai_tools.deepseek"]);
  const aiVisible: NavItem[] = AI_TOOLS
    .filter((n) => hasAny(n.perms) && (n.href !== "/ai-tools/wge" || hasAiTools))
    .map((n) => ({ href: n.href, label: n.label, icon: n.icon, perm: n.perms[0], children: n.children }));
  const adminVisible = ADMIN.filter((n) => (n.perm ? has(n.perm) : true));

  const all = [...mainVisible, ...preVisible, ...aiVisible, ...adminVisible];
  let bestHref = "";
  for (const n of all) {
    if ((path === n.href || path.startsWith(n.href + "/")) && n.href.length > bestHref.length) bestHref = n.href;
  }

  function branchActive(n: NavItem) {
    return path === n.href || path.startsWith(n.href + "/");
  }

  function childActive(n: NavItem, c: NavChild) {
    // The root child ("Templates") shares the parent href — exact match only,
    // since every sibling path is prefixed by it (BuilderTabs' own rule).
    return c.href === n.href ? path === c.href : path === c.href || path.startsWith(c.href + "/");
  }

  function renderItem(n: NavItem, showLabels: boolean) {
    const active = n.href === bestHref;
    const key = navCountKey(n.href);
    const count = n.href === MAILBOX_HREF ? unreadMail : key ? counts[key] : undefined;
    const hasChildren = Boolean(n.children?.length) && showLabels;
    const open = hasChildren && (openMenus[n.href] ?? branchActive(n));
    const showQuickAction = Boolean(n.quickAction) && showLabels && has(n.quickAction!.perm) && !hasChildren;
    return (
      <div key={n.href}>
        <div className="relative">
          <Link
            href={n.href}
            onClick={onMobileClose}
            title={showLabels ? undefined : n.label}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
              showLabels ? "" : "justify-center",
              // The + overlay occupies the right edge — reserve its width so
              // the count badge (ml-auto) lands to its LEFT, never under it.
              showQuickAction && "pr-8",
              active || (hasChildren && branchActive(n))
                ? "bg-accent-soft text-accent-ink"
                : "text-text-muted hover:bg-surface hover:text-text"
            )}
          >
            <NavItemContent
              icon={n.icon}
              label={n.label}
              count={count}
              showLabels={showLabels}
              tone={navCountTone(key)}
            />
          </Link>
          {showQuickAction && (
            <Link
              href={n.quickAction!.href}
              onClick={onMobileClose}
              title={n.quickAction!.label}
              aria-label={n.quickAction!.label}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-text-faint transition-colors hover:bg-surface hover:text-accent-ink"
            >
              <Plus className="h-3.5 w-3.5" />
            </Link>
          )}
          {hasChildren && (
            <button
              type="button"
              aria-label={`${open ? "Collapse" : "Expand"} ${n.label} submenu`}
              aria-expanded={open}
              onClick={() => setOpenMenus((m) => ({ ...m, [n.href]: !open }))}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-text-faint hover:bg-surface hover:text-text"
            >
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open ? "" : "-rotate-90")} />
            </button>
          )}
        </div>
        {open && (
          <div className="ml-5 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2">
            {(n.children ?? []).map((c) => (
              <Link
                key={`${n.href}:${c.href}`}
                href={c.href}
                onClick={onMobileClose}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                  childActive(n, c)
                    ? "bg-accent-soft font-medium text-accent-ink"
                    : "text-text-muted hover:bg-surface hover:text-text"
                )}
              >
                {c.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  function sectionLabel(label: string, showLabels: boolean) {
    if (!showLabels) return <div key={label} className="border-t border-border my-1.5 mx-2" />;
    return (
      <div key={label} className="px-3 pt-5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-faint">
        {label}
      </div>
    );
  }

  function nav(showLabels: boolean) {
    return (
      <>
        {mainVisible.map((n) => renderItem(n, showLabels))}
        {preVisible.length > 0 && (<>{sectionLabel("Pre-Leads", showLabels)}{preVisible.map((n) => renderItem(n, showLabels))}</>)}
        {aiVisible.length > 0 && (<>{sectionLabel("AI Tools", showLabels)}{aiVisible.map((n) => renderItem(n, showLabels))}</>)}
        {adminVisible.length > 0 && (<>{sectionLabel("Admin", showLabels)}{adminVisible.map((n) => renderItem(n, showLabels))}</>)}
      </>
    );
  }

  return (
    <>
      {/* Desktop rail — fixed so it stays put while content scrolls; spacer in AppShell reserves layout width */}
      <aside
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        className={cn(
          "hidden md:flex fixed top-0 left-0 z-30 h-screen bg-surface-2 border-r border-border p-3 flex-col gap-0.5",
          "overflow-y-auto overflow-x-hidden transition-[width] duration-200",
          expanded ? "w-60" : "w-16",
          expanded && !pinned ? "shadow-xl" : ""
        )}
      >
        <div className={cn("flex items-center px-2 py-3 mb-2", expanded ? "justify-between" : "justify-center")}>
          <BrandMark companyName={branding.companyName} logoUrl={branding.logoUrl} size={32} />
          {expanded && (
            <button
              type="button"
              onClick={onTogglePin}
              title={pinned ? "Unpin sidebar" : "Pin sidebar open"}
              aria-label={pinned ? "Unpin sidebar" : "Pin sidebar open"}
              className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-surface transition-colors"
            >
              {pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
            </button>
          )}
        </div>
        {nav(expanded)}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={onMobileClose} />
          <aside className="fixed inset-y-0 left-0 w-60 z-50 md:hidden bg-surface-2 border-r border-border p-3 flex flex-col gap-0.5 overflow-y-auto">
            <div className="flex items-center px-2 py-3 mb-2">
              <BrandMark companyName={branding.companyName} logoUrl={branding.logoUrl} size={32} />
            </div>
            {nav(true)}
          </aside>
        </>
      )}
    </>
  );
}
