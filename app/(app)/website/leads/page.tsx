import { redirect } from "next/navigation";
import { requireWebsite } from "@/lib/website-cms/guard";
import { LeadsPanel } from "@/components/website-cms/LeadsPanel";
import { WEBSITE_LEAD_STATUSES, type WebsiteLeadRow } from "@/lib/website-cms/types";

export default async function WebsiteLeadsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const auth = await requireWebsite("view");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/dashboard");

  const { status } = await searchParams;
  const filter = status === "spam" || (WEBSITE_LEAD_STATUSES as readonly string[]).includes(status ?? "") ? status! : "all";

  let query = auth.admin.from("website_leads").select("*").order("created_at", { ascending: false }).limit(500);
  if (filter === "spam") query = query.eq("is_spam", true);
  else {
    query = query.eq("is_spam", false);
    if (filter !== "all") query = query.eq("status", filter);
  }

  // Tab counts come from one light projection, not a query per status.
  const [{ data }, { data: all }] = await Promise.all([
    query,
    auth.admin.from("website_leads").select("status, is_spam").limit(5000),
  ]);
  const counts: Record<string, number> = { all: 0, spam: 0 };
  for (const r of (all ?? []) as { status: string; is_spam: boolean }[]) {
    if (r.is_spam) counts.spam += 1;
    else {
      counts.all += 1;
      counts[r.status] = (counts[r.status] ?? 0) + 1;
    }
  }

  return (
    <LeadsPanel
      rows={(data ?? []) as WebsiteLeadRow[]}
      filter={filter}
      counts={counts}
      canManage={auth.canManage}
    />
  );
}
