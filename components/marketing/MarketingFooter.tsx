import Link from "next/link";
import { BrandMark } from "@/components/branding/BrandMark";
import type { Branding } from "@/lib/settings/appSettings";
import { APP_VERSION, formatVersion } from "@/lib/version/changelog";

export function MarketingFooter({ branding }: { branding: Branding }) {
  return (
    <footer className="border-t border-border bg-surface-2">
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8">
          <div className="max-w-xs">
            <BrandMark companyName={branding.companyName} logoUrl={branding.logoUrl} size={32} />
            <p className="text-sm text-text-muted mt-3 leading-relaxed">
              The lead-management console for Social Expert Digital — pipeline, client
              websites, mail and contracts in one permission-aware system.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-text-faint font-semibold mb-3">Product</div>
              <ul className="space-y-2 text-text-muted">
                <li><a href="/#pipeline" className="hover:text-text">Lead pipeline</a></li>
                <li><a href="/#websites" className="hover:text-text">Website generation</a></li>
                <li><a href="/#deployment" className="hover:text-text">Deployment</a></li>
                <li><a href="/#operations" className="hover:text-text">Operations</a></li>
              </ul>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-text-faint font-semibold mb-3">Resources</div>
              <ul className="space-y-2 text-text-muted">
                <li><Link href="/docs" className="hover:text-text">Documentation</Link></li>
                <li><Link href="/changelog" className="hover:text-text">Changelog</Link></li>
                <li><Link href="/docs#permissions" className="hover:text-text">Permissions</Link></li>
                <li><Link href="/docs#faq" className="hover:text-text">FAQ</Link></li>
              </ul>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-text-faint font-semibold mb-3">Account</div>
              <ul className="space-y-2 text-text-muted">
                <li><Link href="/login" className="hover:text-text">Log in</Link></li>
                <li><Link href="/dashboard" className="hover:text-text">Dashboard</Link></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-text-faint">
            © {2026} Social Expert Digital. All rights reserved.
          </p>
          <Link
            href="/changelog"
            className="text-xs font-mono tabular text-text-faint hover:text-accent-ink transition-colors"
          >
            {formatVersion(APP_VERSION)} · changelog
          </Link>
        </div>
      </div>
    </footer>
  );
}
