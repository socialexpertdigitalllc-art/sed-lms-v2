import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import {
  SetupPanel,
  type LeadOption,
  type TemplateOption,
} from "@/components/template-engine/wizard/SetupPanel";
import { RunsList } from "@/components/template-engine/wizard/RunsList";

export const dynamic = "force-dynamic";

export default async function TemplateEnginePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.generate")) redirect("/dashboard");

  // Cross-team pickers: bypass RLS via the admin client. Safe because the page
  // is gated on templates.generate above, mirroring the API's own checks.
  const admin = createAdminClient();
  const [{ data: leads }, { data: templates }] = await Promise.all([
    admin
      .from("leads")
      .select(
        "id, business_name, status, business_phone, business_email, no_email, business_profile_link, logo_link, map_embed_link, site_type, services, service_areas, num_webpages, specify_pages, client_experience, color_scheme, color_same_as_logo, image_links"
      )
      // Only "Not Ready" leads are candidates for a new website — a Ready lead
      // already has a site, and Closed/Dropped/Long Term aren't being worked.
      .eq("status", "Not Ready")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(300),
    admin
      .from("website_templates")
      .select("id, name, manifest, page_count")
      .eq("status", "active")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Template Engine</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Build a full website from a template for a lead, track it live, then review and deploy.
        </p>
      </div>
      <Suspense fallback={null}>
        <SetupPanel
          leads={(leads ?? []) as LeadOption[]}
          templates={(templates ?? []) as TemplateOption[]}
        />
      </Suspense>
      <RunsList />
    </div>
  );
}
