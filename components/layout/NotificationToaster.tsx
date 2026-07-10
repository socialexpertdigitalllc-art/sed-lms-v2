"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/Toast";

/** Subscribes to the current user's new notifications and shows a toast for each. */
export function NotificationToaster() {
  const { toast } = useToast();
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let userId: string | null = null;
    const channel = supabase.channel("rt-toast-notifications");
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      userId = data.session?.user?.id ?? null;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, (payload) => {
          const row = payload.new as { user_id?: string; title?: string; body?: string };
          if (userId && row.user_id === userId) {
            toast({ kind: "info", title: row.title ?? "New notification", body: row.body ?? undefined });
          }
        })
        .subscribe();
    })();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [toast]);
  return null;
}
