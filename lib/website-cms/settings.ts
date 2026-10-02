import { createAdminClient } from "@/lib/supabase/admin";
import type { WebsiteSettingsRow, WebsiteStats } from "./types";

const DEFAULT_STATS: WebsiteStats = {
  sitesLaunched: 100,
  activeClients: 80,
  statesServed: 12,
  yearsActive: 2,
};

export const DEFAULT_SETTINGS: WebsiteSettingsRow = {
  singleton: true,
  stats: DEFAULT_STATS,
  revalidate_url: "https://socialexpertdigitalllc.com/api/revalidate",
  revalidate_secret: "",
  api_key: "",
  updated_at: new Date(0).toISOString(),
};

// 60s TTL — the public content API reads this on every request (key check),
// and the row changes about never. Same posture as getAppSettings.
let cached: { row: WebsiteSettingsRow; at: number } | null = null;
const TTL_MS = 60_000;

export async function getWebsiteSettings(): Promise<WebsiteSettingsRow> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.row;
  const admin = createAdminClient();
  const { data } = await admin.from("website_settings").select("*").eq("singleton", true).maybeSingle();
  const row: WebsiteSettingsRow = data
    ? { ...DEFAULT_SETTINGS, ...data, stats: { ...DEFAULT_STATS, ...(data.stats ?? {}) } }
    : DEFAULT_SETTINGS;
  cached = { row, at: Date.now() };
  return row;
}

export function invalidateWebsiteSettingsCache() {
  cached = null;
}
