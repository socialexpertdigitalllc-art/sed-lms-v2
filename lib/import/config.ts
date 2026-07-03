import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_MAPPING } from "./columns";

export interface ImportConfig {
  sheet_id: string;
  sheet_tab: string;
  mapping: Record<string, string>;
}

const DEFAULTS: ImportConfig = {
  sheet_id: "1KBWPYJHyXiradB9csWMYEnlFPXVHGDTyc1pmv3uB8sk",
  sheet_tab: "New (April 2026)",
  mapping: DEFAULT_MAPPING,
};

// Read the singleton import config; lazily seed defaults if missing. Service role.
export async function getImportConfig(): Promise<ImportConfig> {
  const admin = createAdminClient();
  const { data } = await admin.from("import_config").select("sheet_id, sheet_tab, mapping").eq("singleton", true).maybeSingle();
  if (data && data.mapping && Object.keys(data.mapping).length > 0) {
    return { sheet_id: data.sheet_id, sheet_tab: data.sheet_tab, mapping: data.mapping as Record<string, string> };
  }
  await admin.from("import_config").upsert({ singleton: true, ...DEFAULTS }, { onConflict: "singleton" });
  return DEFAULTS;
}
