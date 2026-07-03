import Link from "next/link";
import { IconArrowRight } from "./icons";

export function MarketingHeader({ isAuthed }: { isAuthed: boolean }) {
  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-bg/75 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-5 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-accent grid place-items-center text-white font-bold">
            S
          </span>
          <span className="font-semibold text-text tracking-tight">SED&nbsp;LMS</span>
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm text-text-muted">
          <a href="/#features" className="hover:text-text transition-colors">Features</a>
          <a href="/#permissions" className="hover:text-text transition-colors">Permissions</a>
          <a href="/#workflow" className="hover:text-text transition-colors">How it works</a>
          <Link href="/docs" className="hover:text-text transition-colors">Docs</Link>
        </nav>

        <div className="flex items-center gap-3">
          {isAuthed ? (
            <Link
              href="/dashboard"
              className="group inline-flex items-center gap-1.5 bg-accent text-white text-sm font-semibold rounded-lg px-4 py-2 hover:bg-accent-ink transition-colors"
            >
              Open dashboard
              <IconArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-sm font-medium text-text-muted hover:text-text transition-colors">
                Log in
              </Link>
              <Link
                href="/login"
                className="group inline-flex items-center gap-1.5 bg-accent text-white text-sm font-semibold rounded-lg px-4 py-2 hover:bg-accent-ink transition-colors"
              >
                Get started
                <IconArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
