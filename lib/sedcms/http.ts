import { NextResponse } from "next/server";
import type { z } from "zod";
import { precheckSedcms, verifySedcms } from "./signature";

/**
 * The request and answer plumbing every /api/internal/sedcms route shares.
 * SERVER ONLY.
 *
 * Order: the body-free signature checks; the raw body, at most the route's
 * own cap; the full signature check over those exact bytes; then strict
 * UTF-8, JSON and the route's schema. Nothing touches the database or a host
 * before the signature holds.
 *
 * The HMAC covers the body, so a body is read before it can be checked: a
 * forged request with well-formed headers costs the LMS its route's cap, and
 * no more. So each route reads only what its largest real request needs:
 * 64 KiB for summary, live-files and checksums, 160 KiB for tickets, 30 MiB
 * for apply alone.
 *
 * Every error is { code, message } (plus the contract's own fields), with no
 * stack and no hosting detail beyond the step that failed.
 */

/** apply: 50 files, 20 MiB decoded, as base64 in JSON. */
export const MAX_REQUEST_BYTES = 30 * 1024 * 1024;
/** summary, live-files, checksums: at most 100 paths of 300 characters. */
export const SMALL_REQUEST_BYTES = 64 * 1024;
/** tickets: 10 items of 2000 characters and the rest, even with every character escaped in the JSON (6 bytes each, about 136 KB). */
export const TICKET_REQUEST_BYTES = 160 * 1024;

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${bytes / (1024 * 1024)} MiB` : `${bytes / 1024} KiB`;
}

export function sedcmsJson(status: number, body: unknown): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function sedcmsError(status: number, code: string, message: string, extra: Record<string, unknown> = {}): NextResponse {
  return sedcmsJson(status, { code, message, ...extra });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

async function readRawBody(req: Request, max: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false }> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) return { ok: false };
  if (!req.body) return { ok: true, bytes: new Uint8Array() };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return { ok: false };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return { ok: true, bytes };
}

function signatureRefusal(status: 401 | 503): NextResponse {
  return status === 503
    ? sedcmsError(503, "NOT_CONFIGURED", "The LMS is not set up to take CMS requests.")
    : sedcmsError(401, "BAD_SIGNATURE", "The request's signature was not accepted.");
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** A signed request's body, at most `maxBytes`, parsed and checked against the route's schema. */
export async function readSignedJson<S extends z.ZodType>(
  req: Request,
  schema: S,
  maxBytes: number,
): Promise<{ ok: true; body: z.infer<S> } | { ok: false; response: NextResponse }> {
  const pre = precheckSedcms(req);
  if (!pre.ok) return { ok: false, response: signatureRefusal(pre.status) };

  const raw = await readRawBody(req, maxBytes);
  if (!raw.ok) return { ok: false, response: sedcmsError(413, "TOO_LARGE", `The request body is over ${sizeLabel(maxBytes)}.`) };

  const verdict = await verifySedcms(req, raw.bytes);
  if (!verdict.ok) return { ok: false, response: signatureRefusal(verdict.status) };

  let parsed: unknown;
  try {
    parsed = JSON.parse(strictUtf8.decode(raw.bytes));
  } catch {
    return { ok: false, response: sedcmsError(400, "BAD_REQUEST", "The body is not JSON.") };
  }
  const checked = schema.safeParse(parsed);
  if (!checked.success) return { ok: false, response: sedcmsError(400, "BAD_REQUEST", "The body is not what this endpoint takes.") };
  return { ok: true, body: checked.data };
}
