import { NextResponse } from "next/server";
import { processQueue } from "@/lib/ai-tools/queue";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(req: Request) {
  const expected = process.env.WGE_PROCESSOR_SECRET;
  const secret = req.headers.get("x-wge-secret");
  // Fail closed: if the secret isn't configured, reject everything (never
  // process unauthenticated, which would otherwise pass when expected is undefined).
  if (!expected || !secret || secret !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await processQueue();
  return NextResponse.json(result);
}
