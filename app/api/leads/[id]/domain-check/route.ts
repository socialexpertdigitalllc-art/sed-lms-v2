import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireDomains, domainsAuthError } from "@/lib/domains/guard";
import { checkLeadDomain, checkRegistrar, loadLeadDomainCheck } from "@/lib/domains/leadCheck";
import { takeDomainCheck, TOO_MANY_CHECKS } from "@/lib/domains/checkRate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The lead's exact-name .com check (lib/domains/leadCheck.ts). GET reads the
 * stored answer; POST checks again now. Anyone who can see the lead and the
 * Domains section (domains.view — sales included) may do both.
 */
async function guard(id: string) {
  const auth = await requireDomains("view");
  if ("error" in auth) return { response: domainsAuthError(auth.error) };
  const supabase = await createClient();
  const { data: lead } = await supabase.from("leads").select("id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!lead) return { response: NextResponse.json({ error: "Lead not found" }, { status: 404 }) };
  return { auth };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if (g.response) return g.response;
  return NextResponse.json({ check: await loadLeadDomainCheck(g.auth.admin, id) });
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if (g.response) return g.response;
  if (!checkRegistrar()) return NextResponse.json({ error: "No registrar is configured for availability checks." }, { status: 422 });
  if (!takeDomainCheck(g.auth.userId)) return NextResponse.json({ error: TOO_MANY_CHECKS }, { status: 429 });
  const check = await checkLeadDomain(g.auth.admin, id);
  if (!check) return NextResponse.json({ error: "This lead's business name can't be made into a domain." }, { status: 422 });
  return NextResponse.json({ check });
}
