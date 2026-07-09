import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { createFeedbackSchema } from "@/lib/feedback/schema";
import { notifyFeedback, feedbackManagerIds } from "@/lib/feedback/notify";
import type { Feedback } from "@/lib/feedback/types";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("feedback.submit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await req.formData();
  const payloadRaw = form.get("payload");
  if (typeof payloadRaw !== "string") return NextResponse.json({ error: "invalid" }, { status: 422 });
  const parsed = createFeedbackSchema.safeParse(JSON.parse(payloadRaw));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("feedback")
    .insert({
      user_id: user.id,
      type: parsed.data.type,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      status: "Open",
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Optional single screenshot, mirroring the ticket item attachment upload —
  // best-effort: a failed/invalid upload must never fail the submission itself,
  // since the feedback row already exists by this point.
  const screenshot = form.get("screenshot");
  if (screenshot instanceof File && screenshot.size > 0) {
    if (screenshot.type.startsWith("image/") && screenshot.size <= 5 * 1024 * 1024) {
      const path = `feedback/${row.id}/${screenshot.name.replace(/[^\w.\-]/g, "_")}`;
      try {
        await admin.storage.from("ticket-attachments").upload(path, screenshot, {
          contentType: screenshot.type,
          upsert: true,
        });
        await admin.from("feedback").update({ screenshot_path: path }).eq("id", row.id);
        row.screenshot_path = path;
      } catch {
        // Best-effort; don't fail the whole submission on one bad upload.
      }
    }
  }

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "feedback.created",
    entity_type: "feedback",
    entity_id: row.id,
    new_value: { type: parsed.data.type, title: parsed.data.title },
  });

  try {
    await notifyFeedback({
      eventKey: "feedback_submitted",
      feedbackId: row.id,
      recipients: await feedbackManagerIds(),
      title: "New feedback",
      body: `${parsed.data.type}: ${parsed.data.title}`,
      nonce: row.created_at,
    });
  } catch {
    // Notification failures must never fail feedback creation.
  }

  return NextResponse.json({ feedback: row }, { status: 201 });
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") === "all" ? "all" : "mine";

  if (scope === "all") {
    const perms = await getUserPermissions(user.id);
    if (!perms.has("feedback.manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const admin = createAdminClient();

  // `all` bypasses RLS via the admin client (safe — gated on `feedback.manage`
  // above); `mine` is scoped to the caller's own submissions either way.
  let query = admin.from("feedback").select("*").order("created_at", { ascending: false });
  if (scope === "mine") query = query.eq("user_id", user.id);

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const feedback = (rows ?? []) as Feedback[];

  const userIds = Array.from(
    new Set(feedback.map((f) => f.user_id).filter((v): v is string => Boolean(v)))
  );
  const names = new Map<string, string | null>();
  if (userIds.length) {
    const { data: profiles } = await admin.from("profiles").select("id, display_name").in("id", userIds);
    for (const p of profiles ?? []) names.set(p.id, p.display_name ?? null);
  }

  // Screenshots live in the private `ticket-attachments` bucket, so only the
  // service-role admin client can read them — serve short-lived signed URLs.
  await Promise.all(
    feedback.map(async (f) => {
      f.user_name = (f.user_id ? names.get(f.user_id) : null) ?? undefined;
      if (f.screenshot_path) {
        const { data: signed } = await admin.storage
          .from("ticket-attachments")
          .createSignedUrl(f.screenshot_path, 3600);
        f.screenshot_url = signed?.signedUrl ?? undefined;
      }
    })
  );

  return NextResponse.json({ feedback });
}
