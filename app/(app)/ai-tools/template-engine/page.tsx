import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import {
  TemplateEngineBoard,
  type LeadOption,
  type TemplateOption,
} from "@/components/template-engine/TemplateEngineBoard";

export const dynamic = "force-dynamic";

export default async function TemplateEnginePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.generate")) redirect("/dashboard");
  const canDeploy = perms.has("templates.deploy");

  // Cross-team pickers: bypass RLS via the admin client. Safe because the page
  // is gated on templates.generate above, mirroring the API's own checks.
  const admin = createAdminClient();
  const [{ data: leads }, { data: templates }] = await Promise.all([
    admin
      .from("leads")
      .select("id, business_name, services, service_areas, image_links, status")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("website_templates")
      .select("id, name, manifest, page_count")
      .eq("status", "active")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <Suspense fallback={null}>
      <TemplateEngineBoard
        leads={(leads ?? []) as LeadOption[]}
        templates={(templates ?? []) as TemplateOption[]}
        canDeploy={canDeploy}
      />
    </Suspense>
  );
}
