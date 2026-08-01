import { redirect } from "next/navigation";

// The legacy v2 "Deployed Sites" board is retired — the unified deployments
// board under Site Builder manages every site (generated, manual, custom
// domain) in one place.
export default function DeploymentsPage() {
  redirect("/ai-tools/site-builder/deployments");
}
