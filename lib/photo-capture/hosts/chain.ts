import { orderHosts } from "./order";
import type { HostProvider, HostStateStore, ImageHost, UploadAdapter, UploadSource } from "./types";

/** How long a rate-limited host sits out before the chain tries it again. */
export const COOLDOWN_MS = 60 * 60 * 1000;

export type ChainAttempt = {
  hostId: string;
  provider: HostProvider;
  outcome: "ok" | "quota" | "auth" | "error" | "not_configured";
  message?: string;
};

export type ChainResult = {
  directUrl: string | null;
  hostId: string | null;
  provider: HostProvider | null;
  attempts: ChainAttempt[];
  lastError: string | null;
};

/**
 * Try one photo against every usable host in order — imgbb keys, then
 * postimages, then imgchest tokens — until one accepts it.
 *
 * A quota failure parks the host for COOLDOWN_MS; a bad credential disables it
 * outright, because retrying a wrong key on every photo would burn the batch.
 * The caller decides what a total failure means for the photo: this returns it,
 * it never throws.
 */
export async function runUploadChain(
  source: UploadSource,
  deps: {
    hosts: ImageHost[];
    adapters: Record<HostProvider, UploadAdapter>;
    state: HostStateStore;
    now?: () => Date;
  }
): Promise<ChainResult> {
  const now = deps.now ?? (() => new Date());
  const attempts: ChainAttempt[] = [];
  let lastError: string | null = null;

  const usable = orderHosts(deps.hosts, now());
  if (usable.length === 0) {
    return { directUrl: null, hostId: null, provider: null, attempts, lastError: "No image host is configured" };
  }

  for (const host of usable) {
    const adapter = deps.adapters[host.provider];
    if (!adapter || !adapter.isConfigured(host.credentials)) {
      attempts.push({ hostId: host.id, provider: host.provider, outcome: "not_configured" });
      continue;
    }

    const result = await adapter.upload(source, { credentials: host.credentials });

    if (result.ok) {
      await deps.state.recordSuccess(host.id);
      attempts.push({ hostId: host.id, provider: host.provider, outcome: "ok" });
      return { directUrl: result.directUrl, hostId: host.id, provider: host.provider, attempts, lastError: null };
    }

    lastError = result.message;
    attempts.push({ hostId: host.id, provider: host.provider, outcome: result.reason, message: result.message });

    if (result.reason === "quota") {
      await deps.state.markExhausted(host.id, new Date(now().getTime() + COOLDOWN_MS), result.message);
    } else if (result.reason === "auth") {
      await deps.state.markAuthFailed(host.id, result.message);
    }
  }

  return { directUrl: null, hostId: null, provider: null, attempts, lastError };
}
