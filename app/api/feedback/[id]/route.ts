import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { resolveFeedbackSchema } from "@/lib/feedback/schema";
import { notifyFeedback } from "@/lib/feedback/notify";
import type { Feedback } from "@/lib/feedback/types";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("feedback.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = resolveFeedbackSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { data: fbRow } = await admin.from("feedback").select("*").eq("id", id).single();
  if (!fbRow) return NextResponse.json({ error: "Feedback not found" }, { status: 404 });
  const fb = fbRow as Feedback;
  if (fb.status === "Resolved") {
    return NextResponse.json({ error: "Already resolved" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await admin
    .from("feedback")
    .update({
      status: "Resolved",
      resolution_note: parsed.data.resolution_note ?? null,
      resolved_at: now,
      resolved_by: user.id,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "feedback.resolved",
    entity_type: "feedback",
    entity_id: id,
    new_value: { resolution_note: parsed.data.resolution_note ?? null },
  });

  try {
    await notifyFeedback({
      eventKey: "feedback_resolved",
      feedbackId: id,
      recipients: [fb.user_id].filter((v): v is string => Boolean(v)),
      title: "Feedback resolved",
      body: fb.title,
      nonce: now,
    });
  } catch {
    // Notification failures must never fail the feedback update.
  }

  return NextResponse.json({ feedback: updated });
}
