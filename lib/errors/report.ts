/**
 * Browser-side error reporting. An error thrown while rendering a page in the
 * browser never reaches the server on its own, so "the dashboard shows an
 * error screen" was impossible to diagnose from the logs. The boundaries in
 * app/(app)/error.tsx and app/global-error.tsx call this once per error.
 */
export interface ClientErrorReport {
  scope: "page" | "root";
  name: string;
  message: string;
  digest?: string;
  stack?: string;
  url: string;
  userAgent: string;
  buildId?: string;
}

export function buildClientErrorReport(
  error: Error & { digest?: string },
  scope: ClientErrorReport["scope"],
  env: { url: string; userAgent: string; buildId?: string },
): ClientErrorReport {
  return {
    scope,
    name: String(error?.name ?? "Error").slice(0, 100),
    message: String(error?.message ?? "").slice(0, 1000),
    digest: error?.digest ? String(error.digest).slice(0, 100) : undefined,
    stack: error?.stack ? String(error.stack).slice(0, 4000) : undefined,
    url: env.url.slice(0, 500),
    userAgent: env.userAgent.slice(0, 300),
    buildId: env.buildId,
  };
}

/** Fire-and-forget; never throws (a reporter that throws would loop). */
export function reportClientError(error: Error & { digest?: string }, scope: ClientErrorReport["scope"]): void {
  try {
    const buildId = (window as unknown as { __NEXT_DATA__?: { buildId?: string } }).__NEXT_DATA__?.buildId;
    const body = JSON.stringify(
      buildClientErrorReport(error, scope, { url: window.location.href, userAgent: navigator.userAgent, buildId }),
    );
    fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never let reporting break the error page */
  }
}
