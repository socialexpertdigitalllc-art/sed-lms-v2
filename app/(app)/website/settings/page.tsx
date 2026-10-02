import { redirect } from "next/navigation";
import { requireWebsite } from "@/lib/website-cms/guard";
import { getWebsiteSettings } from "@/lib/website-cms/settings";
import { SettingsPanel } from "@/components/website-cms/SettingsPanel";

export default async function WebsiteSettingsPage() {
  const auth = await requireWebsite("view");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/dashboard");

  const s = await getWebsiteSettings();
  // Viewers get masked secrets; managers can see and copy them.
  const initial = auth.canManage
    ? { stats: s.stats, revalidate_url: s.revalidate_url, revalidate_secret: s.revalidate_secret, api_key: s.api_key }
    : {
        stats: s.stats,
        revalidate_url: s.revalidate_url,
        revalidate_secret: s.revalidate_secret ? "••••••••" : "",
        api_key: s.api_key ? "••••••••" : "",
      };

  return <SettingsPanel initial={initial} canManage={auth.canManage} />;
}
