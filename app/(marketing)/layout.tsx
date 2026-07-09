import { createClient } from "@/lib/supabase/server";
import { getBranding } from "@/lib/settings/appSettings";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const branding = await getBranding();

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <MarketingHeader isAuthed={!!user} branding={branding} />
      <main className="flex-1">{children}</main>
      <MarketingFooter branding={branding} />
    </div>
  );
}
