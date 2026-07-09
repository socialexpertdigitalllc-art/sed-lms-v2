import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const unread = new URL(req.url).searchParams.get("unread");

  let query = supabase
    .from("notifications")
    .select("id, event_key, lead_id, target_url, title, body, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (unread) query = query.is("read_at", null);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ notifications: data ?? [] });
}
