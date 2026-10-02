import { redirect } from "next/navigation";
import { requireWebsite } from "@/lib/website-cms/guard";
import { ServicesPanel } from "@/components/website-cms/ServicesPanel";
import type { WebsiteServiceRow } from "@/lib/website-cms/types";

export default async function WebsiteContentPage() {
  const auth = await requireWebsite("view");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/dashboard");

  const { data } = await auth.admin
    .from("website_services")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return <ServicesPanel rows={(data ?? []) as WebsiteServiceRow[]} canManage={auth.canManage} />;
}
