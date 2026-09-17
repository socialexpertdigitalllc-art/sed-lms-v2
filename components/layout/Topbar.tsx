"use client";

import { Menu } from "lucide-react";
import { CommandPalette } from "./CommandPalette";
import { WebsiteBell } from "./WebsiteBell";
import { GeneralBell } from "./GeneralBell";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";

export function Topbar({
  email,
  displayName,
  onMenu,
}: {
  email: string;
  displayName: string;
  onMenu?: () => void;
}) {
  return (
    <header className="h-14 shrink-0 border-b border-border bg-surface flex items-center justify-between px-5">
      <div className="flex items-center gap-2">
        {onMenu && (
          <button
            type="button"
            onClick={onMenu}
            aria-label="Open menu"
            className="md:hidden p-1.5 rounded-md text-text-muted hover:text-text hover:bg-surface-2"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        <CommandPalette />
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <WebsiteBell />
        <GeneralBell />
        <div className="w-px h-6 bg-border mx-1" />
        <UserMenu email={email} displayName={displayName} />
      </div>
    </header>
  );
}
