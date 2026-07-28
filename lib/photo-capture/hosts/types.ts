/** The three image hosts, in the fixed fallback order (see the design, §8). */
export type HostProvider = "imgbb" | "postimages" | "imgchest";

/** One configured credential slot. postimages has no API, so its rows carry no credentials. */
export type ImageHost = {
  id: string;
  provider: HostProvider;
  label: string;
  /** Insertion order within a provider. Lower goes first. */
  position: number;
  enabled: boolean;
  /** Set when the host reported a limit; it rejoins the chain after this. */
  exhaustedUntil: Date | null;
  /** Decrypted. NEVER serialise into an HTTP response. */
  credentials: Record<string, string> | null;
};

/** Why an upload attempt failed, which decides what we do to the host. */
export type UploadFailure = "quota" | "auth" | "error";

/**
 * One photo to upload. `fetchBytes` is lazy on purpose: imgbb accepts a URL and
 * fetches the image itself, so that path must never download anything.
 */
export type UploadSource = {
  url: string;
  filename: string;
  fetchBytes: () => Promise<Buffer>;
};

export type UploadResult =
  | { ok: true; directUrl: string }
  | { ok: false; reason: UploadFailure; message: string };

export type UploadAdapter = {
  provider: HostProvider;
  /** False for postimages, which needs no key at all. */
  needsCredentials: boolean;
  isConfigured(credentials: Record<string, string> | null): boolean;
  upload(source: UploadSource, ctx: { credentials: Record<string, string> | null }): Promise<UploadResult>;
};

/** Persistence the chain needs. Injected so the chain is unit-testable. */
export type HostStateStore = {
  markExhausted(hostId: string, until: Date, message: string): Promise<void>;
  markAuthFailed(hostId: string, message: string): Promise<void>;
  recordSuccess(hostId: string): Promise<void>;
};
