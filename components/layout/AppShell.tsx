import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({
  email,
  displayName,
  children,
}: {
  email: string;
  displayName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar email={email} displayName={displayName} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
