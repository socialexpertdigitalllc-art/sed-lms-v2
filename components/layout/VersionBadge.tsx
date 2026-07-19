import Link from "next/link";
import { APP_VERSION, formatVersion } from "@/lib/version/changelog";

/**
 * Small fixed chip in the bottom-right corner of the authenticated app that
 * shows the running version and links to the public changelog.
 */
export function VersionBadge() {
  return (
    <Link
      href="/changelog"
      title="View changelog"
      className="fixed bottom-3 right-3 z-40 rounded-sm border border-border bg-surface/90 px-1.5 py-0.5 font-mono tabular text-[11px] leading-none text-text-faint backdrop-blur transition-colors hover:text-text"
    >
      {formatVersion(APP_VERSION)}
    </Link>
  );
}
