import { WebsiteTabs } from "@/components/website-cms/WebsiteTabs";
import { PageHeader } from "@/components/common/Panel";

export default function WebsiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="Website"
        description="socialexpertdigitalllc.com is rendered from this content — edits go live in seconds, no deploys."
      />
      <WebsiteTabs />
      {children}
    </div>
  );
}
