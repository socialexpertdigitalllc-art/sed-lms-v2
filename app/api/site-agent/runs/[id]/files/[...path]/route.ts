// app/api/site-agent/runs/[id]/files/[...path]/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentRunAccess } from "@/lib/site-agent/access";
import { isSafeAssetPath } from "@/lib/site-studio/preview/assetPath";
import { loadRunMap } from "@/lib/site-agent/resultCache";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; path: string[] }> };

/** Strict UTF-8 decode — a failure is how we detect "this is not a text file",
 *  so the diff viewer never renders mojibake (or worse, ships megabytes of
 *  image bytes as a JSON string). */
function tryDecode(bytes: Uint8Array): { ok: true; text: string } | { ok: false } {
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false };
  }
}

/**
 * GET — one file's before/after pair for the review screen's diff viewer:
 *
 *   before = the file as it was in original.zip (null when the agent CREATED it)
 *   after  = the file as it is in result.zip    (null when the agent DELETED it)
 *
 * If either present side is not valid UTF-8 the pair is reported as binary —
 * byte lengths only, never contents. Both zips come through the TTL-cached
 * loader keyed on updated_at, so a review screen flipping between files costs
 * one download+unzip per zip per minute, not per click.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { id, path } = await ctx.params;
  const admin = createAdminClient();
  const access = await agentRunAccess(admin, id);
  if ("error" in access) return access.error;

  const filePath = (path ?? []).map((s) => decodeURIComponent(s)).join("/");
  if (!isSafeAssetPath(filePath)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const version = access.run.updated_at;
  const [originalMap, resultMap] = await Promise.all([
    loadRunMap(admin, id, "original", version),
    loadRunMap(admin, id, "result", version),
  ]);
  // No result zip yet — the run is still queued/running (or failed before
  // harvest). The review screen shouldn't be asking, but a stale tab might.
  if (!resultMap) {
    return NextResponse.json({ error: "This run has no edited files yet." }, { status: 409 });
  }

  const before = (originalMap ?? {})[filePath];
  const after = resultMap[filePath];
  if (before === undefined && after === undefined) {
    return NextResponse.json({ error: "File not in this run" }, { status: 404 });
  }

  const beforeText = before === undefined ? null : tryDecode(before);
  const afterText = after === undefined ? null : tryDecode(after);
  if ((beforeText !== null && !beforeText.ok) || (afterText !== null && !afterText.ok)) {
    return NextResponse.json({
      path: filePath, binary: true, before: null, after: null,
      beforeBytes: before === undefined ? null : before.byteLength,
      afterBytes: after === undefined ? null : after.byteLength,
    });
  }
  return NextResponse.json({
    path: filePath, binary: false,
    before: beforeText && beforeText.ok ? beforeText.text : null,
    after: afterText && afterText.ok ? afterText.text : null,
  });
}
