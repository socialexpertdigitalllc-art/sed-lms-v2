import type { Metadata } from "next";
import { Sparkles, ArrowUpCircle, Wrench } from "lucide-react";
import {
  CHANGELOG,
  formatVersion,
  type ChangeKind,
  type ChangelogEntry,
} from "@/lib/version/changelog";

export const metadata: Metadata = {
  title: "Changelog — SED LMS",
  description:
    "Every release of the SED Lead Management System: new features, improvements and fixes, newest first.",
};

const KIND_META: Record<
  ChangeKind,
  { label: string; className: string; Icon: typeof Sparkles }
> = {
  feature: {
    label: "Feature",
    className: "bg-accent-soft text-accent-ink",
    Icon: Sparkles,
  },
  improvement: {
    label: "Improvement",
    className: "bg-longterm-bg text-longterm-fg",
    Icon: ArrowUpCircle,
  },
  fix: {
    label: "Fix",
    className: "bg-notready-bg text-notready-fg",
    Icon: Wrench,
  },
};

const KIND_ORDER: ChangeKind[] = ["feature", "improvement", "fix"];

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function KindTag({ kind }: { kind: ChangeKind }) {
  const { label, className, Icon } = KIND_META[kind];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${className}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}

function Release({ entry, latest }: { entry: ChangelogEntry; latest: boolean }) {
  const groups = KIND_ORDER.map((kind) => ({
    kind,
    changes: entry.changes.filter((c) => c.kind === kind),
  })).filter((g) => g.changes.length > 0);

  return (
    <article className="grid md:grid-cols-[160px_1fr] gap-4 md:gap-10 py-10 border-t border-border first:border-t-0 first:pt-0">
      <div className="md:sticky md:top-24 md:self-start">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-mono tabular text-lg font-semibold text-text">
            {formatVersion(entry.version)}
          </h2>
          {latest ? (
            <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent-ink">
              Latest
            </span>
          ) : null}
        </div>
        <time
          dateTime={entry.date}
          className="mt-1 block font-mono tabular text-xs text-text-faint"
        >
          {formatDate(entry.date)}
        </time>
      </div>

      <div>
        <h3 className="font-display text-xl font-bold tracking-tight text-text">
          {entry.title}
        </h3>
        <div className="mt-5 space-y-6">
          {groups.map((group) => (
            <section key={group.kind}>
              <KindTag kind={group.kind} />
              <ul className="mt-3 space-y-2.5">
                {group.changes.map((change, i) => (
                  <li
                    key={i}
                    className="relative pl-4 text-[15px] leading-relaxed text-text-muted before:absolute before:left-0 before:top-[0.6em] before:h-1 before:w-1 before:rounded-full before:bg-border"
                  >
                    {change.text}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </article>
  );
}

export default function ChangelogPage() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-12 md:py-16">
      <header className="pb-10 border-b border-border">
        <div className="text-[11px] uppercase tracking-wider text-text-faint font-semibold">
          Release notes
        </div>
        <h1 className="mt-3 font-display text-3xl md:text-4xl font-bold tracking-tight text-text">
          Changelog
        </h1>
        <p className="mt-4 max-w-2xl text-text-muted leading-relaxed">
          Everything that has shipped in the SED Lead Management System, newest
          first. Versions follow{" "}
          <span className="font-mono tabular text-text">v2.MINOR.PATCH</span> — a
          new feature or system bumps the minor number, a fix or small change
          bumps the patch.
        </p>
      </header>

      <div className="mt-2">
        {CHANGELOG.map((entry, i) => (
          <Release key={entry.version} entry={entry} latest={i === 0} />
        ))}
      </div>
    </div>
  );
}
