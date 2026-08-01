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

  const columns = "id, event_key, bell, lead_id, target_url, title, body, created_at, read_at";
  // website_url arrives with migration 0066 — fall back gracefully before it.
  let { data, error } = await supabase
    .from("notifications")
    .select(`${columns}, website_url`)
    .lte("deliver_after", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(200);
  if (error && /website_url/i.test(error.message)) {
    const fallback = await supabase
      .from("notifications")
      .select(columns)
      .lte("deliver_after", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(200);
    data = (fallback.data ?? []) as unknown as typeof data;
  }

  return <NotificationInbox initial={(data ?? []) as unknown as AppNotification[]} />;
}
