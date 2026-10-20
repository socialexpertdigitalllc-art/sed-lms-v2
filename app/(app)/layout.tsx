import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getAppSettings, getBranding } from "@/lib/settings/appSettings";
import { PermissionProvider } from "@/providers/PermissionProvider";
import { UiPrefsProvider, type Density } from "@/providers/UiPrefsProvider";
import { ViewScopeProvider } from "@/providers/ViewScopeProvider";
import { CompanyTimezoneProvider } from "@/providers/CompanyTimezoneProvider";
import { companyTimezone } from "@/lib/analytics/dateScope";
import { AppShell } from "@/components/layout/AppShell";
import { ActivityTracker } from "@/providers/ActivityTracker";
import { ToastProvider } from "@/components/common/Toast";
import { NotificationToaster } from "@/components/layout/NotificationToaster";
import { PushPrompt } from "@/components/layout/PushPrompt";
import { TabBadge } from "@/components/layout/TabBadge";
import { VersionBadge } from "@/components/layout/VersionBadge";
import { AssistantProvider } from "@/providers/AssistantProvider";
import { AssistantWidget } from "@/components/assistant/AssistantWidget";
import { assistantNameFrom } from "@/lib/assistant/name";

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
  // Cached (60s TTL) — month filters and counts follow the company calendar.
  const companyTz = companyTimezone(await getAppSettings().then((s) => s.work_timezone).catch(() => null));

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, ui_preferences")
    .eq("id", user.id)
    .single();

  const uiPrefs = (profile?.ui_preferences as Record<string, unknown>) ?? {};
  const sidebarPinned = (uiPrefs.sidebarPinned as boolean | undefined) ?? false;
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : [];
  const rawOrder = uiPrefs.dashboardOrder as { hero?: unknown; tiles?: unknown } | undefined;
  const uiInitial = {
    density: (uiPrefs.density === "compact" ? "compact" : "comfortable") as Density,
    columns: (uiPrefs.columns as Record<string, Record<string, boolean>>) ?? {},
    dashboardOrder: { hero: strArr(rawOrder?.hero), tiles: strArr(rawOrder?.tiles) },
  };

  return (
    <PermissionProvider value={[...perms]}>
      <CompanyTimezoneProvider value={companyTz}>
      <ViewScopeProvider userId={user.id}>
        <ToastProvider>
          <ActivityTracker />
          <UiPrefsProvider initial={uiInitial}>
            <AssistantProvider
              enabled={perms.has("assistant.use")}
              userId={user.id}
              displayName={profile?.display_name ?? ""}
              initialName={assistantNameFrom(uiPrefs)}
            >
              <AppShell email={user.email ?? ""} displayName={profile?.display_name ?? ""} branding={branding} sidebarPinned={sidebarPinned}>
                {children}
              </AppShell>
              <AssistantWidget />
            </AssistantProvider>
          </UiPrefsProvider>
          <NotificationToaster />
          <PushPrompt />
          <TabBadge />
          <VersionBadge />
        </ToastProvider>
      </ViewScopeProvider>
      </CompanyTimezoneProvider>
    </PermissionProvider>
  );
}
