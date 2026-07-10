import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { TemplatesBoard } from "@/components/template-engine/TemplatesBoard";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.manage")) redirect("/dashboard");

  return <TemplatesBoard />;
}
