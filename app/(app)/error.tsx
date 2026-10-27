"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/errors/report";

/**
 * Error boundary for every signed-in page. Until now the app had none, so any
 * uncaught error on a page fell through to Next's built-in page ("This page
 * couldn't load" on a black screen) — no sidebar, no detail, and, when the
 * error happened in the browser, no trace of it anywhere.
 *
 * This keeps the shell, says what failed, offers "Try again" (re-renders the
 * page, no reload) and reports the error to the server so the cause lands in
 * the runtime log and Admin → Logs (lib/errors/report.ts).
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error, "page");
  }, [error]);

  const chunkFailure = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module/i.test(
    `${error.name} ${error.message}`,
  );

  return (
    <div className="bg-surface border border-border rounded-lg p-8 max-w-xl mx-auto mt-10 text-center space-y-4">
      <h1 className="text-lg font-semibold text-text">This page couldn’t load</h1>
      <p className="text-sm text-text-muted">
        {chunkFailure
          ? "The app was updated since this tab was opened. Reload to get the new version."
          : "Something went wrong while showing this page. It has been reported."}
      </p>
      {error.digest ? <p className="text-xs text-text-faint font-mono">ref {error.digest}</p> : null}
      <div className="flex justify-center gap-2">
        {chunkFailure ? null : (
          <button
            onClick={() => reset()}
            className="px-3 py-2 rounded-md bg-accent text-white text-sm hover:opacity-90"
          >
            Try again
          </button>
        )}
        <button
          onClick={() => window.location.reload()}
          className="px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-muted hover:bg-surface-2"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
