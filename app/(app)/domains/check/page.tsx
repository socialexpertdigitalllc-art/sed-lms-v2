import { redirect } from "next/navigation";
import { requireDomains } from "@/lib/domains/guard";
import { DomainChecker } from "@/components/domains/DomainChecker";

export const dynamic = "force-dynamic";

/** Check a name: domain availability for anyone with domains.view (sales on a call). */
export default async function DomainCheckPage() {
  const auth = await requireDomains("view");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/dashboard");
  return <DomainChecker canPurchase={auth.canPurchase} />;
}
