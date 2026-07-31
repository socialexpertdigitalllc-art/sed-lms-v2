import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { buildAgentPeriodicReport } from "@/lib/reports/agentPeriodic";
import { renderReportPdf } from "@/lib/reports/ReportDocument";

export const runtime = "nodejs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("reports.agent_periodic")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId") ?? "";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!UUID.test(agentId) || !DATE.test(from) || !DATE.test(to) || from > to) {
    return NextResponse.json({ error: "Invalid input" }, { status: 422 });
  }

  const admin = createAdminClient();
  let report;
  try {
    report = await buildAgentPeriodicReport(admin, {
      agentId,
      from,
      to,
      includeAttendance: url.searchParams.get("attendance") === "1",
    });
  } catch (e) {
    console.error("[reports/agent/pdf] build failed:", e);
    return NextResponse.json({ error: "Failed to build report" }, { status: 500 });
  }
  if (!report) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const buffer = await renderReportPdf(report);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="agent-report-${from}-${to}.pdf"`,
    },
  });
}
