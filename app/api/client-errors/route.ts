import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ttlGateOpen } from "@/lib/cache/ttl";
import type { ClientErrorReport } from "@/lib/errors/report";

export const runtime = "nodejs";

/**
 * Receives the error boundaries' reports (lib/errors/report.ts). Writes them
 * to the server console — which the hosting's runtime log collects — and to
 * activity_log so an admin can see them under Admin → Logs without server
 * access. Signed-in users only; one report per user per 10 s so a render
 * loop cannot flood either sink.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse(null, { status: 401 });
  if (!ttlGateOpen("client-errors", user.id, 10_000)) return new NextResponse(null, { status: 204 });

  const body = (await req.json().catch(() => null)) as Partial<ClientErrorReport> | null;
  if (!body || typeof body.message !== "string") return new NextResponse(null, { status: 400 });

  const report = {
    scope: body.scope === "root" ? "root" : "page",
    name: String(body.name ?? "Error").slice(0, 100),
    message: body.message.slice(0, 1000),
    digest: typeof body.digest === "string" ? body.digest.slice(0, 100) : null,
    stack: typeof body.stack === "string" ? body.stack.slice(0, 4000) : null,
    url: typeof body.url === "string" ? body.url.slice(0, 500) : null,
    userAgent: typeof body.userAgent === "string" ? body.userAgent.slice(0, 300) : null,
    buildId: typeof body.buildId === "string" ? body.buildId.slice(0, 64) : null,
  };

  console.error(
    `[client-error] ${report.scope} ${report.name}: ${report.message} | user=${user.id} url=${report.url} digest=${report.digest ?? "-"} build=${report.buildId ?? "-"}\n${report.stack ?? ""}`,
  );

  try {
    await createAdminClient().from("activity_log").insert({
      user_id: user.id,
      action: "client.error",
      entity_type: "page",
      entity_id: null,
      new_value: report,
    });
  } catch {
    // the console line is the primary sink
  }
  return new NextResponse(null, { status: 204 });
}
