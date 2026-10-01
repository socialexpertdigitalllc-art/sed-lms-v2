import { redirect } from "next/navigation";
import { requireDomains } from "@/lib/domains/guard";
import { DomainsBoard } from "@/components/domains/DomainsBoard";

export default async function DomainsPage() {
  const auth = await requireDomains("view");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/dashboard");
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <DomainsBoard />
    </div>
  );
}
