import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getDocText } from "@/lib/google/docs";
import { extractPlaceholders } from "@/lib/contracts/placeholders";

export const runtime = "nodejs";

const schema = z.object({ google_doc_id: z.string().trim().min(1).max(200) });

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 422 });

  let doc: { title: string; text: string };
  try {
    doc = await getDocText(parsed.data.google_doc_id);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  const placeholders = extractPlaceholders(doc.text);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contract_templates")
    .insert({
      google_doc_id: parsed.data.google_doc_id,
      name: doc.title || "Untitled template",
      placeholders,
      synced_at: new Date().toISOString(),
      created_by: user.id,
    })
    .select("id, google_doc_id, name, placeholders, synced_at")
    .single();

  if (error || !data) {
    const dup = error?.code === "23505";
    return NextResponse.json(
      { error: dup ? "That document is already added as a template" : error?.message ?? "Insert failed" },
      { status: dup ? 409 : 400 }
    );
  }
  return NextResponse.json({ template: data }, { status: 201 });
}
