import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getAppSettings } from "@/lib/settings/appSettings";

async function assertSettingsManage(): Promise<{ userId: string } | { error: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.settings.manage")) return { error: 403 };
  return { userId: user.id };
}

function authError(status: number) {
  return NextResponse.json(
    { error: status === 401 ? "Unauthorized" : "Forbidden" },
    { status }
  );
}

export async function GET() {
  const auth = await assertSettingsManage();
  if ("error" in auth) return authError(auth.error);
  return NextResponse.json(await getAppSettings());
}

const settingsSchema = z.object({
  work_start_time: z.string().regex(/^\d{2}:\d{2}$/, "must be in HH:MM format"),
  work_timezone: z.string().trim().min(1, "timezone is required"),
  idle_timeout_minutes: z.number().int().min(1, "must be at least 1 minute"),
  ticket_sla: z.object({
    Low: z.number().int().min(1),
    Normal: z.number().int().min(1),
    High: z.number().int().min(1),
  }),
  ticket_retention_days: z.number().int().min(0),
  company_name: z.string().trim().min(1).max(80),
});

export async function PUT(req: Request) {
  const auth = await assertSettingsManage();
  if ("error" in auth) return authError(auth.error);

  const parsed = settingsSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid settings", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const {
    work_start_time,
    work_timezone,
    idle_timeout_minutes,
    ticket_sla,
    ticket_retention_days,
    company_name,
  } = parsed.data;
  const admin = createAdminClient();
  const { error } = await admin.from("app_settings").upsert(
    {
      singleton: true,
      work_start_time,
      work_timezone,
      idle_timeout_minutes,
      ticket_sla,
      ticket_retention_days,
      company_name,
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    },
    { onConflict: "singleton" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "settings.updated",
    entity_type: "app_settings",
  });

  return NextResponse.json({
    work_start_time,
    work_timezone,
    idle_timeout_minutes,
    ticket_sla,
    ticket_retention_days,
    company_name,
  });
}
