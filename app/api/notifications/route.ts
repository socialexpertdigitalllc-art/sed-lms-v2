import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const unread = url.searchParams.get("unread");
  const bell = url.searchParams.get("bell");

  let query = supabase
    .from("notifications")
    .select("id, event_key, lead_id, target_url, title, body, created_at, read_at, bell")
    .lte("deliver_after", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);

  if (unread) query = query.is("read_at", null);
  if (bell === "website" || bell === "general") query = query.eq("bell", bell);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ notifications: data ?? [] });
}
