import { redirect } from "next/navigation";
import { requireDomains } from "@/lib/domains/guard";
import { computeDomainAnalytics, type AnalyticsRow, type UptimeAgg, type UptimeDay } from "@/lib/domains/analytics";
import { DomainAnalyticsView } from "@/components/domains/DomainAnalytics";

export const dynamic = "force-dynamic";

export default async function DomainAnalyticsPage() {
  const auth = await requireDomains("view");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/dashboard");
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [{ data: rows }, { data: uptime }, { data: daily }] = await Promise.all([
    auth.admin.from("client_domains").select("*, leads(business_name)"),
    auth.admin.rpc("client_domain_uptime", { since }),
    auth.admin.rpc("client_domain_uptime_daily", { since }),
  ]);
  const data = computeDomainAnalytics(
    (rows ?? []) as AnalyticsRow[],
    (uptime ?? []) as UptimeAgg[],
    (daily ?? []) as UptimeDay[],
    now,
  );
  return <DomainAnalyticsView data={data} />;
}
