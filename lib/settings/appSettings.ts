import { createAdminClient } from "@/lib/supabase/admin";

export type AppSettings = {
  work_start_time: string;
  work_timezone: string;
  idle_timeout_minutes: number;
  ticket_sla: { Low: number; Normal: number; High: number };
  ticket_retention_days: number;
};

const DEFAULT_APP_SETTINGS: AppSettings = {
  work_start_time: "09:00",
  work_timezone: "Asia/Karachi",
  idle_timeout_minutes: 15,
  ticket_sla: { Low: 168, Normal: 72, High: 24 },
  ticket_retention_days: 0,
};

// Read the singleton company settings row; lazily materialise the default
// row if missing. Uses the service-role client so it works both in admin
// UI requests and in headless pollers (no session) — mirrors getWgeConfig.
export async function getAppSettings(): Promise<AppSettings> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("app_settings")
    .select("work_start_time, work_timezone, idle_timeout_minutes, ticket_sla, ticket_retention_days")
    .eq("singleton", true)
    .maybeSingle();

  if (data) return data as AppSettings;

  // seed default row (service role; RLS blocks client writes)
  await admin
    .from("app_settings")
    .upsert({ singleton: true, ...DEFAULT_APP_SETTINGS }, { onConflict: "singleton" });
  return DEFAULT_APP_SETTINGS;
}
