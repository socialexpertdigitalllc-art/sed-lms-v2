import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getAppSettings, logoPublicUrl } from "@/lib/settings/appSettings";
import { AppSettingsCard } from "@/components/admin/AppSettingsCard";

export default async function AdminSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.settings.manage")) redirect("/dashboard");

  const settings = await getAppSettings();

  const { data: mailboxes } = await createAdminClient()
    .from("company_mailboxes")
    .select("id, email_address, display_name")
    .eq("status", "verified")
    .order("email_address");

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text">Settings</h1>
        <p className="text-sm text-text-muted mt-0.5">Branding, work hours, ticket SLAs, retention and the Form Relay sender.</p>
      </div>
      <AppSettingsCard initial={settings} initialLogoUrl={logoPublicUrl(settings.logo_path)} mailboxes={mailboxes ?? []} />
    </div>
  );
}
