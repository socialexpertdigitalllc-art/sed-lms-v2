import { ServiceWorkerRegistrar } from "@/components/email-verify/ServiceWorkerRegistrar";
import { VerifyApp } from "@/components/email-verify/VerifyApp";

/** Session-dependent (the layout gates on auth), so never prerendered. */
export const dynamic = "force-dynamic";

export default function VerifyPage() {
  return (
    <>
      {/* Registered here and nowhere else — the worker's scope is /verify only. */}
      <ServiceWorkerRegistrar />
      <VerifyApp />
    </>
  );
}
