import { notFound, redirect } from "next/navigation";
import { requireDomains } from "@/lib/domains/guard";
import { loadDomainDetail } from "@/lib/domains/detail";
import { DomainDetailView } from "@/components/domains/DomainDetail";

export default async function DomainPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDomains("view");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/dashboard");
  const { id } = await params;
  const detail = await loadDomainDetail(auth.admin, id);
  if (!detail) notFound();
  return <DomainDetailView initial={detail} canManage={auth.canManage} canPurchase={auth.canPurchase} />;
}
