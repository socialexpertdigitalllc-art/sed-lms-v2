import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getBranding } from "@/lib/settings/appSettings";
import { PermissionProvider } from "@/providers/PermissionProvider";
import { UiPrefsProvider, type Density } from "@/providers/UiPrefsProvider";
import { AppShell } from "@/components/layout/AppShell";
import { ActivityTracker } from "@/providers/ActivityTracker";
import { ToastProvider } from "@/components/common/Toast";
import { NotificationToaster } from "@/components/layout/NotificationToaster";
import { TabBadge } from "@/components/layout/TabBadge";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  const branding = await getBranding();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, ui_preferences")
    .eq("id", user.id)
    .single();

  const uiPrefs = (profile?.ui_preferences as Record<string, unknown>) ?? {};
  const sidebarPinned = (uiPrefs.sidebarPinned as boolean | undefined) ?? false;
  const uiInitial = {
    density: (uiPrefs.density === "compact" ? "compact" : "comfortable") as Density,
    columns: (uiPrefs.columns as Record<string, Record<string, boolean>>) ?? {},
  };

  return (
    <PermissionProvider value={[...perms]}>
      <ToastProvider>
        <ActivityTracker />
        <UiPrefsProvider initial={uiInitial}>
          <AppShell email={user.email ?? ""} displayName={profile?.display_name ?? ""} branding={branding} sidebarPinned={sidebarPinned}>
            {children}
          </AppShell>
        </UiPrefsProvider>
        <NotificationToaster />
        <TabBadge />
      </ToastProvider>
    </PermissionProvider>
  );
}
