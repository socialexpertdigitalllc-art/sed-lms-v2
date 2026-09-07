import { NextResponse } from "next/server";
import { requireForms, formsAuthError } from "@/lib/forms/guard";
import { loadVisibleEndpoint } from "@/lib/forms/load";
import { endpointPatchSchema } from "@/lib/forms/schema";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const auth = await requireForms("view");
  if ("error" in auth) return formsAuthError(auth.error);
  const endpoint = await loadVisibleEndpoint(auth, id);
  if (!endpoint) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ endpoint });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const auth = await requireForms("manage");
  if ("error" in auth) return formsAuthError(auth.error);
  const endpoint = await loadVisibleEndpoint(auth, id);
  if (!endpoint) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = endpointPatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid endpoint", issues: parsed.error.flatten() }, { status: 422 });

  const { data, error } = await auth.admin
    .from("form_endpoints")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });
  return NextResponse.json({ endpoint: data });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const auth = await requireForms("manage");
  if ("error" in auth) return formsAuthError(auth.error);
  const endpoint = await loadVisibleEndpoint(auth, id);
  if (!endpoint) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { error } = await auth.admin.from("form_endpoints").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
