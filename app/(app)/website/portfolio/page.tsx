import { redirect } from "next/navigation";
import { requireWebsite } from "@/lib/website-cms/guard";
import { PortfolioPanel } from "@/components/website-cms/PortfolioPanel";
import type { WebsitePortfolioRow } from "@/lib/website-cms/types";

export default async function WebsitePortfolioPage() {
  const auth = await requireWebsite("view");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/dashboard");

  const { data } = await auth.admin
    .from("website_portfolio")
    .select("*")
    .order("featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return <PortfolioPanel rows={(data ?? []) as WebsitePortfolioRow[]} canManage={auth.canManage} />;
}
