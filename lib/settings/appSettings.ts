import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { ttlCached, ttlInvalidate } from "@/lib/cache/ttl";

export type AppSettings = {
  work_start_time: string;
  work_timezone: string;
  idle_timeout_minutes: number;
  ticket_sla: { Low: number; Normal: number; High: number };
  ticket_retention_days: number;
  company_name: string;
  logo_path: string | null;
  contract_templates_folder_id: string | null;
  /** Where generated contract copies are created; null = alongside the template. */
  generated_contracts_folder_id: string | null;
  /** Form Relay fallback sender when an endpoint has no mailbox of its own. */
  form_default_mailbox_id: string | null;
};

const DEFAULT_APP_SETTINGS: AppSettings = {
  work_start_time: "09:00",
  work_timezone: "Asia/Karachi",
  idle_timeout_minutes: 15,
  ticket_sla: { Low: 168, Normal: 72, High: 24 },
  ticket_retention_days: 0,
  company_name: "SED LMS",
  logo_path: null,
  contract_templates_folder_id: null,
  generated_contracts_folder_id: null,
  form_default_mailbox_id: null,
};

// Read the singleton company settings row; lazily materialise the default
// row if missing. Uses the service-role client so it works both in admin
// UI requests and in headless pollers (no session) — mirrors getWgeConfig.
// Two cache layers: React's request-level cache dedupes the metadata +
// layout reads within one render, and a 60s process-level TTL (invalidated
// by the admin settings route on write) keeps the singleton row from being
// re-read on every request and poller tick — it changes ~never but was read
// constantly (disk-IO budget incident, 2026-08-17).
export const getAppSettings = cache(
  async (): Promise<AppSettings> =>
    ttlCached("app-settings", "singleton", 60_000, async () => {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("app_settings")
        .select("work_start_time, work_timezone, idle_timeout_minutes, ticket_sla, ticket_retention_days, company_name, logo_path, contract_templates_folder_id, generated_contracts_folder_id, form_default_mailbox_id")
        .eq("singleton", true)
        .maybeSingle();

      if (data) return data as AppSettings;

      // A select ERROR is not "no row": if a not-yet-applied migration makes
      // a column unknown (42703), seeding here would UPSERT defaults over the
      // real singleton row — wiping branding, work hours and SLAs app-wide.
      // Serve defaults for this TTL window and touch nothing.
      if (error) return DEFAULT_APP_SETTINGS;

      // seed default row (service role; RLS blocks client writes)
      await admin
        .from("app_settings")
        .upsert({ singleton: true, ...DEFAULT_APP_SETTINGS }, { onConflict: "singleton" });
      return DEFAULT_APP_SETTINGS;
    }),
);

export function invalidateAppSettingsCache(): void {
  ttlInvalidate("app-settings");
}

export function logoPublicUrl(logoPath: string | null): string | null {
  if (!logoPath) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/branding/${logoPath}`;
}

export type Branding = { companyName: string; logoUrl: string | null };

/** Fallback-safe: never throws (metadata generation must not crash a render/build). */
export const getBranding = cache(async (): Promise<Branding> => {
  try {
    const s = await getAppSettings();
    return { companyName: s.company_name || "SED LMS", logoUrl: logoPublicUrl(s.logo_path) };
  } catch {
    return { companyName: "SED LMS", logoUrl: null };
  }
});
