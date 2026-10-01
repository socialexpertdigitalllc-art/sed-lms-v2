import { DomainsTabs } from "@/components/domains/DomainsTabs";

export default function DomainsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <DomainsTabs />
      {children}
    </div>
  );
}
