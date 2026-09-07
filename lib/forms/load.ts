import type { FormsAuth } from "@/lib/forms/guard";
import { endpointInScope, submissionInScope } from "@/lib/forms/access";
import type { FormEndpointRow, FormSubmissionRow } from "@/lib/forms/types";

/** One endpoint the caller may see, or null (render as 404 — never leak existence). */
export async function loadVisibleEndpoint(auth: FormsAuth, id: string): Promise<FormEndpointRow | null> {
  const { data } = await auth.admin.from("form_endpoints").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const row = data as FormEndpointRow;
  return endpointInScope(row, auth.scope) ? row : null;
}

/** Same rule for a submission (its denormalised lead_id decides). */
export async function loadVisibleSubmission(auth: FormsAuth, id: string): Promise<FormSubmissionRow | null> {
  const { data } = await auth.admin.from("form_submissions").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const row = data as FormSubmissionRow;
  return submissionInScope(row, auth.scope) ? row : null;
}
