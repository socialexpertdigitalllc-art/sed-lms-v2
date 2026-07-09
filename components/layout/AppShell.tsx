import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import type { Branding } from "@/lib/settings/appSettings";

export function AppShell({
  email,
  displayName,
  branding,
  children,
}: {
  email: string;
  displayName: string;
  branding: Branding;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex">
      <Sidebar branding={branding} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar email={email} displayName={displayName} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
