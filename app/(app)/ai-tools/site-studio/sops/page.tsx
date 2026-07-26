import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { StudioTabs } from "@/components/site-studio/StudioTabs";
import { SopViewer } from "@/components/site-studio/SopViewer";
import { SOPS, loadSop } from "@/lib/site-studio/sops";

export const dynamic = "force-dynamic";

/**
 * The SOPs page: gated the same as every other Site Studio surface
 * (`studio.manage`), mounts the shared `StudioTabs`, and loads all three SOP
 * documents server-side (there are only three, and they're short — no
 * client-side fetch is worth adding on top of that). `?doc=<slug>` lets a
 * contextual link elsewhere in Site Studio (the Templates board, the runs
 * cockpit, a failed run's error panel) land directly on the right document;
 * an unknown/absent slug just falls back to the first one, exactly like
 * `SopViewer`'s own `initialSlug` fallback.
 */
export default async function SiteStudioSopsPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  const { doc } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("studio.manage")) redirect("/dashboard");

  const loaded = await Promise.all(SOPS.map((entry) => loadSop(entry.slug)));
  const docs = SOPS.map((entry, i) => ({
    slug: entry.slug,
    title: entry.title,
    markdown: loaded[i]?.markdown ?? `_${entry.title} could not be loaded._`,
  }));

  return (
    <div className="space-y-4">
      <StudioTabs />
      <SopViewer docs={docs} initialSlug={doc} />
    </div>
  );
}
