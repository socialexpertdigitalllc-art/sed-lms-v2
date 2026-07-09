import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getAllRules } from "@/lib/notifications/rules";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/events";

async function guard(): Promise<{ error: 401 } | { error: 403 } | { userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.notifications.manage")) return { error: 403 };
  return { userId: user.id };
}

function guardError(status: 401 | 403) {
  return NextResponse.json(
    { error: status === 401 ? "Unauthorized" : "Forbidden" },
    { status }
  );
}

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  return NextResponse.json({
    rules: await getAllRules(),
    events: NOTIFICATION_EVENTS.map((e) => ({
      key: e.key,
      label: e.label,
      bell: e.bell,
      availableRoles: e.availableRoles,
      timingMode: e.timingMode,
    })),
  });
}
