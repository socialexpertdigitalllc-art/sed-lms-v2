"use client";

import { useEffect, useState } from "react";
import { Download, Copy, Check } from "lucide-react";

/**
 * Shown when no extension handshake has arrived, or when the installed build is
 * older than the current one.
 *
 * The button downloads a zip; it CANNOT install. Chrome removed inline
 * installation in Chrome 71 — a web page has no way to add an extension. Step 2
 * is a copy button rather than a link because Chrome blocks pages from
 * navigating to chrome:// URLs.
 */
export function ExtensionInstallCard({ installed, version }: { installed: boolean; version: string | null }) {
  const [latest, setLatest] = useState<{ version: string; downloadUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/extension/version")
      .then((r) => (r.ok ? r.json() : null))
      .then(setLatest)
      .catch(() => setLatest(null));
  }, []);

  const outdated = installed && !!latest && !!version && version !== latest.version;
  if ((installed && !outdated) || !latest) return null;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
      <h3 className="font-medium">
        {outdated ? `Update available — v${latest.version}` : "Photo capture needs the browser extension"}
      </h3>
      <p className="mt-1 text-sm text-text-faint">
        {outdated
          ? `You are running v${version}. Download the new build and reload it in Chrome.`
          : "Install it once and photos are captured from Google profiles automatically."}
      </p>

      <a
        href={latest.downloadUrl}
        download
        className="mt-3 inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-sm font-medium"
      >
        <Download size={16} /> Download extension v{latest.version}
      </a>

      <ol className="mt-3 space-y-1 text-sm text-text-faint">
        <li>1. Unzip the download somewhere permanent (moving it later breaks the install).</li>
        <li className="flex items-center gap-2">
          2. Open
          <code className="rounded bg-surface-2 px-1.5 py-0.5">chrome://extensions</code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText("chrome://extensions").then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
          </button>
        </li>
        <li>3. Turn on <strong>Developer mode</strong> (top right).</li>
        <li>4. Click <strong>Load unpacked</strong> and pick the unzipped folder.</li>
      </ol>
      <p className="mt-2 text-xs text-text-faint">
        Chrome shows a &ldquo;Disable developer mode extensions&rdquo; warning on startup. It is expected — dismiss it.
      </p>
    </div>
  );
}
