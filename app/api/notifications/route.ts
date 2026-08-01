import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const BASE_COLUMNS = "id, event_key, lead_id, target_url, title, body, created_at, read_at, bell";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const unread = url.searchParams.get("unread");
  const bell = url.searchParams.get("bell");

  function build(columns: string) {
    let query = supabase
      .from("notifications")
      .select(columns)
      .lte("deliver_after", new Date().toISOString())
      .order("created_at", { ascending: false })
      // The bells promise EVERY unread notification, not a sample; 200 is the
      // inbox page's own ceiling.
      .limit(unread ? 200 : 50);
    if (unread) query = query.is("read_at", null);
    if (bell === "website" || bell === "general") {
      const bells = bell.split(",").filter((b) => b === "website" || b === "general");
      query = bells.length === 1 ? query.eq("bell", bells[0]) : query.in("bell", bells);
    }
    return query;
  }

  // website_url arrives with migration 0066 — fall back gracefully before it.
  let { data, error } = await build(`${BASE_COLUMNS}, website_url`);
  if (error && /website_url/i.test(error.message)) {
    ({ data, error } = await build(BASE_COLUMNS));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ notifications: data ?? [] });
}
