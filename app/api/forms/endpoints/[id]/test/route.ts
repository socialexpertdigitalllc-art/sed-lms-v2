import { NextResponse } from "next/server";
import { requireForms, formsAuthError } from "@/lib/forms/guard";
import { loadVisibleEndpoint } from "@/lib/forms/load";
import { deliverSubmission } from "@/lib/forms/deliver";

/** Push a sample submission through the real pipeline (stored + emailed). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireForms("manage");
  if ("error" in auth) return formsAuthError(auth.error);
  const endpoint = await loadVisibleEndpoint(auth, id);
  if (!endpoint) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data, error } = await auth.admin
    .from("form_submissions")
    .insert({
      endpoint_id: endpoint.id,
      lead_id: endpoint.lead_id,
      // No fake reply-to and no example.com anywhere: a Reply-To at a
      // reserved domain is a real spam-filter trigger, and this email's whole
      // job is proving deliverability to the client's inbox.
      payload: [
        { key: "_test", value: "true" },
        { key: "name", value: "Website Visitor" },
        { key: "message", value: `Delivery check for the "${endpoint.name}" contact form. If you can read this, form submissions from the website will reach this inbox.` },
      ],
      subject: `${endpoint.name} — contact form delivery check`,
      submitter_name: "Website Visitor",
      submitter_email: null,
      origin: "dashboard",
      delivery_status: "pending",
    })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 400 });

  const result = await deliverSubmission(data.id as string);
  return NextResponse.json({ submission_id: data.id, result });
}
