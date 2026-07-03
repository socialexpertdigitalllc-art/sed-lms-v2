import { CommandPalette } from "./CommandPalette";
import { NotificationBell } from "./NotificationBell";
import { UserMenu } from "./UserMenu";

export function Topbar({ email, displayName }: { email: string; displayName: string }) {
  return (
    <header className="h-14 shrink-0 border-b border-border bg-surface flex items-center justify-between px-5">
      <CommandPalette />
      <div className="flex items-center gap-2">
        <NotificationBell />
        <div className="w-px h-6 bg-border mx-1" />
        <UserMenu email={email} displayName={displayName} />
      </div>
    </header>
  );
}
