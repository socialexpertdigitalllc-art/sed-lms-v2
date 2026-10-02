import { redirect } from "next/navigation";
import { requireWebsite } from "@/lib/website-cms/guard";
import { CouponsPanel } from "@/components/website-cms/CouponsPanel";
import type { WebsiteCouponRow } from "@/lib/website-cms/types";

export default async function WebsiteCouponsPage() {
  const auth = await requireWebsite("view");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/dashboard");

  const [{ data: coupons }, { data: services }] = await Promise.all([
    auth.admin.from("website_coupons").select("*").order("created_at", { ascending: false }),
    auth.admin.from("website_services").select("slug").order("sort_order", { ascending: true }),
  ]);

  return (
    <CouponsPanel
      rows={(coupons ?? []) as WebsiteCouponRow[]}
      serviceSlugs={((services ?? []) as { slug: string }[]).map((s) => s.slug)}
      canManage={auth.canManage}
    />
  );
}
