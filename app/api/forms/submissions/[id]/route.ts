import { NextResponse } from "next/server";
import { z } from "zod";
import { requireForms, formsAuthError } from "@/lib/forms/guard";
import { loadVisibleSubmission } from "@/lib/forms/load";
import { deliverSubmission } from "@/lib/forms/deliver";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({ read: z.boolean().optional(), spam: z.boolean().optional() });

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const auth = await requireForms("view");
  if ("error" in auth) return formsAuthError(auth.error);
  const sub = await loadVisibleSubmission(auth, id);
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid patch" }, { status: 422 });
  const { read, spam } = parsed.data;

  if (spam !== undefined && !auth.perms.has("forms.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (read !== undefined) {
    const { error } = await auth.admin.from("form_submissions").update({ read_at: read ? new Date().toISOString() : null }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (spam === true) {
    const { error } = await auth.admin.from("form_submissions").update({ is_spam: true, spam_reason: "manual", delivery_status: "skipped" }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (spam === false) {
    // Not spam after all → re-queue and deliver now.
    const { error } = await auth.admin.from("form_submissions").update({ is_spam: false, spam_reason: null, delivery_status: "pending", delivery_attempts: 0, last_error: null }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await deliverSubmission(id);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const auth = await requireForms("manage");
  if ("error" in auth) return formsAuthError(auth.error);
  const sub = await loadVisibleSubmission(auth, id);
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { error } = await auth.admin.from("form_submissions").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
