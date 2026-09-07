import { NextResponse } from "next/server";
import { requireForms, formsAuthError } from "@/lib/forms/guard";
import { loadVisibleSubmission } from "@/lib/forms/load";
import { deliverSubmission } from "@/lib/forms/deliver";

/** Reset the delivery state and send again, right now. Works on sent rows too (a true re-send). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireForms("manage");
  if ("error" in auth) return formsAuthError(auth.error);
  const sub = await loadVisibleSubmission(auth, id);
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (sub.is_spam) return NextResponse.json({ error: "Mark as not spam first" }, { status: 409 });

  const { error } = await auth.admin.from("form_submissions").update({ delivery_status: "pending", delivery_attempts: 0, last_error: null }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const result = await deliverSubmission(id);
  return NextResponse.json({ result });
}
