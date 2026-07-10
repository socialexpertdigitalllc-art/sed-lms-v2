"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { cn } from "@/lib/utils";
import type { Branding } from "@/lib/settings/appSettings";

export function AppShell({
  email,
  displayName,
  branding,
  sidebarPinned,
  children,
}: {
  email: string;
  displayName: string;
  branding: Branding;
  sidebarPinned: boolean;
  children: React.ReactNode;
}) {
  const [pinned, setPinned] = useState(sidebarPinned);
  const [mobileOpen, setMobileOpen] = useState(false);

  function togglePin() {
    setPinned((p) => {
      const next = !p;
      fetch("/api/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sidebarPinned: next }),
      }).catch(() => {});
      return next;
    });
  }

  return (
    <div className="min-h-screen flex">
      {/* spacer reserves the rail (or pinned) width on desktop so content never sits under the fixed rail */}
      <div className={cn("hidden md:block shrink-0 transition-[width] duration-200", pinned ? "w-60" : "w-16")} />
      <Sidebar
        branding={branding}
        pinned={pinned}
        onTogglePin={togglePin}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar email={email} displayName={displayName} onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 p-6 min-w-0">{children}</main>
      </div>
    </div>
  );
}
