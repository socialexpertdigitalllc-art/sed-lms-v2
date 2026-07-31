import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { buildAgentPeriodicReport } from "@/lib/reports/agentPeriodic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const schema = z
  .object({
    agentId: z.string().uuid(),
    from: z.string().regex(DATE),
    to: z.string().regex(DATE),
    includeAttendance: z.boolean().optional().default(false),
  })
  .refine((v) => v.from <= v.to, { message: "from must be on or before to" })
  .refine(
    (v) =>
      [v.from, v.to].every(
        (s) => new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s
      ),
    { message: "invalid calendar date" }
  );

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("reports.agent_periodic")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 422 });
  }

  const admin = createAdminClient();
  let report;
  try {
    report = await buildAgentPeriodicReport(admin, parsed.data);
  } catch (e) {
    console.error("[reports/agent] build failed:", e);
    return NextResponse.json({ error: "Failed to build report" }, { status: 500 });
  }
  if (!report) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return NextResponse.json({ report });
}
