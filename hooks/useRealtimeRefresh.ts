"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Subscribe to Postgres changes on a table and debounce-refresh the route.
export function useRealtimeRefresh(table: string) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let t: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const channel = supabase.channel(`rt-${table}`);

    // RLS-gated postgres_changes require the realtime socket to carry the
    // user's JWT; otherwise the (authenticated-only) policy filters every event.
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel
        .on("postgres_changes", { event: "*", schema: "public", table }, () => {
          if (t) clearTimeout(t);
          t = setTimeout(() => router.refresh(), 400);
        })
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, [table, router]);
}
