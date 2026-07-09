import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getAppSettings, getBranding } from "@/lib/settings/appSettings";

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

const ALLOWED_LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};
const MAX_LOGO_SIZE = 2 * 1024 * 1024;

export async function POST(req: Request) {
  const auth = await assertSettingsManage();
  if ("error" in auth) return authError(auth.error);

  const form = await req.formData();
  const logo = form.get("logo");
  if (!(logo instanceof File)) {
    return NextResponse.json({ error: "A logo file is required" }, { status: 422 });
  }
  const ext = ALLOWED_LOGO_TYPES[logo.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Logo must be PNG, JPEG, SVG, or WEBP" },
      { status: 422 }
    );
  }
  if (logo.size > MAX_LOGO_SIZE) {
    return NextResponse.json({ error: "Logo must be 2MB or smaller" }, { status: 422 });
  }

  const current = await getAppSettings();
  const admin = createAdminClient();

  const path = `logo-${Date.now()}.${ext}`;
  const { error: uploadError } = await admin.storage.from("branding").upload(path, logo, {
    contentType: logo.type,
    upsert: true,
  });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { error } = await admin.from("app_settings").upsert(
    {
      singleton: true,
      logo_path: path,
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    },
    { onConflict: "singleton" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (current.logo_path && current.logo_path !== path) {
    try {
      await admin.storage.from("branding").remove([current.logo_path]);
    } catch {
      // Best-effort cleanup; the new logo is already live either way.
    }
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "settings.branding_updated",
    entity_type: "app_settings",
    new_value: { logo_path: path },
  });

  return NextResponse.json({ branding: await getBranding() });
}

export async function DELETE() {
  const auth = await assertSettingsManage();
  if ("error" in auth) return authError(auth.error);

  const current = await getAppSettings();
  const admin = createAdminClient();

  const { error } = await admin.from("app_settings").upsert(
    {
      singleton: true,
      logo_path: null,
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    },
    { onConflict: "singleton" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (current.logo_path) {
    try {
      await admin.storage.from("branding").remove([current.logo_path]);
    } catch {
      // Best-effort cleanup.
    }
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "settings.branding_updated",
    entity_type: "app_settings",
    new_value: { logo_path: null },
  });

  return NextResponse.json({ branding: await getBranding() });
}
