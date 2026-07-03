import Link from "next/link";

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-surface-2">
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8">
          <div className="max-w-xs">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-accent grid place-items-center text-white font-bold">S</span>
              <span className="font-semibold text-text tracking-tight">SED&nbsp;LMS</span>
            </div>
            <p className="text-sm text-text-muted mt-3 leading-relaxed">
              The lead-management console for Social Expert Digital — every lead, agent, and
              department in one permission-aware system.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-text-faint font-semibold mb-3">Product</div>
              <ul className="space-y-2 text-text-muted">
                <li><a href="/#features" className="hover:text-text">Features</a></li>
                <li><a href="/#permissions" className="hover:text-text">Permissions</a></li>
                <li><a href="/#workflow" className="hover:text-text">How it works</a></li>
              </ul>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-text-faint font-semibold mb-3">Resources</div>
              <ul className="space-y-2 text-text-muted">
                <li><Link href="/docs" className="hover:text-text">Documentation</Link></li>
                <li><Link href="/docs#getting-started" className="hover:text-text">Getting started</Link></li>
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
          <p className="text-xs font-mono text-text-faint">v2 · built for scale</p>
        </div>
      </div>
    </footer>
  );
}
