import { redirect } from "next/navigation";
import { requireWebsite } from "@/lib/website-cms/guard";
import { OffersPanel } from "@/components/website-cms/OffersPanel";
import type { WebsiteOfferRow } from "@/lib/website-cms/types";

export default async function WebsiteOffersPage() {
  const auth = await requireWebsite("view");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/dashboard");

  const [{ data: offers }, { data: services }] = await Promise.all([
    auth.admin.from("website_offers").select("*").order("sort_order", { ascending: true }),
    auth.admin.from("website_services").select("slug").order("sort_order", { ascending: true }),
  ]);

  return (
    <OffersPanel
      rows={(offers ?? []) as WebsiteOfferRow[]}
      serviceSlugs={((services ?? []) as { slug: string }[]).map((s) => s.slug)}
      canManage={auth.canManage}
    />
  );
}
