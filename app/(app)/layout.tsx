import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { PermissionProvider } from "@/providers/PermissionProvider";
import { AppShell } from "@/components/layout/AppShell";
import { ActivityTracker } from "@/providers/ActivityTracker";

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  return (
    <PermissionProvider value={[...perms]}>
      <ActivityTracker />
      <AppShell email={user.email ?? ""} displayName={profile?.display_name ?? ""}>
        {children}
      </AppShell>
    </PermissionProvider>
  );
}
