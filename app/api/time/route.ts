import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/time — the server's clock, for pages to keep company time on the
 * server's clock rather than the device's (lib/time/companyTime.ts). Public:
 * it says nothing but the time.
 */
export function GET() {
  return NextResponse.json({ now: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
