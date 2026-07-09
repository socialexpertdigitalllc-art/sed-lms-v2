import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NotificationInbox } from "@/components/notifications/NotificationInbox";
import type { AppNotification } from "@/lib/notifications/types";

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("notifications")
    .select("id, event_key, bell, lead_id, target_url, title, body, created_at, read_at")
    .lte("deliver_after", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(200);

  return <NotificationInbox initial={(data ?? []) as AppNotification[]} />;
}
